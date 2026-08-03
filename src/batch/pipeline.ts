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

import { verifySubmission } from '../domain/verify.js'
import type { Env, WorkMessage } from '../index.js'
import { createBrowserNormaliser } from '../normalise/browser-normaliser.js'
import {
  checkIntake,
  type IntakeLimits,
  IntakeRejected,
  type NormaliseResult,
} from '../normalise/normaliser.js'
import { TTB_F5100_31_2023, UnknownFormError } from '../normalise/regions.js'
import { createWorkersAiProvider } from '../providers/workers-ai.js'
import { isRateLimited, MAX_ATTEMPTS } from './backoff.js'
import { labelImageKey } from './keys.js'
import { buildPersistPlan, persistResult } from './persist.js'
import { withRateLimitRetry } from './retry.js'
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

function causeOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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
  if (!env.JOB || !env.DB || !env.STAGING || !env.BROWSER || !env.AI) {
    // A missing binding is an operator error, not an item fault. Fail the item
    // loudly rather than retrying against an unfixable environment.
    return { retry: false }
  }
  const stub = env.JOB.get(env.JOB.idFromName(jobId))
  const dpi = Number(env.RASTER_DPI)
  // Bound here: the narrowing above does not survive into the retry closure.
  const browser = env.BROWSER

  await stub.startItem(submissionId)

  try {
    const object = await env.STAGING.get(contentKey)
    if (object === null) {
      throw new IntakeRejected('corrupt', 'The staged submission could not be found.')
    }
    const bytes = await object.arrayBuffer()

    // Cheap structural guards before anything expensive renders (§11).
    checkIntake(bytes, intakeLimits(env))

    // A bundled submission ships its regions already rendered, so the browser
    // is not launched at all. The corpus is fixed: rasterising it on every run
    // re-derives pixels that were rendered at build time, and each derivation
    // costs one launch against a ceiling of one every twenty seconds.
    //
    // An upload has no build-time render and falls through to the browser, so
    // the real normalisation path stays exercised rather than bypassed.
    const prerendered = await loadPrerendered(env, message)
    const normalised =
      prerendered ??
      // The launch is the only step the provider refuses on rate, and this item
      // keeps its turn while waiting: releasing the message would release the
      // slot to the next submission, which is what made failure a function of
      // queue position rather than of the artwork.
      (await withRateLimitRetry(() =>
        createBrowserNormaliser({ browser, limits: intakeLimits(env) }).normalise(bytes, dpi),
      ))

    const provider = createWorkersAiProvider({ ai: env.AI, modelId: env.MODEL_ID })
    const result = await verifySubmission(
      {
        label: { image: normalised.label.image, mimeType: normalised.label.mimeType },
        record: { image: normalised.record.image, mimeType: normalised.record.mimeType },
      },
      { provider },
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

    await stub.recordResult(submissionId, result.outcome, result.summary)
    return { retry: false }
  } catch (error) {
    const cause = causeOf(error)

    // A rate limit has already been waited out in place, across the full
    // attempt budget, without ever giving up the slot. Returning it to the
    // queue now would hand the next submission a turn this one never got —
    // the behaviour that made failure depend on queue position. Having tried
    // and waited, the honest answer is that the provider is refusing.
    if (!isDeterministicRefusal(error) && !isRateLimited(error) && attempt < MAX_ATTEMPTS) {
      // Transient and not a rate limit: return the item to the queue for a
      // bounded retry (§8). It is waiting rather than running, and the ledger
      // has to say so or the whole worklist reads "Checking…".
      await stub.deferItem(submissionId)
      return { retry: true }
    }

    await env.DB.prepare(`UPDATE submission SET state = ?, failure_cause = ? WHERE id = ?`)
      .bind(isDeterministicRefusal(error) ? 'REJECTED' : 'FAILED', cause, submissionId)
      .run()
    await stub.recordFailure(submissionId, cause)
    return { retry: false }
  }
}
