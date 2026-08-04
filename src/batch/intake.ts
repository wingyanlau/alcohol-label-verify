/**
 * Batch intake — create the job, stage content, seed the ledger, enqueue.
 *
 * Design reference: batch-backend-design §3 (intake), §5 (job model), §8
 * (rejection before queueing).
 *
 * Intake validates and distributes; it processes nothing (§3). The one
 * validation it performs is the cheap structural guard (`checkIntake`): a file
 * that cannot be a submission is REJECTED here, before it ever reaches a worker,
 * because redelivery could never fix it. Everything else — rasterising,
 * reading, comparing — belongs to the item worker.
 *
 * The whole corpus is opened on the coordinator up front so `total` is correct
 * from the first frame, then accepted items are enqueued and rejected ones are
 * settled immediately. A rejected item is still part of the job's tally (B5): no
 * silent loss.
 */

import { isApproved } from '../domain/approval.js'
import type { Env, WorkMessage } from '../env.js'
import { checkIntake, IntakeRejected } from '../normalise/normaliser.js'
import { PROMPT_VERSION, promptDigest } from '../providers/prompt.js'
import { createProvider } from '../providers/registry.js'
import { SYSTEM_AGENT } from './agent.js'
import { appendAudit } from './audit.js'
import { checkBatchSize } from './cap.js'
import { sha256Hex } from './digest.js'
import { fingerprintOf, PROBE_IMAGE } from './fingerprint.js'
import { contentKey } from './keys.js'
import { referenceCodeFor } from './reference-code.js'
import { corpus, type Submission } from './submissions.js'

export interface BatchStarted {
  readonly jobId: string
  readonly total: number
  readonly accepted: number
  readonly rejected: number
}

async function loadAsset(env: Env, path: string): Promise<ArrayBuffer | null> {
  if (!env.ASSETS) return null
  const response = await env.ASSETS.fetch(new Request(`https://assets.local/${path}`))
  if (!response.ok) return null
  return response.arrayBuffer()
}

interface PreparedItem {
  readonly itemId: string
  readonly submission: Submission
  readonly bytes: ArrayBuffer | null
  readonly rejection: string | null
}

/**
 * Start a batch over the bundled corpus.
 *
 * Requires the full set of batch bindings; a missing one is an operator error
 * surfaced to the caller rather than a partial job.
 */
