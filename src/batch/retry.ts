/**
 * Holding an item through a rate limit.
 *
 * Returning the message to the queue also returns the *slot*: with one
 * consumer, the next item is picked up while this one waits. Over a corpus
 * that produced a systematic bias rather than a delay — the first eight
 * submissions were attempted during the opening storm, exhausted their
 * attempts against a saturated ceiling, and failed for their position in the
 * queue rather than for anything about them. Later items succeeded because
 * the earlier failures had thinned the contention.
 *
 * So the item waits in place instead. The invocation is held, the queue is not
 * asked for another message, and nothing else is attempted until this
 * submission has had its turn. Waiting costs no CPU — the isolate is idle on a
 * timer — and with `max_concurrency: 1` it is what makes the batch genuinely
 * sequential rather than merely one-at-a-time.
 */

import type { FaultKind } from '../providers/types.js'
import { MAX_ATTEMPTS, retryDelaySeconds } from './backoff.js'

export interface RetryOptions {
  /**
   * How the provider classifies a failure.
   *
   * Passed in rather than imported: which errors mean "wait" is the vendor's
   * knowledge, not the batch layer's.
   */
  readonly classify: (error: unknown) => FaultKind
  /** Injected so tests assert the schedule without serving it (test-plan §17). */
  readonly sleep?: (ms: number) => Promise<void>
  readonly maxAttempts?: number
}

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

/**
 * Run `attempt`, waiting out a rate limit in place.
 *
 * Only a rate limit is waited for. Any other failure is rethrown at once:
 * waiting on a fault that will not clear spends the budget and delays an
 * honest answer.
 */
export async function withRateLimitRetry<T>(
  attempt: () => Promise<T>,
  opts: RetryOptions,
): Promise<T> {
  const sleep = opts.sleep ?? realSleep
  const maxAttempts = opts.maxAttempts ?? MAX_ATTEMPTS

  for (let n = 1; ; n++) {
    try {
      return await attempt()
    } catch (error) {
      if (opts.classify(error) !== 'rate-limited' || n >= maxAttempts) throw error
      await sleep(retryDelaySeconds(n) * 1000)
    }
  }
}
