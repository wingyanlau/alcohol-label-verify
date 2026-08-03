/**
 * Waiting out a rate limit.
 *
 * The provider that admits one new browser every 20 seconds refuses in about
 * 40ms, so an immediate redelivery re-attempts far faster than the ceiling
 * allows: the corpus once burned every attempt on all 26 items within seconds
 * and reported the whole batch as failed.
 *
 * The remedy is to wait longer each time — 5s, 10s, 15s — so the schedule
 * crosses the ceiling instead of hammering it. Linear rather than exponential
 * deliberately: the limit is a fixed interval, not congestion, so doubling
 * overshoots into minutes of idle time for no benefit.
 *
 * This module used to also decide WHICH failures were rate limits, by matching
 * one vendor's error strings. That knowledge now lives with the vendor that
 * understands it — see `providers/types.ts` — because pointed at any other
 * provider this file would have called every fault transient and retried a
 * spent allowance eight times.
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
