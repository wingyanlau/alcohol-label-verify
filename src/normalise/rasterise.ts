/**
 * Turning a filed PDF into two regions — the one place that does it.
 *
 * Both entry points take the same input: the filled TTB F 5100.31 as a PDF. A
 * batch of three hundred and a single interactive review differ in how the file
 * arrives and in nothing else, so they must not differ in how it is read.
 *
 * This existed inline in the batch pipeline. Reproducing those five lines in
 * the review path would have been the smaller change and the worse one: the
 * guards, the DPI, the region map and the rate-limit behaviour would then be
 * decided twice, and the two copies would drift in the direction nobody
 * watches — a limit raised for uploads and not for batch, a retry added on one
 * side only. The same pixels reach the same reader either way because there is
 * one function, not because two functions agree today.
 *
 * What it deliberately does NOT do: choose the DPI, choose the limits, or know
 * where the bytes came from. Those are the caller's, and they are the only
 * things the two paths are allowed to differ on.
 */

import { withRateLimitRetry } from '../batch/retry.js'
import { createBrowserNormaliser } from './browser-normaliser.js'
import type { IntakeLimits, NormaliseResult } from './normaliser.js'
import { checkIntake } from './normaliser.js'

export interface RasteriseOptions {
  /** The Browser Rendering binding. */
  readonly browser: Fetcher
  readonly limits: IntakeLimits
  readonly dpi: number
}

/**
 * Structural guards, then one browser launch, then two regions.
 *
 * The rate-limit retry is here rather than at either call site because the
 * constraint belongs to the dependency: Browser Rendering admits one new
 * browser every 20 s on the free plan and refuses the rest with a 429 that
 * arrives in 40 ms. A rate limit clears by waiting; classifying it as a
 * transient fault and failing fast wastes the only thing that would have
 * fixed it (D37).
 */
export async function rasteriseSubmission(
  pdf: ArrayBuffer,
  opts: RasteriseOptions,
): Promise<NormaliseResult> {
  // Cheap checks on bytes, before anything decodes them (§11): a decompression
  // bomb must be refused before it is rendered, not after.
  checkIntake(pdf, opts.limits)

  return withRateLimitRetry(
    () =>
      createBrowserNormaliser({ browser: opts.browser, limits: opts.limits }).normalise(
        pdf,
        opts.dpi,
      ),
    // Browser Rendering refuses on rate in its own wording, which the inference
    // provider does not know. Classified here, in the only place that knows
    // both dependencies exist.
    { classify: (e) => (/\b429\b|rate limit/i.test(String(e)) ? 'rate-limited' : 'transient') },
  )
}
