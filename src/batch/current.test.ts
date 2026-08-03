import { describe, expect, it } from 'vitest'
import { isRunning, type JobStateCounts } from './current.js'

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
