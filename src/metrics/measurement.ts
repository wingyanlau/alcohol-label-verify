/**
 * What this deployment has actually done, and what it cost (D52).
 *
 * §16 opens by saying a criterion without a measurement is an intention rather
 * than a claim — and then S1 (p95 ≤ 5s) went unmeasured by the product itself,
 * knowable only by watching a page and counting. Everything here comes from the
 * record: durations that were always stored, and token counts that were in
 * every vendor response and thrown away until D52.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT IS CAREFUL NOT TO CLAIM
 *
 * **The verdict timings are the domain's stages, not the wall clock.** They
 * cover the reads and the comparison. Rasterisation, queue wait and the round
 * trip to a browser are outside them, so this is a *floor* on what an agent
 * experiences. It is reported as such rather than as "total time", because a
 * figure that silently omits the slowest stage flatters, and a flattering
 * metric is one nobody re-checks.
 *
 * **Nothing here counts a person.** Reads, models, durations and tokens — the
 * machines and the system. Per-agent throughput is what D47 defers, and a
 * metrics surface is exactly where it would arrive by accident.
 *
 * **Content never appears** (D20). Counts, identifiers and durations only.
 */

import type { Distribution } from './percentile.js'
import { meets, summarise } from './percentile.js'

/** §16, S1. The threshold the prototype is held to. */
export const P95_TARGET_MS = 5000

/**
 * How many recent reads to draw the distributions from.
 *
 * Bounded because this runs on every request to the page and the table grows
 * without limit. Reported alongside the figures so a reader can see the
 * window rather than assume it is all of history.
 */
export const SAMPLE_LIMIT = 2000

export interface ReadStats {
  readonly region: string
  readonly latency: Distribution
  /** Reads whose vendor reported a token count. Never inferred from silence. */
  readonly tokensReported: number
}

export interface ModelCost {
  readonly provider: string
  readonly modelId: string
  readonly reads: number
  readonly reported: number
  readonly promptTokens: number | null
  readonly completionTokens: number | null
  readonly totalTokens: number | null
}

export interface Measurement {
  readonly reads: readonly ReadStats[]
  /**
   * Verification time, split by the path it came from — and the split is the
   * point rather than a refinement.
   *
   * S1 is about **a person waiting**, and only one of the two paths makes them
   * wait. Batch checks filings as they arrive, so its timings are a throughput
   * property: nobody is watching them. Judging batch runs against a latency
   * target reports a system as failing a criterion that criterion was never
   * about — which is what this screen did until the two were separated.
   */
  readonly verification: {
    /** Single review: an agent is watching. The target applies as written. */
    readonly interactive: Distribution
    /** Batch: nobody waits. Reported for capacity, not as a promise. */
    readonly batch: Distribution
    readonly total: Distribution
    readonly extract: Distribution
    readonly compare: Distribution
    /**
     * Against S1, computed from the **interactive** path alone.
     *
     * Null where no interactive review has been recorded — which is not a pass
     * and not a failure. A deployment whose worklist was prepared in batch has
     * simply not exercised the criterion yet.
     */
    readonly meetsTarget: boolean | null
    readonly targetMs: number
  }
  readonly cost: readonly ModelCost[]
  readonly window: {
    readonly sampleLimit: number
    readonly note: string
  }
}

interface LatencyRow {
  region: string
  latency_ms: number
  total_tokens: number | null
}
interface TimingRow {
  extract_ms: number | null
  compare_ms: number | null
  total_ms: number | null
  kind: string | null
}
interface CostRow {
  provider: string | null
  model_id: string | null
  reads: number
  reported: number
  prompt_tokens: number | null
  completion_tokens: number | null
  total_tokens: number | null
}

const numbers = (rows: readonly (number | null)[]): number[] =>
  rows.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))

export async function loadMeasurement(db: D1Database): Promise<Measurement> {
  const latency = (
    await db
      .prepare(
        `SELECT region, latency_ms, total_tokens
           FROM extraction
          ORDER BY created_at DESC
          LIMIT ?`,
      )
      .bind(SAMPLE_LIMIT)
      .all<LatencyRow>()
  ).results

  const timings = (
    await db
      .prepare(
        `SELECT v.extract_ms, v.compare_ms, v.total_ms, j.kind
           FROM verdict v
           JOIN submission s ON s.id = v.submission_id
           JOIN job j        ON j.id = s.job_id
          WHERE v.total_ms IS NOT NULL
          ORDER BY v.created_at DESC
          LIMIT ?`,
      )
      .bind(SAMPLE_LIMIT)
      .all<TimingRow>()
  ).results

  // Grouped in SQL rather than in JS: the totals are over ALL reads, not over
  // the sampled window, because a bill is not a sample. The distributions above
  // are windowed and say so; these are not and must not be.
  const cost = (
    await db
      .prepare(
        `SELECT provider,
                model_id,
                COUNT(*)                AS reads,
                COUNT(total_tokens)     AS reported,
                SUM(prompt_tokens)      AS prompt_tokens,
                SUM(completion_tokens)  AS completion_tokens,
                SUM(total_tokens)       AS total_tokens
           FROM extraction
          GROUP BY provider, model_id
          ORDER BY reads DESC`,
      )
      .all<CostRow>()
  ).results

  const regions = [...new Set(latency.map((r) => r.region))].sort()
  const total = summarise(numbers(timings.map((t) => t.total_ms)))
  const interactive = summarise(
    numbers(timings.filter((t) => t.kind === 'single').map((t) => t.total_ms)),
  )
  const batch = summarise(
    numbers(timings.filter((t) => t.kind !== 'single').map((t) => t.total_ms)),
  )

  return {
    reads: regions.map((region) => {
      const of = latency.filter((r) => r.region === region)
      return {
        region,
        latency: summarise(numbers(of.map((r) => r.latency_ms))),
        tokensReported: of.filter((r) => r.total_tokens !== null).length,
      }
    }),
    verification: {
      interactive,
      batch,
      total,
      extract: summarise(numbers(timings.map((t) => t.extract_ms))),
      compare: summarise(numbers(timings.map((t) => t.compare_ms))),
      // The interactive path only. `meets` already returns null on an empty
      // distribution, so a deployment that has only run batches reports "not
      // exercised" rather than a pass or a failure it has not earned.
      meetsTarget: meets(interactive, P95_TARGET_MS),
      targetMs: P95_TARGET_MS,
    },
    cost: cost.map((c) => ({
      provider: c.provider ?? 'unrecorded',
      modelId: c.model_id ?? 'unrecorded',
      reads: c.reads,
      reported: c.reported,
      // Null rather than 0 where no read reported anything: SUM over an
      // all-NULL column is NULL in SQLite, and that is the honest answer.
      promptTokens: c.prompt_tokens,
      completionTokens: c.completion_tokens,
      totalTokens: c.total_tokens,
    })),
    window: {
      sampleLimit: SAMPLE_LIMIT,
      note:
        `Distributions are drawn from the most recent ${SAMPLE_LIMIT} reads. ` +
        'Token totals are over every read ever recorded — a bill is not a sample. ' +
        'Verification time covers the reads and the comparison; rasterisation and ' +
        'queue wait are outside it, so it is a floor on what an agent experiences. ' +
        'The five-second target is about a person waiting, so it is judged on single ' +
        'review alone — batch checks filings as they arrive and nobody watches it.',
    },
  }
}
