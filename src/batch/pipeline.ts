/**
 * The item worker — one submission, end to end.
 *
 * Design reference: batch-backend-design §3 (the item worker), §8 (failure
 * isolation), B10 (no batch-specific verification path).
 *
 * This is the only place the batch path and the pipeline meet. It does the I/O
 * the pure core refuses to — fetch bytes, rasterise, call the model, write the
 * record — and then hands the deterministic work to exactly the same
 * `verifySubmission` a single review would use. There is no batch-specific
 * comparison, by design: a divergence between batch and single review would be a
 * correctness bug hiding as a feature.
 *
 * Failure is classified, not swallowed (§8):
 *   - a deterministic refusal (corrupt file, unknown form) FAILS with a cause and
 *     is never retried — redelivery cannot fix it;
 *   - a transient fault (provider timeout, render failure) is retried within the
 *     queue's budget and only settles as FAILED once the budget is spent.
 * An unreadable label is NEITHER — it is a verdict (D5), and flows through the
 * success path as `INCOMPLETE`.
 */

import { configuredLegibilityFloor } from '../domain/legibility.js'
import { verifySubmission } from '../domain/verify.js'
import type { Env, WorkMessage } from '../env.js'
import { type IntakeLimits, IntakeRejected, type NormaliseResult } from '../normalise/normaliser.js'
import { rasteriseSubmission } from '../normalise/rasterise.js'
import { TTB_F5100_31_2023, UnknownFormError } from '../normalise/regions.js'
import { ruleSetAsAt } from '../policy/archive.js'
import { createProvider } from '../providers/registry.js'
import type { Provider } from '../providers/types.js'
import { SYSTEM_AGENT } from './agent.js'
import { appendAudit } from './audit.js'
import { MAX_ATTEMPTS } from './backoff.js'
import { sha256Hex } from './digest.js'
import { labelImageKey } from './keys.js'
import { emit } from './log.js'
import { buildPersistPlan, persistResult } from './persist.js'
import { LABEL_RASTER, RECORD_RASTER } from './submissions.js'

export interface ProcessOutcome {
  /** Whether the queue should redeliver this message for another attempt. */
  readonly retry: boolean
  /**
   * How long to hold the message before redelivering it.
   *
   * Unused by the rate-limit path, which waits in place rather than releasing
   * the slot. Retained for a transient fault that wants pacing without one.
   */
  readonly delaySeconds?: number
}

function intakeLimits(env: Env): IntakeLimits {
  return {
    maxBytes: Number(env.MAX_UPLOAD_BYTES),
    maxPageCount: Number(env.MAX_PAGE_COUNT),
    maxPixels: Number(env.MAX_PIXELS),
  }
}

/** A deterministic refusal — the same input fails the same way, so never retry. */
function isDeterministicRefusal(error: unknown): boolean {
  return error instanceof IntakeRejected || error instanceof UnknownFormError
}

/**
 * The `Lnn` id of a bundled submission, from the raster path the message
 * already carries. Empty for an upload, which has no corpus identity.
 */
function corpusIdOf(message: WorkMessage): string {
  return message.labelRasterPath?.match(/([^/]+)-label\.png$/)?.[1] ?? ''
}

function causeOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * What the shipped manifest says about a bundled submission.
 *
 * **Only the legibility measurement.** It used to carry the applicant's
 * declared record as well, which the batch used instead of reading the record
 * page — halving the inference per submission, and making the batch and the
 * single-review path two different checks of the same file. One trusted a
 * value from a build artefact; the other read the pixels. Two paths that can
 * disagree about the same submission are two systems, and only one of them was
 * being demonstrated.
 *
 * The legibility number stays because it cannot be read at all at runtime: it
 * is measured from the raster at build time, and the extractor cannot be asked
 * — shown an illegible warning it returns the statutory text from memory and
 * reports success.
 */
interface CorpusEntry {
  /** Measured at build time from the shipped raster; see testdata/generate.py. */
  readonly warningLegibility: number | null
}

