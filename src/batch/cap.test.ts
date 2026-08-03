/**
 * ADV-06 — a batch larger than the configured cap is refused, with the limit
 * stated.
 *
 * The cap existed as configuration and as a startup validation, and was never
 * consulted by anything. `MAX_BATCH_ITEMS` said 300 while the code would have
 * accepted any number — a limit that is declared, validated, reported in
 * `/health`, and unenforced is the most misleading kind, because every
 * signal says it is protecting you.
 */

import { describe, expect, it } from 'vitest'
import { BatchTooLarge, checkBatchSize } from './cap.js'

describe('the batch cap', () => {
  it('accepts a batch at the limit', () => {
    // The boundary belongs to the permitted side: a cap of 300 means 300 is
    // allowed, not 299.
    expect(() => checkBatchSize(300, 300)).not.toThrow()
  })

  it('refuses a batch above the limit', () => {
    expect(() => checkBatchSize(301, 300)).toThrow(BatchTooLarge)
  })

  it('states the limit and what was submitted', () => {
    // An agent who is told "too many" and not "too many out of what" has to
    // guess how much to remove (ui-design §9.2).
    try {
      checkBatchSize(450, 300)
      throw new Error('expected a rejection')
    } catch (error) {
      expect(error).toBeInstanceOf(BatchTooLarge)
      const message = (error as BatchTooLarge).message
      expect(message).toContain('450')
      expect(message).toContain('300')
      expect(message).not.toMatch(/invalid|failed|error/i)
    }
  })

  it('refuses an empty batch rather than opening a job with nothing in it', () => {
    // A job with no items never completes and never fails: it sits at zero of
    // zero, and because starting joins a job in flight, every later batch
    // attaches to it (B-D15).
    expect(() => checkBatchSize(0, 300)).toThrow(BatchTooLarge)
  })

  // An unusable cap must not silently become "no cap". This is the same rule
  // the retention window and the legibility floor follow.
  it('refuses to run at all when the cap is not configured', () => {
    expect(() => checkBatchSize(10, Number.NaN)).toThrow(BatchTooLarge)
    expect(() => checkBatchSize(10, 0)).toThrow(BatchTooLarge)
  })
})