export async function startBatch(env: Env): Promise<BatchStarted> {
  if (!env.JOB || !env.DB || !env.STAGING || !env.WORK || !env.ASSETS) {
    throw new Error('batch bindings are not fully configured')
  }

  const items = corpus()

  // Before anything is staged, queued or charged (ADV-06, B-D11). The cap was
  // configuration that nothing consulted; refusing here is the only point at
  // which refusing is free.
  checkBatchSize(items.length, Number(env.MAX_BATCH_ITEMS))

  const jobId = crypto.randomUUID()
  const now = new Date().toISOString()

  // Read and validate every submission first, so the job's item count is known
  // before anything is enqueued.
  const prepared: PreparedItem[] = await Promise.all(
    items.map(async (submission): Promise<PreparedItem> => {
      const itemId = crypto.randomUUID()
      const bytes = await loadAsset(env, submission.assetPath)
      if (bytes === null) {
        return {
          itemId,
          submission,
          bytes: null,
          rejection: 'The submission file could not be read.',
        }
      }
      try {
        checkIntake(bytes, {
          maxBytes: Number(env.MAX_UPLOAD_BYTES),
          maxPageCount: Number(env.MAX_PAGE_COUNT),
          maxPixels: Number(env.MAX_PIXELS),
        })
        return { itemId, submission, bytes, rejection: null }
      } catch (error) {
        const reason = error instanceof IntakeRejected ? error.message : String(error)
        return { itemId, submission, bytes: null, rejection: reason }
      }
    }),
  )

  await env.DB.prepare(
    // Explicit rather than left to the column default: the kind is what decides
    // whether this job ever appears on the batch screen, and a default is not
    // where a decision like that should live.
    `INSERT INTO job (id, created_at, state, item_count, kind)
     VALUES (?, ?, 'PROCESSING', ?, 'batch')`,
  )
    .bind(jobId, now, prepared.length)
    .run()

  const db = env.DB
  const stub = env.JOB.get(env.JOB.idFromName(jobId))
  await stub.open(
    jobId,
    prepared.map((p) => ({ itemId: p.itemId, sourceName: p.submission.sourceName })),
  )

  const inserts: D1PreparedStatement[] = []
  const messages: WorkMessage[] = []
  const rejectedItems: { itemId: string; cause: string }[] = []

  for (const p of prepared) {
    if (p.bytes === null || p.rejection !== null) {
      inserts.push(
        db
          .prepare(
            `INSERT INTO submission
               (id, job_id, source_name, content_digest, byte_size, content_key, state,
                failure_cause, created_at, reference_code)
             VALUES (?, ?, ?, '', 0, NULL, 'REJECTED', ?, ?, ?)`,
          )
          .bind(
            p.itemId,
            jobId,
            p.submission.sourceName,
            p.rejection ?? 'Rejected',
            now,
            await referenceCodeFor(p.itemId),
          ),
      )
      rejectedItems.push({ itemId: p.itemId, cause: p.rejection ?? 'Rejected' })
      continue
    }

    const key = contentKey(jobId, p.itemId)
    const digest = await sha256Hex(p.bytes)
    await env.STAGING.put(key, p.bytes, { httpMetadata: { contentType: 'application/pdf' } })
    inserts.push(
      db
        .prepare(
          `INSERT INTO submission
             (id, job_id, source_name, content_digest, byte_size, content_key, state,
              created_at, reference_code)
           VALUES (?, ?, ?, ?, ?, ?, 'QUEUED', ?, ?)`,
        )
        .bind(
          p.itemId,
          jobId,
          p.submission.sourceName,
          digest,
          p.bytes.byteLength,
          key,
          now,
          await referenceCodeFor(p.itemId),
        ),
    )
    messages.push({
      jobId,
      submissionId: p.itemId,
      contentKey: key,
      contentDigest: digest,
      labelRasterPath: p.submission.labelRasterPath,
      recordRasterPath: p.submission.recordRasterPath,
    })
  }

  await db.batch(inserts)

  // Settle rejected items on the ledger so the worklist shows them immediately.
  for (const r of rejectedItems) await stub.recordFailure(r.itemId, r.cause)

  // Characterise the reader before it reads anything.
  //
  // One call, once per job, whose answer is hashed and recorded. Every verdict
  // in this job was produced by whatever answered here, so the job carries the
  // identity and the verdicts inherit it. A failure to fingerprint does not
  // stop the job: an unidentified reader is a gap worth recording, not a
  // reason to refuse work that would otherwise succeed.
  let fingerprint = 'unavailable'
  let providerName = (env.MODEL_PROVIDER ?? '').trim()
  try {
    const provider = createProvider(env)
    providerName = provider.name
    const probe = await env.ASSETS.fetch(new Request(`https://assets.local/${PROBE_IMAGE}`))
    if (probe.ok) {
      const result = await provider.extract({
        region: 'label',
        image: await probe.arrayBuffer(),
        mimeType: 'image/png',
        fields: ['brandName'],
        includeWarning: false,
      })
      fingerprint = await fingerprintOf(result.extraction.fields.brandName.raw ?? '')
    }
  } catch {
    // Recorded as unavailable below, and deliberately not rethrown.
  }

  await appendAudit(db, {
    at: now,
    agent: SYSTEM_AGENT,
    actor: 'system',
    action: 'model.fingerprinted',
    subjectType: 'job',
    subjectId: jobId,
    // The identity this job's verdicts were produced under. `model` is what was
    // asked for; `fingerprint` is what answered. A changed fingerprint against
    // an unchanged model name is a vendor repointing an alias — otherwise
    // undetectable after the fact.
    detail: [
      `provider=${providerName}`,
      `model=${env.MODEL_ID}`,
      `fingerprint=${fingerprint}`,
      `prompt=${PROMPT_VERSION}`,
      `promptDigest=${await promptDigest()}`,
      // Whether this reader was one an administrator approved. A job that ran
      // on an unapproved model is not void, but it is distinguishable.
      `approved=${isApproved(providerName, env.MODEL_ID)}`,
    ].join(';'),
  })

  await appendAudit(db, {
    at: now,
    agent: SYSTEM_AGENT,
    actor: 'system',
    action: 'job.opened',
    subjectType: 'job',
    subjectId: jobId,
    detail: `total=${prepared.length};accepted=${messages.length};rejected=${rejectedItems.length}`,
  })

  // Enqueue accepted items. Queue sends are capped per call, so send in batches.
  for (const message of messages) await env.WORK.send(message)

  return {
    jobId,
    total: prepared.length,
    accepted: messages.length,
    rejected: rejectedItems.length,
  }
}