async function loadCorpusEntry(env: Env, submissionId: string): Promise<CorpusEntry | null> {
  if (!env.ASSETS) return null
  const response = await env.ASSETS.fetch(new Request('https://assets.local/manifest.json'))
  if (!response.ok) return null

  const manifest = (await response.json()) as {
    cases?: { id?: string; warningLegibility?: unknown }[]
  }
  const entry = manifest.cases?.find((c) => c.id === submissionId)
  if (entry === undefined) return null

  // The manifest also carries each case's authored expected outcome. Nothing
  // here reads it, and nothing should: an expected verdict travelling into the
  // pipeline would make the corpus grade itself.
  return {
    warningLegibility: typeof entry.warningLegibility === 'number' ? entry.warningLegibility : null,
  }
}

/**
 * The build-time render of a bundled submission, if it has one.
 *
 * Returns null when the submission is not from the corpus, or when either
 * region is missing — a half-present render is treated as absent rather than
 * patched, so the item takes the browser path whole instead of comparing a
 * shipped label against a freshly rendered record.
 */
async function loadPrerendered(env: Env, message: WorkMessage): Promise<NormaliseResult | null> {
  const { labelRasterPath, recordRasterPath } = message
  if (!env.ASSETS || !labelRasterPath || !recordRasterPath) return null

  const fetchAsset = async (path: string): Promise<ArrayBuffer | null> => {
    const response = await env.ASSETS?.fetch(new Request(`https://assets.local/${path}`))
    if (!response?.ok) return null
    return response.arrayBuffer()
  }

  const [label, record] = await Promise.all([
    fetchAsset(labelRasterPath),
    fetchAsset(recordRasterPath),
  ])
  if (label === null || record === null) return null

  return {
    form: TTB_F5100_31_2023,
    label: {
      region: 'label',
      image: label,
      mimeType: 'image/png',
      widthPx: LABEL_RASTER.widthPx,
      heightPx: LABEL_RASTER.heightPx,
      dpi: LABEL_RASTER.dpi,
    },
    record: {
      region: 'record',
      image: record,
      mimeType: 'image/png',
      widthPx: RECORD_RASTER.widthPx,
      heightPx: RECORD_RASTER.heightPx,
      dpi: RECORD_RASTER.dpi,
    },
    // Never populated for a pre-rendered submission. The record text layer is
    // an optimisation the PDF path can offer; there is no PDF here, and an
    // empty string would be indistinguishable from a page with no text.
    recordTextLayer: null,
    elapsedMs: 0,
  }
}

/**
 * Process one submission.
 *
 * Returns whether the message should be retried. Every terminal path — success,
 * deterministic refusal, or exhausted retries — records the item's fate on the
 * coordinator before returning, so the ledger is never left mid-flight.
 */
