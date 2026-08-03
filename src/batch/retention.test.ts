/**
 * B-D10 / D32 — content is kept for a stated window, then deleted.
 *
 * The window is the part worth testing. "Delete eventually" is what a TTL
 * gives you and what B-D10 rejected; the claim here is that deletion happens
 * on a boundary the deployment states, and that it is recorded when it does.
 */

import { describe, expect, it } from 'vitest'
import {
  type PurgeCandidate,
  purgeContent,
  purgeCutoff,
  RETENTION_POLICY,
  REVIEW_WINDOW_DAYS,
} from './retention.js'

const AT = new Date('2026-08-03T12:00:00.000Z')

/** Enough of R2 to observe what was deleted, and to fail the way R2 fails. */
function fakeBucket(opts: { failOn?: string } = {}) {
  const deleted: string[] = []
  return {
    deleted,
    async delete(key: string) {
      if (key === opts.failOn) throw new Error('R2 unavailable')
      deleted.push(key)
    },
  }
}

const candidate = (n: number): PurgeCandidate => ({
  submissionId: `sub-${n}`,
  jobId: 'job-1',
  contentKey: `job-1/sub-${n}.pdf`,
})

describe('the retention window', () => {
  it('is stated, not implied', () => {
    expect(REVIEW_WINDOW_DAYS).toBeGreaterThan(0)
    // The policy string is what the deployment publishes about itself (D32).
    // It has to name both halves — what goes and what stays — because the
    // difference between them is the whole privacy claim.
    expect(RETENTION_POLICY).toContain(String(REVIEW_WINDOW_DAYS))
    expect(RETENTION_POLICY).not.toContain('UNSET')
  })

  it('puts the cutoff a full window behind now', () => {
    const cutoff = new Date(purgeCutoff(AT))
    expect(AT.getTime() - cutoff.getTime()).toBe(REVIEW_WINDOW_DAYS * 86_400_000)
  })

  it('does not purge a job started inside the window', () => {
    // The boundary in the direction that matters: purging early destroys the
    // evidence a reviewer is in the middle of adjudicating.
    const justInside = new Date(AT.getTime() - (REVIEW_WINDOW_DAYS - 1) * 86_400_000)
    expect(justInside.toISOString() > purgeCutoff(AT)).toBe(true)
  })
})

describe('purging content', () => {
  it('deletes both objects for a submission, not just the source', async () => {
    // The label crop is content too. Deleting the PDF and leaving the crop
    // would satisfy the letter of the policy and retain the artwork.
    const r2 = fakeBucket()
    const result = await purgeContent(r2 as never, [candidate(1)])
    expect(r2.deleted.sort()).toEqual(['job-1/sub-1-label.png', 'job-1/sub-1.pdf'])
    expect(result.purged).toBe(1)
    expect(result.objectsDeleted).toBe(2)
  })

  it('reports which submissions were purged, so the record can be marked', async () => {
    const r2 = fakeBucket()
    const result = await purgeContent(r2 as never, [candidate(1), candidate(2)])
    expect(result.submissionIds).toEqual(['sub-1', 'sub-2'])
  })

  // A submission rejected at intake never had a PDF staged. Its crop still
  // might not exist either — deleting an absent key is not an error in R2, and
  // must not be one here.
  it('handles a submission that never had staged content', async () => {
    const r2 = fakeBucket()
    const result = await purgeContent(r2 as never, [
      { submissionId: 'sub-9', jobId: 'job-1', contentKey: null },
    ])
    expect(result.purged).toBe(1)
    expect(r2.deleted).toEqual(['job-1/sub-9-label.png'])
  })

  // The failure that matters: if deletion fails, the row must NOT be marked
  // purged. Marking it would strand the object permanently — nothing would
  // ever look at it again, and the content would outlive the policy silently.
  it('does not claim to have purged a submission whose delete failed', async () => {
    const r2 = fakeBucket({ failOn: 'job-1/sub-1.pdf' })
    const result = await purgeContent(r2 as never, [candidate(1), candidate(2)])
    expect(result.submissionIds).toEqual(['sub-2'])
    expect(result.purged).toBe(1)
  })

  it('purges nothing when nothing is due', async () => {
    const r2 = fakeBucket()
    const result = await purgeContent(r2 as never, [])
    expect(result).toEqual({ purged: 0, objectsDeleted: 0, submissionIds: [] })
  })
})
