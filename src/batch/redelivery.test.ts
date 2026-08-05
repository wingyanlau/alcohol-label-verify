/**
 * At-least-once delivery, and the second verdict it produced.
 *
 * Cloudflare Queues redelivers a message whose consumer did not acknowledge in
 * time — including when the work succeeded and the acknowledgement was what ran
 * late. Nothing in the item worker checked, so the whole pipeline ran again:
 * two more model calls, and a SECOND verdict for a submission that already had
 * one, neither superseding the other.
 *
 * That is a contradiction the design otherwise forbids. A correction supersedes
 * a verdict (UC-3); it never duplicates it, and two rows with `superseded_by IS
 * NULL` for one submission leave "the current verdict" undefined.
 *
 * **Observed, not anticipated.** It appeared on the first corpus run after the
 * batch began reading the record page as well as the label (D51). Per-item
 * latency roughly doubled, the slowest items crossed the acknowledgement
 * window, and two of them — L06 and L14 — came back with two verdicts each.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isAlreadySettled } from './pipeline.js'

describe('a redelivered message', () => {
  it('is dropped when the submission already reached an outcome', () => {
    expect(isAlreadySettled('COMPLETED')).toBe(true)
    expect(isAlreadySettled('REJECTED')).toBe(true)
  })

  it('is NOT dropped while the first attempt is still in flight', () => {
    // The subtle case. A redelivery arriving mid-attempt must be allowed
    // through: the first attempt may yet fail, and dropping the second would
    // leave the submission with no verdict at all — trading a duplicate for a
    // silent omission, which is the worse of the two.
    expect(isAlreadySettled('RUNNING')).toBe(false)
    expect(isAlreadySettled('QUEUED')).toBe(false)
  })

  it('is NOT dropped for a submission that failed', () => {
    // A failure is retryable by design (B-D14). Treating it as settled would
    // turn a transient provider fault into a permanent gap.
    expect(isAlreadySettled('FAILED')).toBe(false)
    expect(isAlreadySettled(null)).toBe(false)
  })
})

describe('where the check sits', () => {
  /*
   * Placement is the property, not the predicate. Checking after the work has
   * begun would cost the model calls this exists to prevent, and would still
   * write the duplicate verdict.
   */
  const source = readFileSync('src/batch/pipeline.ts', 'utf8')

  /**
   * The CALL, not the declaration.
   *
   * The first version of this test searched for `isAlreadySettled(` and found
   * the exported function's own definition near the top of the file — an index
   * that is always small, so the ordering assertions passed no matter where the
   * guard actually sat. Moving the guard after `startItem` did not fail it.
   * A test that cannot fail is worse than no test, because it is counted.
   */
  const callSite = source.indexOf('if (isAlreadySettled(')

  it('is called, not merely declared', () => {
    expect(callSite, 'no call site found').toBeGreaterThan(-1)
  })

  it('runs before the item is marked started', () => {
    const start = source.indexOf('stub.startItem(')
    expect(start).toBeGreaterThan(-1)
    expect(callSite, 'the guard must precede startItem').toBeLessThan(start)
  })

  it('runs before anything is rasterised or read', () => {
    // Placement is the property. Checking after the work began would cost the
    // model calls this exists to prevent, and still write the duplicate.
    expect(callSite).toBeLessThan(source.indexOf('rasteriseSubmission('))
    expect(callSite).toBeLessThan(source.indexOf('verifySubmission('))
  })
})
