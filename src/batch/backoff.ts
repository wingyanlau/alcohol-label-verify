/**
 * Waiting out a rate limit.
 *
 * Browser Rendering admits one new browser every 20 seconds on this account.
 * A 429 is refused in about 40ms, so an immediate redelivery re-attempts far
 * faster than the ceiling allows: the corpus burned all three attempts on all
 * 26 items within seconds and reported the whole batch as failed.
 *
 * The remedy is to wait longer each time — 5s, 10s, 15s — so the schedule
 * crosses the ceiling instead of hammering it. Linear rather than exponential
 * deliberately: the limit is a fixed interval, not congestion, so doubling
 * overshoots into minutes of idle time for no benefit.
 *
 * This paces one item's attempts. It does not govern the aggregate rate across
 * items, which is what the provider actually measures — `max_concurrency: 1`
 * is the other half, and the two together are what keep launches apart.
 */

/** The first wait, and the increment between attempts. */
const STEP_SECONDS = 5

/**
 * Attempts allowed before an item is recorded as failed.
 *
 * Eight reaches a 40 second wait, comfortably past the 20 second ceiling, and
 * must not exceed `max_retries` on the queue consumer — the queue stops
 * redelivering at its own limit regardless of what this says.
 */
export const MAX_ATTEMPTS = 8

/** How long to wait before attempt `attempt + 1`. */
export function retryDelaySeconds(attempt: number): number {
  const n = attempt < 1 ? 1 : attempt
  return n * STEP_SECONDS
}

/**
 * Whether a failure is the provider refusing on rate, rather than refusing on
 * the input. Matched on the message because the launch failure arrives as a
 * plain Error with the status embedded in its text — there is nothing typed to
 * match on.
 */
export function isRateLimited(error: unknown): boolean {
  const message = messageOf(error)
  if (isQuotaExhausted(error)) return false
  return /\b429\b/.test(message) || /rate limit/i.test(message)
}

/**
 * Whether the account's inference allowance is spent, rather than merely
 * being served too fast.
 *
 * Workers AI reports 4006 when the day's neurons are gone. The distinction
 * from a rate limit is the whole point: a rate limit clears by waiting, and an
 * allowance does not clear before tomorrow. Treating this as transient would
 * spend the rest of the queue rediscovering the same dead end, once per
 * submission, and leave a reviewer with 26 failures that look like a broken
 * tool rather than an exhausted budget.
 */
export function isQuotaExhausted(error: unknown): boolean {
  const message = messageOf(error)
  return (
    /\b4006\b/.test(message) ||
    /daily free allocation/i.test(message) ||
    /neurons?\b[^.]*\bexhaust/i.test(message)
  )
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? '')
}
