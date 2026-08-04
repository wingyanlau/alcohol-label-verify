/**
 * What the agent decided (design §18.5).
 *
 * The record has always said what the system found. It said nothing about what
 * a person then did with it, and that omission is larger than it looks: without
 * it there is no ground truth anywhere in the system. Every measure of whether
 * these rules are any good would be the rules marking their own work, and any
 * future automation would be trained on its own recommendations.
 *
 * ---------------------------------------------------------------------------
 * WHY THE RECOMMENDATION IS STORED BESIDE THE DECISION
 *
 * It could be joined from the verdict at read time. It is not, because a
 * correction supersedes a verdict (UC-3), and the join would then report the
 * agent as having responded to a recommendation that did not exist when they
 * decided. What is recorded is what they were looking at.
 *
 * The pair is the signal. Agreement says the rules matched a professional's
 * judgement on that submission; disagreement says either the rules are wrong or
 * the agent knew something the rules cannot see. Both are worth reading, and
 * neither is recoverable later if it was not written down at the time.
 * ---------------------------------------------------------------------------
 */

import type { Outcome } from '../domain/types.js'
import { appendAudit } from './audit.js'

/**
 * What an agent may do with a checked submission.
 *
 * `RETURNED` is distinct from `REJECTED` on purpose: sending an application
 * back for better artwork is not a finding against the applicant, and collapsing
 * the two would make the disagreement statistics meaningless — every unreadable
 * scan would read as the system having been overruled.
 */
export const DECISIONS = ['APPROVED', 'REJECTED', 'RETURNED'] as const

export type DecisionKind = (typeof DECISIONS)[number]

export function isDecision(value: string): value is DecisionKind {
  return (DECISIONS as readonly string[]).includes(value)
}

export interface DecisionRecord {
  readonly id: string
  readonly submissionId: string
  readonly verdictId: string
  /** A named person. An unattributable approval is not an approval. */
  readonly decidedBy: string
  readonly decidedAt: string
  readonly decision: DecisionKind
  /** What the system recommended, as it stood when they decided. */
  readonly recommendedOutcome: Outcome
  readonly note: string | null
}

/** The decision differs from what the system suggested. */
export function isDisagreement(record: {
  decision: DecisionKind
  recommendedOutcome: Outcome
}): boolean {
  // An approval agrees with any outcome that found nothing blocking; anything
  // else is the agent departing from the recommendation. `INCOMPLETE` is not a
  // recommendation to approve, so approving one is a departure too.
  const nothingBlocking =
    record.recommendedOutcome === 'CLEAR' ||
    record.recommendedOutcome === 'CLEAR_CONFIRM_FLAGGED' ||
    record.recommendedOutcome === 'CLEAR_CONFIRM_POLICY'
  return record.decision === 'APPROVED' ? !nothingBlocking : nothingBlocking
}

export class DecisionRejected extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DecisionRejected'
  }
}

/**
 * Refuse a decision that could not be defended.
 *
 * A disagreement without a reason is the case worth stopping. It is the most
 * valuable row in this table — the one that says the rules and a professional
 * parted company — and a blank note makes it unreadable to whoever reviews the
 * rules later, which is the entire purpose of collecting it.
 */
export function checkDecision(input: {
  decision: string
  decidedBy: string
  recommendedOutcome: Outcome
  note: string | null
}): asserts input is { decision: DecisionKind } & typeof input {
  if (!isDecision(input.decision)) {
    throw new DecisionRejected(`"${input.decision}" is not a decision this system records`)
  }
  if (input.decidedBy.trim() === '') {
    throw new DecisionRejected('A decision must name who made it')
  }
  if (
    isDisagreement({ decision: input.decision, recommendedOutcome: input.recommendedOutcome }) &&
    (input.note ?? '').trim() === ''
  ) {
    throw new DecisionRejected(
      'This differs from what the check recommended. Please say why — it is the ' +
        'part a later reviewer of these rules needs.',
    )
  }
}

/**
 * Write the decision and commit it to the audit chain.
 *
 * The row is inserted first and the chain appended after, deliberately. The
 * chain is the tamper-evident history and its append retries on contention
 * (`appendAudit`); an audit entry for a decision that failed to store would be
 * a claim about something that never happened, which is worse in an audit
 * trail than a decision whose chain entry is missing and recoverable from the
 * table it describes.
 *
 * `detail` carries identifiers and classifications only, never a note — a note
 * is free text an agent wrote about an applicant, and D20 keeps that out of the
 * log even when the log is durable.
 */
export async function recordDecision(db: D1Database, record: DecisionRecord): Promise<void> {
  await db
    .prepare(
      `INSERT INTO decision
         (id, submission_id, verdict_id, decided_by, decided_at, decision,
          recommended_outcome, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      record.id,
      record.submissionId,
      record.verdictId,
      record.decidedBy,
      record.decidedAt,
      record.decision,
      record.recommendedOutcome,
      record.note,
    )
    .run()

  await appendAudit(db, {
    at: record.decidedAt,
    actor: record.decidedBy,
    action: 'decision.recorded',
    // A decision happens to a submission. The chain's subject vocabulary is
    // deliberately coarse; the action says what happened.
    subjectType: 'submission',
    subjectId: record.submissionId,
    detail: JSON.stringify({
      decisionId: record.id,
      verdictId: record.verdictId,
      decision: record.decision,
      recommendedOutcome: record.recommendedOutcome,
      agreed: !isDisagreement(record),
    }),
  })
}
