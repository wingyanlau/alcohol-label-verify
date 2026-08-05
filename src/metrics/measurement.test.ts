/**
 * The measurement surface, against real SQL and the real migrations.
 *
 * The properties worth pinning are about what the numbers *claim*, and each one
 * fails in the flattering direction if it goes wrong:
 *
 *  - an unreported token count summing as zero, understating a bill;
 *  - a fresh deployment reporting that it meets its latency target;
 *  - a windowed sample presented as a total.
 *
 * Run over `node:sqlite` with every migration applied, because half of this is
 * a claim about the schema: the columns exist, they accept NULL, and SUM over
 * an all-NULL column stays NULL rather than becoming 0.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { loadMeasurement, P95_TARGET_MS } from './measurement.js'

const MIGRATIONS = [
  '0001_init',
  '0002_verdict_legibility',
  '0003_submission_reference_code',
  '0004_retention_policy',
  '0005_policy_layer',
  '0006_job_kind',
  '0007_policy_archive',
  '0008_verdict_bitemporal',
  '0009_agent',
  '0010_finding_source',
  '0011_measurement',
]

function fakeD1(): D1Database & { raw: DatabaseSync } {
  const db = new DatabaseSync(':memory:')
  for (const name of MIGRATIONS) {
    db.exec(readFileSync(join(process.cwd(), 'migrations', `${name}.sql`), 'utf8'))
  }
  // A submission belongs to a job. Foreign keys are on, as they are in D1, so
  // the fixture has to build a real row graph rather than an isolated table.
  db.exec(
    `INSERT INTO job (id, created_at, state, item_count)
     VALUES ('job', '2026-08-05T00:00:00.000Z', 'COMPLETE', 0)`,
  )
  const prepare = (sql: string) => {
    let bound: unknown[] = []
    const stmt = {
      bind: (...args: unknown[]) => {
        bound = args
        return stmt
      },
      all: async <T>() => ({ results: db.prepare(sql).all(...(bound as never[])) as T[] }),
      first: async <T>() => (db.prepare(sql).get(...(bound as never[])) ?? null) as T | null,
      run: async () => {
        db.prepare(sql).run(...(bound as never[]))
        return { meta: { changes: 1 } }
      },
    }
    return stmt
  }
  return { prepare, raw: db } as unknown as D1Database & { raw: DatabaseSync }
}

/** One read, with whatever the vendor did or did not report. */
function insertRead(
  db: DatabaseSync,
  o: {
    id: string
    region: 'label' | 'record'
    latencyMs: number
    provider?: string
    modelId?: string
    tokens?: { prompt: number; completion: number; total: number } | null
  },
) {
  db.prepare(
    `INSERT INTO submission (id, job_id, source_name, content_digest, byte_size, state, created_at)
     VALUES (?, 'job', 'x.pdf', 'd', 1, 'COMPLETED', '2026-08-05T00:00:00.000Z')`,
  ).run(`sub-${o.id}`)
  db.prepare(
    `INSERT INTO extraction
       (id, submission_id, region, method, provider, model_id, prompt_version, sampling,
        raw_response, latency_ms, created_at, prompt_tokens, completion_tokens, total_tokens)
     VALUES (?, ?, ?, 'vision', ?, ?, 'p@1', '{}', '{}', ?, '2026-08-05T00:00:00.000Z', ?, ?, ?)`,
  ).run(
    o.id,
    `sub-${o.id}`,
    o.region,
    o.provider ?? 'gemini',
    o.modelId ?? 'gemini-3.5-flash',
    o.latencyMs,
    o.tokens?.prompt ?? null,
    o.tokens?.completion ?? null,
    o.tokens?.total ?? null,
  )
}

function insertVerdict(db: DatabaseSync, id: string, totalMs: number | null, kind = 'batch') {
  db.exec(
    `INSERT OR IGNORE INTO job (id, created_at, state, item_count, kind)
     VALUES ('job-${kind}', '2026-08-05T00:00:00.000Z', 'COMPLETE', 0, '${kind}')`,
  )
  db.prepare(
    `INSERT INTO submission (id, job_id, source_name, content_digest, byte_size, state, created_at)
     VALUES (?, ?, 'x.pdf', 'd', 1, 'COMPLETED', '2026-08-05T00:00:00.000Z')`,
  ).run(`vsub-${id}`, `job-${kind}`)
  db.prepare(
    `INSERT INTO verdict
       (id, submission_id, outcome, ruleset_version, reference_data_version, policy_version,
        aggregation_version, extraction_ids, created_at, extract_ms, compare_ms, total_ms)
     VALUES (?, ?, 'CLEAR', 'r@1', 1, 'p@1', 'a@1', '[]', '2026-08-05T00:00:00.000Z', ?, ?, ?)`,
  ).run(id, `vsub-${id}`, totalMs === null ? null : totalMs - 2, 2, totalMs)
}

