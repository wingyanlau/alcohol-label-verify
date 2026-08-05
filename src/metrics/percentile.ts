/**
 * Percentiles, and the honesty they need to be worth reporting.
 *
 * Design §16 states S1 as **p95 ≤ 5 seconds**, measured against a manual review
 * that takes five to ten minutes. A criterion nothing computes is an intention
 * rather than a claim, and this is the arithmetic that turns it back into one.
 *
 * Pure, and separate from the query that feeds it, for the usual reason: the
 * part that can be wrong in a way nobody notices is the arithmetic.
 */

export interface Distribution {
  readonly count: number
  readonly p50: number | null
  readonly p95: number | null
  readonly max: number | null
}

/**
 * The nearest-rank percentile.
 *
 * Chosen over interpolation deliberately: every value here is a duration that
 * actually happened, and nearest-rank returns one of them. An interpolated p95
 * is a number no submission ever took, which is a strange thing to hold a
 * system to.
 */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  // Rank is 1-based, hence the -1. Math.ceil puts p100 on the last element and
  // any p above zero on at least the first.
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length))
  return sorted[Math.min(rank, sorted.length) - 1] ?? null
}

/**
 * Summarise a set of durations.
 *
 * **A small sample is reported, not smoothed.** `count` travels with every
 * distribution so a p95 drawn from four readings is visibly a p95 drawn from
 * four readings. Suppressing it below some threshold would leave a blank where
 * a reader expects a number and tell them nothing about why.
 */
export function summarise(values: readonly number[]): Distribution {
  return {
    count: values.length,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    max: values.length === 0 ? null : Math.max(...values),
  }
}

/**
 * Whether a distribution meets a stated target.
 *
 * `null` where there is nothing to judge — no readings at all, or no p95. An
 * empty sample is not a pass, and reporting one as met is how a criterion
 * becomes decoration.
 */
export function meets(distribution: Distribution, targetMs: number): boolean | null {
  if (distribution.p95 === null) return null
  return distribution.p95 <= targetMs
}
