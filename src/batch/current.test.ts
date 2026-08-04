import { describe, expect, it } from 'vitest'
import { isRunning, type JobStateCounts, loadCurrentJob } from './current.js'

const counts = (over: Partial<JobStateCounts> = {}): JobStateCounts => ({
  queued: 0,
  running: 0,
  settled: 0,
  ...over,
})

describe('current job — is a batch still running', () => {
  // The `job` row records PROCESSING at intake and is never updated, so it
  // cannot answer this. The submissions can, and they are the same rows the
  // worklist is drawn from — one source of truth rather than two.
  it('is running while any item is still queued', () => {
    expect(isRunning(counts({ queued: 18, settled: 8 }))).toBe(true)
  })

  it('is running while any item is in flight', () => {
    expect(isRunning(counts({ running: 1, settled: 25 }))).toBe(true)
  })

  it('is not running once every item has settled', () => {
    expect(isRunning(counts({ settled: 26 }))).toBe(false)
  })

  // A batch whose items all failed is finished, not running. The earlier
  // stall showed the opposite reading is dangerous: 26 dead items left the
  // page saying "waiting" indefinitely.
  it('is not running when every item settled as a failure', () => {
    expect(isRunning(counts({ settled: 26 }))).toBe(false)
  })

  // Defensive: a job row with no submissions at all is not a running batch.
  // Reporting it as running would wedge the page on an empty worklist.
  it('is not running when the job has no items', () => {
    expect(isRunning(counts())).toBe(false)
  })
})

/**
 * Which job the batch screen adopts.
 *
 * This had no test, and the gap was not academic: `/review` inserts a job of
 * one — every review needs an audit record and the record hangs off a job — and
 * the query took the newest job of ANY kind. So performing a single review
 * replaced the corpus on the batch screen with a one-item worklist, twice
 * reported as the 26 test cases having disappeared.
 *
 * Nothing had disappeared. The page was faithfully showing the job it was
 * handed, which is why no amount of looking at the rendering found it.
 */
describe('the job the batch screen adopts', () => {
  /** Records the SQL it is asked for, and answers as D1 would. */
  const db = (rows: Record<string, unknown> | null) => {
    const asked: string[] = []
    const stub = {
      asked,
      prepare(sql: string) {
        asked.push(sql.replace(/\s+/g, ' ').trim())
        return {
          bind: () => ({ first: async () => rows }),
          first: async () => rows,
        }
      },
    }
    return stub
  }

  it('asks only for batch jobs, never a single review', async () => {
    const stub = db({ id: 'batch-1', queued: 0, running: 0, settled: 26 })
    await loadCurrentJob(stub as unknown as D1Database)
    // The first statement is the one that chooses the job.
    expect(stub.asked[0]).toMatch(/FROM job/)
    expect(stub.asked[0]).toMatch(/kind = 'batch'/)
  })

  it('still takes the most recent of them', async () => {
    const stub = db({ id: 'batch-1', queued: 0, running: 0, settled: 26 })
    await loadCurrentJob(stub as unknown as D1Database)
    expect(stub.asked[0]).toMatch(/ORDER BY created_at DESC/)
  })

  it('reports no job when none has ever been run', async () => {
    // Not an empty worklist — no job at all, so the page shows its start
    // button rather than a batch of nothing.
    expect(await loadCurrentJob(db(null) as unknown as D1Database)).toBeNull()
  })

  it('carries the counts through for the job it chose', async () => {
    const stub = db({ id: 'batch-1', queued: 2, running: 1, settled: 23 })
    const current = await loadCurrentJob(stub as unknown as D1Database)
    expect(current?.jobId).toBe('batch-1')
    expect(current?.counts).toEqual({ queued: 2, running: 1, settled: 23 })
    expect(current?.running).toBe(true)
  })
})