export async function processItem(
  env: Env,
  message: WorkMessage,
  attempt: number,
): Promise<ProcessOutcome> {
  const { jobId, submissionId, contentKey } = message
  // The AI binding is deliberately absent from this list: whether inference
  // needs a binding at all is the provider's business, and `createProvider`
  // below reports its own missing dependency by name. Requiring it here would
  // have made a Gemini deployment fail with no explanation.
  if (!env.JOB || !env.DB || !env.STAGING || !env.BROWSER) {
    // A missing binding is an operator error, not an item fault. Fail the item
    // loudly rather than retrying against an unfixable environment.
    return { retry: false }
  }
  const stub = env.JOB.get(env.JOB.idFromName(jobId))
  const dpi = Number(env.RASTER_DPI)
  // Bound here: the narrowing above does not survive into the retry closure.
  const browser = env.BROWSER

  // Built once, before any work: its `spec.classify` decides what every failure
  // below means. A provider that cannot be constructed is an operator error, so
  // it fails the item loudly rather than being retried against a deployment
  // that will never come right.
  let provider: Provider
  try {
    provider = createProvider(env)
  } catch (e) {
    const cause = e instanceof Error ? e.message : String(e)
    await env.DB.prepare(`UPDATE submission SET state = 'FAILED', failure_cause = ? WHERE id = ?`)
      .bind(cause, submissionId)
      .run()
    await stub.recordFailure(submissionId, cause)
    return { retry: false }
  }

  // Nothing left to attempt: the job was abandoned while this message waited
  // in the queue. Acked without work, so the remaining messages drain in
  // seconds rather than each rediscovering the same dead end.
  const abandoned = await stub.abortedReason()
  if (abandoned !== null) return { retry: false }

  await stub.startItem(submissionId)

  try {
    const object = await env.STAGING.get(contentKey)
    if (object === null) {
      throw new IntakeRejected('corrupt', 'The staged submission could not be found.')
    }
    const bytes = await object.arrayBuffer()

    // A bundled submission ships its regions already rendered, so the browser
    // is not launched at all. The corpus is fixed: rasterising it on every run
    // re-derives pixels that were rendered at build time, and each derivation
    // costs one launch against a ceiling of one every twenty seconds.
    //
    // An upload has no build-time render and falls through to the browser, so
    // the real normalisation path stays exercised rather than bypassed.
    // Timed because it is the stage with the widest spread — a pre-rendered
    // corpus item costs nothing, an upload costs a browser launch — and §16.4
    // cannot be filled from a total that hides which stage was slow.
    const normaliseStarted = Date.now()
    const prerendered = await loadPrerendered(env, message)
    const normalised =
      prerendered ??
      // The launch is the only step the provider refuses on rate, and this item
      // keeps its turn while waiting: releasing the message would release the
      // slot to the next submission, which is what made failure a function of
      // queue position rather than of the artwork.
      // The same function the single-review path calls, guards included. Two
      // copies of these five lines would decide the limits, the DPI and the
      // rate-limit behaviour twice, and would drift in the direction nobody
      // watches.
      (await rasteriseSubmission(bytes, { browser, limits: intakeLimits(env), dpi }))

    const normaliseMs = Date.now() - normaliseStarted

    // Every submission is read the same way, corpus or upload: two regions, two
    // blind reads, nothing declared.
    //
    // The corpus record used to be taken as data from the manifest, which was
    // half the inference and a real defence against an extraction once observed
    // inventing "Old Forester" for a compliant label. It was dropped because it
    // made this path and the single-review path two different checks of the
    // same file — one trusting a build artefact, one reading pixels — and they
    // could disagree about the same submission while both looked correct.
    //
    // If the record read starts fabricating again, the answer is to make that
    // visible rather than to route around it: it is exactly the failure the
    // extraction contract, the confidence floor and UNREADABLE exist to catch,
    // and a corpus that never exercises them proves nothing about an upload.
    const corpus = await loadCorpusEntry(env, corpusIdOf(message))
    // Null when unset, which `validateConfig` already reports as a startup
    // problem. Here it means the measurement is not applied rather than
    // applied against a number nobody chose: silently inventing a threshold
    // would decide real verdicts on a policy the deployment never stated.
    const legibilityFloor = configuredLegibilityFloor(env)
    // Both dates, taken once so every rule in this judgement is selected
    // against the same instant. The filing date is today's because the corpus
    // carries none — an assumption, and one the verdict records rather than
    // hides. A real intake would take it from the application.
    const filedOn = new Date().toISOString().slice(0, 10)
    const judgedAt = new Date().toISOString()

    const result = await verifySubmission(
      {
        label: {
          image: normalised.label.image,
          mimeType: normalised.label.mimeType,
          // Measured from the pixels, because the extractor cannot be asked:
          // it returns the statutory warning from memory when it cannot read
          // one, and reports success either way.
          //
          // The floor it is judged against comes from configuration and
          // travels with the measurement — how degraded a scan an agency will
          // accept is its decision, and a measurement without the threshold it
          // was judged against cannot be interpreted afterwards.
          ...(corpus?.warningLegibility === null ||
          corpus?.warningLegibility === undefined ||
          legibilityFloor === null
            ? {}
            : {
                warningLegibility: {
                  measured: corpus.warningLegibility,
                  floor: legibilityFloor,
                },
              }),
        },
        record: { image: normalised.record.image, mimeType: normalised.record.mimeType },
      },
      // The clock is supplied here, outside the pure core (M1).
      // Both dates are taken once, before the call, so every rule in one
      // judgement is selected against the same instant.
      //
      // The filing date is today's, and that is an assumption rather than a
      // fact: the corpus carries no filing date, so there is none to use. It
      // is bound into the verdict, so a reader can see which day's rules were
      // applied instead of having to infer it. A real intake would take the
      // date from the application.
      {
        provider,
        now: () => Date.now(),
        submittedOn: filedOn,
        asOf: judgedAt,
        // The rule set as it stood for a filing on that date, as this
        // deployment understands it now (D41, D42). Read from the archive
        // rather than the file so the verdict can be rebuilt later against the
        // rules that actually produced it.
        rules: await ruleSetAsAt(env.DB, filedOn, judgedAt),
      },
    )

    // Keep the rasterised label crop so the results view can show the artwork
    // beside the verdict (FR-10, ui-design §6.4). Demo retention: the design
    // purges staged content on completion (§10); the prototype keeps it so the
    // image panel has something to render after the job ends.
    await env.STAGING.put(labelImageKey(jobId, submissionId), normalised.label.image, {
      httpMetadata: { contentType: 'image/png' },
    })

    const plan = buildPersistPlan(
      result,
      {
        verdictId: crypto.randomUUID(),
        submissionId,
        labelExtractionId: crypto.randomUUID(),
        recordExtractionId: result.provenance.record ? crypto.randomUUID() : null,
      },
      dpi,
    )
    await persistResult(env.DB, plan, 'COMPLETED', new Date().toISOString())

    // What produced this verdict, in identifiers. The values themselves are in
    // verdict and field_verdict, where they are evidence; here they would be
    // content in a history that cannot be redacted (D20).
    await appendAudit(env.DB, {
      at: new Date().toISOString(),
      agent: SYSTEM_AGENT,
      actor: 'system',
      action: 'verdict.recorded',
      subjectType: 'verdict',
      subjectId: plan.verdict.id,
      detail: [
        `submission=${submissionId}`,
        `outcome=${result.outcome}`,
        `provider=${result.provenance.label.provider}`,
        `model=${result.provenance.label.modelId}`,
        // What answered, not what was asked for. Absent when the vendor does
        // not say, and recorded as such rather than assumed equal.
        `served=${result.provenance.label.servedModelVersion ?? 'unreported'}`,
        `prompt=${result.provenance.label.promptVersion}`,
        `record=${result.provenance.record ? 'read' : 'declared'}`,
        // Why the legibility decision went the way it did. The decision itself
        // is on the verdict row, which is what makes replay possible; this is
        // the threshold it was judged against, so the record explains itself
        // to someone reading it after the floor has since been changed.
        ...(corpus?.warningLegibility != null && legibilityFloor !== null
          ? [`legibility=${corpus.warningLegibility}/${legibilityFloor}`]
          : []),
        `dpi=${dpi}`,
        // The readings themselves, by digest. This event is hash-chained; the
        // `extraction` rows are not, so without this a stored reading could be
        // edited and nothing would contradict it. Committing the digest here
        // makes altering a reading require forging the chain, and turns what
        // used to look like "the rules moved" into "the record changed".
        // Digests only — a reading is content, and content never enters a log
        // or an audit detail (D20).
        `labelDigest=${await sha256Hex(result.rawResponses.label)}`,
        ...(result.rawResponses.record === null
          ? []
          : [`recordDigest=${await sha256Hex(result.rawResponses.record)}`]),
        `reference=${result.warning.referenceDataVersion}`,
        `legible=${result.warning.legible}`,
      ].join(';'),
    })

    // The stage timings and the versioned identity set, as dimensions (M7,
    // D28). Identifiers, classifications, versions and numbers — nothing that
    // could carry a value read off a label, because the emitter has no field
    // for one.
    emit({
      event: 'item.completed',
      jobId,
      submissionId,
      verdictId: plan.verdict.id,
      outcome: result.outcome,
      problemCount: result.problemCount,
      provider: result.provenance.label.provider,
      modelId: result.provenance.label.modelId,
      promptVersion: result.provenance.label.promptVersion,
      rulesetVersion: plan.verdict.rulesetVersion,
      referenceDataVersion: result.warning.referenceDataVersion,
      normaliseMs,
      extractMs: result.timings.extractMs,
      compareMs: result.timings.compareMs,
      // Normalisation happens before verifySubmission is called, so its own
      // total does not include it. Reported as the whole item, which is the
      // number §16.4 asks for.
      totalMs: normaliseMs + result.timings.totalMs,
      dpi,
    })

    await stub.recordResult(submissionId, result.outcome, result.summary)
    return { retry: false }
  } catch (error) {
    const cause = causeOf(error)

    // The day's inference allowance is gone. It will not clear by waiting, so
    // the job stops here rather than spending the rest of the queue proving it
    // 25 more times. Every remaining item is settled with the same cause, so
    // the worklist says what happened instead of filling with failures that
    // look like a broken tool.
    const fault = provider.spec.classify(error)

    if (fault === 'quota-exhausted') {
      const reason =
        'The daily inference allowance for this account is used up. ' +
        'The check stopped here; no further submissions were attempted.'
      await env.DB.prepare(`UPDATE submission SET state = 'FAILED', failure_cause = ? WHERE id = ?`)
        .bind(reason, submissionId)
        .run()
      // The ledger and the durable record both have to settle, or /batch/current
      // reads the job as running for ever and the next batch joins a corpse.
      await env.DB.prepare(
        `UPDATE submission SET state = 'FAILED', failure_cause = ?
          WHERE job_id = ? AND state IN ('QUEUED', 'RUNNING')`,
      )
        .bind(reason, jobId)
        .run()
      // The most consequential event in a run, and it was the one the history
      // did not record: a job abandoning twenty-five submissions left a chain
      // showing only the individual failures that preceded it, with nothing
      // saying why the rest never ran.
      await appendAudit(env.DB, {
        at: new Date().toISOString(),
        agent: SYSTEM_AGENT,
        actor: 'system',
        action: 'job.abandoned',
        subjectType: 'job',
        subjectId: jobId,
        detail: `fault=quota-exhausted;provider=${provider.name};at=${submissionId}`,
      })

      await stub.abort(reason)
      return { retry: false }
    }

    // A rate limit has already been waited out in place, across the full
    // attempt budget, without ever giving up the slot. Returning it to the
    // queue now would hand the next submission a turn this one never got —
    // the behaviour that made failure depend on queue position. Having tried
    // and waited, the honest answer is that the provider is refusing.
    if (
      !isDeterministicRefusal(error) &&
      fault !== 'rate-limited' &&
      fault !== 'permanent' &&
      attempt < MAX_ATTEMPTS
    ) {
      // Transient and not a rate limit: return the item to the queue for a
      // bounded retry (§8). It is waiting rather than running, and the ledger
      // has to say so or the whole worklist reads "Checking…".
      await stub.deferItem(submissionId)
      return { retry: true }
    }

    await env.DB.prepare(`UPDATE submission SET state = ?, failure_cause = ? WHERE id = ?`)
      .bind(isDeterministicRefusal(error) ? 'REJECTED' : 'FAILED', cause, submissionId)
      .run()
    await appendAudit(env.DB, {
      at: new Date().toISOString(),
      agent: SYSTEM_AGENT,
      actor: 'system',
      action: isDeterministicRefusal(error) ? 'submission.rejected' : 'submission.failed',
      subjectType: 'submission',
      subjectId: submissionId,
      // The classification, not the message: a cause can quote a provider, and
      // a provider can quote the label back at us.
      detail: `job=${jobId};fault=${fault};attempt=${attempt}`,
    })

    emit({
      event: 'item.failed',
      jobId,
      submissionId,
      // The classification, never the message: a cause can quote a provider,
      // and a provider can quote the label back at us (D20, D38).
      fault: fault ?? 'unclassified',
      attempt,
    })
    await stub.recordFailure(submissionId, cause)
    return { retry: false }
  }
}
