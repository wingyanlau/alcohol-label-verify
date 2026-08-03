/**
 * What the platform needs to know about an inference vendor.
 *
 * `ExtractionProvider` in the domain says only how to read an image, because
 * that is all the comparison logic needs. Running a batch needs two more
 * things, and both had leaked out into code that should not know a vendor
 * exists:
 *
 *   - how to CLASSIFY a failure. `batch/backoff.ts` was matching "4006" and
 *     "daily free allocation" — Workers AI's wording — to decide whether to
 *     wait, abandon the job, or retry. Pointed at any other vendor it would
 *     have called every fault transient and retried a spent quota eight times.
 *
 *   - what the deployment must SUPPLY. `index.ts` held a set of vendor names to
 *     decide whether MODEL_API_KEY was required, and a list of floating
 *     suffixes that happens to describe Cloudflare's naming and not Google's.
 *
 * Both now belong to the vendor that understands them. A spec is static —
 * available during configuration validation, before any binding or credential
 * exists and therefore before a provider can be constructed.
 */

import type { ExtractionProvider } from '../domain/extraction.js'

/**
 * How a failure should be treated, in the batch layer's own vocabulary.
 *
 * The distinctions are the ones that change behaviour, and nothing finer:
 *
 *   rate-limited     clears by waiting. Hold the item and try again.
 *   quota-exhausted  does not clear by waiting. Abandon the job — continuing
 *                    rediscovers the same dead end once per submission.
 *   transient        may clear. Redeliver within the queue's budget.
 *   permanent        will fail the same way for ever. Settle the item now.
 */
export type FaultKind = 'rate-limited' | 'quota-exhausted' | 'transient' | 'permanent'

export interface ProviderSpec {
  readonly name: string

  /**
   * Whether the deployment must supply MODEL_API_KEY.
   *
   * False when a binding carries authentication, which is why /health does not
   * report a Workers AI deployment as broken for having no credential.
   */
  readonly requiresCredential: boolean

  /**
   * Whether this identifier resolves to different artefacts over time (D29).
   *
   * Vendor-specific by necessity. Cloudflare floats with a `-latest` suffix;
   * Google floats by *omitting* a version, so `gemini-2.5-flash` is an alias
   * and `gemini-2.5-flash-002` is not. A single suffix list cannot express
   * both, and the one we had would have waved the Gemini alias straight
   * through — silently invalidating every audit record citing it.
   */
  isFloatingModelId(modelId: string): boolean

  /** How a failure from this vendor should be treated. */
  classify(error: unknown): FaultKind
}

/** An extraction provider, plus what the batch layer needs to run it. */
export interface Provider extends ExtractionProvider {
  readonly spec: ProviderSpec

  /**
   * Cheapest call that proves the model is reachable.
   *
   * Here rather than in a health endpoint because "reachable" is asked
   * differently of every vendor — a binding call for one, an authenticated
   * request for another. Throws with the vendor's own words on failure, which
   * is what the deploy gate reads to tell an exhausted allowance from a broken
   * deployment.
   */
  ping(): Promise<void>

  /**
   * Which models this deployment could be pointed at, when the vendor can say.
   *
   * Optional because not every provider has an answer — Cloudflare's catalogue
   * is not queryable through the AI binding. Where it exists it turns "the id
   * in your config does not exist" from a guessing game into a lookup, which
   * cost two deploys to learn.
   */
  listModels?(): Promise<readonly string[]>
}

/** Convenience for classifiers, which all match on message text. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? '')
}
