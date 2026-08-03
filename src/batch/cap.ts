/**
 * How large a batch may be (ADV-06).
 *
 * `MAX_BATCH_ITEMS` was configuration from the beginning, was validated at
 * startup, and was reported by `/health` — and nothing ever consulted it. A
 * limit that is declared, checked and unenforced is the most misleading kind
 * there is: every signal in the system says it is protecting you.
 *
 * The bound is not arbitrary. A job fans out one queue message per submission
 * and one browser launch per item that needs rasterising, so an unbounded
 * batch is an unbounded bill and an unbounded wait for whoever is watching the
 * worklist — and B-D11 says the honest failure of an open batch endpoint is
 * an invoice.
 */

/** Refused before any work begins, so nothing is staged, queued or charged. */
export class BatchTooLarge extends Error {
  constructor(
    readonly reason: 'too-many' | 'empty' | 'unconfigured',
    message: string,
  ) {
    super(message)
    this.name = 'BatchTooLarge'
  }
}

/**
 * Check a batch against the configured cap.
 *
 * Throws rather than returning a flag, because every caller's correct response
 * is to abandon the job, and a boolean invites one of them not to.
 */
export function checkBatchSize(count: number, max: number): void {
  // An unusable cap is not "no cap". The same rule the retention window and
  // the legibility floor follow: a limit nobody configured must not quietly
  // become unlimited, because the failure is silent and the bill is not.
  if (!Number.isFinite(max) || max <= 0) {
    throw new BatchTooLarge(
      'unconfigured',
      'The batch size limit is not configured, so no batch can be accepted. ' +
        'Set MAX_BATCH_ITEMS.',
    )
  }

  // A job with nothing in it never completes and never fails — it sits at zero
  // of zero for ever, and because starting a batch joins a job in flight,
  // every later batch attaches to the corpse (B-D15).
  if (count <= 0) {
    throw new BatchTooLarge('empty', 'There is nothing to check in this batch.')
  }

  // The boundary belongs to the permitted side: a cap of 300 means 300 is
  // allowed. Off-by-one here rejects a submission that was within the stated
  // limit, which is indefensible to whoever read the limit.
  if (count > max) {
    throw new BatchTooLarge(
      'too-many',
      `This batch has ${count} submissions. The limit is ${max} at a time — ` +
        'please split it and send the rest separately.',
    )
  }
}