describe('the measurement surface', () => {
  it('reports nothing rather than a pass before anything has been checked', async () => {
    // The failure this prevents: a deployment that has issued no verdict at all
    // showing that it meets its latency target.
    const d1 = fakeD1()
    const m = await loadMeasurement(d1)
    expect(m.verification.meetsTarget).toBeNull()
    expect(m.verification.total.count).toBe(0)
    expect(m.reads).toEqual([])
    expect(m.cost).toEqual([])
  })

  it('judges the stated target against p95, not the average', async () => {
    const d1 = fakeD1()
    // Four fast and one very slow: the mean passes, the p95 does not.
    for (const [i, ms] of [400, 500, 600, 700, 30_000].entries()) {
      insertVerdict(d1.raw, `v${i}`, ms, 'single')
    }
    const m = await loadMeasurement(d1)
    expect(m.verification.targetMs).toBe(P95_TARGET_MS)
    expect(m.verification.meetsTarget).toBe(false)
  })

  it('judges the target on single review alone, not on batch runs', async () => {
    /*
     * The defect this fixes, seen on the deployed screen: a worklist prepared
     * in batch produced a p95 of twenty seconds, and the page reported the
     * stated criterion as FAILED. Nobody waited for any of it — the target is
     * about a person waiting, and batch checks filings as they arrive.
     */
    const d1 = fakeD1()
    for (const [i, ms] of [20_000, 23_000, 18_000, 2500, 2600].entries()) {
      insertVerdict(d1.raw, `b${i}`, ms, 'batch')
    }
    for (const [i, ms] of [2100, 2400, 2600].entries()) {
      insertVerdict(d1.raw, `s${i}`, ms, 'single')
    }
    const m = await loadMeasurement(d1)
    expect(m.verification.batch.count).toBe(5)
    expect(m.verification.interactive.count).toBe(3)
    // Judged on the three interactive reviews, all of which are inside target.
    expect(m.verification.meetsTarget).toBe(true)
    // And the batch numbers are still reported — for capacity, not as a promise.
    expect(m.verification.batch.max).toBe(23_000)
  })

  it('reports the target as unexercised when only batches have run', async () => {
    // Not a pass and not a failure. A deployment whose worklist was prepared
    // in batch has simply not put a person in front of the wait yet.
    const d1 = fakeD1()
    insertVerdict(d1.raw, 'b0', 20_000, 'batch')
    const m = await loadMeasurement(d1)
    expect(m.verification.meetsTarget).toBeNull()
    expect(m.verification.batch.count).toBe(1)
  })

  it('separates the two reads, because they are different work', async () => {
    // The label is artwork with a warning statement in small type; the record
    // is a form. Averaging them hides which one is slow.
    const d1 = fakeD1()
    insertRead(d1.raw, { id: 'a', region: 'label', latencyMs: 3000 })
    insertRead(d1.raw, { id: 'b', region: 'record', latencyMs: 800 })
    const m = await loadMeasurement(d1)
    expect(m.reads.map((r) => r.region)).toEqual(['label', 'record'])
    expect(m.reads.find((r) => r.region === 'label')?.latency.p50).toBe(3000)
    expect(m.reads.find((r) => r.region === 'record')?.latency.p50).toBe(800)
  })

  it('never sums an unreported token count as zero', async () => {
    // SUM over an all-NULL column is NULL in SQLite, and that must survive to
    // the surface. A zero would say these reads were free, and a cost report
    // that understates is worse than one that is visibly incomplete.
    const d1 = fakeD1()
    insertRead(d1.raw, { id: 'a', region: 'label', latencyMs: 100, tokens: null })
    insertRead(d1.raw, { id: 'b', region: 'record', latencyMs: 100, tokens: null })
    const m = await loadMeasurement(d1)
    expect(m.cost).toHaveLength(1)
    expect(m.cost[0]?.totalTokens).toBeNull()
    expect(m.cost[0]?.reads).toBe(2)
    expect(m.cost[0]?.reported).toBe(0)
  })

  it('says how many reads actually reported a count', async () => {
    // Two reads, one counted. A total of 1500 next to "2 reads" would read as
    // the cost of both.
    const d1 = fakeD1()
    insertRead(d1.raw, {
      id: 'a',
      region: 'label',
      latencyMs: 100,
      tokens: { prompt: 1400, completion: 100, total: 1500 },
    })
    insertRead(d1.raw, { id: 'b', region: 'record', latencyMs: 100, tokens: null })
    const m = await loadMeasurement(d1)
    expect(m.cost[0]?.reads).toBe(2)
    expect(m.cost[0]?.reported).toBe(1)
    expect(m.cost[0]?.totalTokens).toBe(1500)
  })

  it('totals cost per model, so two readers can be compared', async () => {
    // B-Q4 asks which model reads a 4.5pt warning best. "Best" has a price.
    const d1 = fakeD1()
    insertRead(d1.raw, {
      id: 'a',
      region: 'label',
      latencyMs: 100,
      provider: 'workers-ai',
      modelId: '@cf/meta/llama-4-scout-17b-16e-instruct',
      tokens: { prompt: 900, completion: 50, total: 950 },
    })
    insertRead(d1.raw, {
      id: 'b',
      region: 'label',
      latencyMs: 100,
      provider: 'gemini',
      modelId: 'gemini-3.5-flash',
      tokens: { prompt: 1200, completion: 60, total: 1260 },
    })
    const m = await loadMeasurement(d1)
    expect(m.cost).toHaveLength(2)
    expect(m.cost.map((c) => c.provider).sort()).toEqual(['gemini', 'workers-ai'])
  })

  it('states the window rather than implying it is everything', async () => {
    const d1 = fakeD1()
    const m = await loadMeasurement(d1)
    expect(m.window.note).toMatch(/most recent/i)
    // And is explicit that the timing excludes stages an agent does experience.
    expect(m.window.note).toMatch(/rasterisation and\s+queue wait are outside it/i)
  })
})
