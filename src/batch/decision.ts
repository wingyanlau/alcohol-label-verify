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
import { humanAgent } from './agent.js'
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
/**
 * Whether this verdict has already been decided.
 *
 * Asked per VERDICT, not per submission, and the distinction is the whole
 * point. A correction supersedes a verdict (UC-3), producing a new one that
 * genuinely needs deciding again; refusing on "this submission was decided
 * once" would leave a corrected submission permanently undecidable. Refusing
 * on "this verdict was decided" stops only the duplicate.
 */
export async function alreadyDecided(db: D1Database, verdictId: string): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 AS found FROM decision WHERE verdict_id = ? LIMIT 1`)
    .bind(verdictId)
    .first<{ found: number }>()
  return row !== null
}

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
    // A person, by the name they entered — declared, not authenticated (§19.5).
    agent: humanAgent(record.decidedBy),
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

/** One decision, as a transparent record renders it. */
export interface DecisionEntry {
  readonly submissionId: string
  readonly reference: string
  readonly verdictId: string
  /**
   * Which submission, and from which run.
   *
   * The batch can be run repeatedly, and it is meant to be — the same 26 files
   * produce a fresh set of submissions each time, with new ids and new
   * reference codes, so both runs are independently decidable. What that costs
   * is legibility: two decisions on "L01-fully-compliant.pdf" are
   * indistinguishable in a list that carries only a code and a date.
   *
   * The name says WHICH label, the job says WHICH RUN, and `judgedAt` says when
   * the verdict being decided was reached — as against `decidedAt`, when
   * somebody decided about it. Those are different moments and a reviewer
   * comparing two runs needs both.
   */
  readonly sourceName: string
  readonly jobId: string | null
  readonly judgedAt: string | null
  /**
   * The name entered by whoever decided — **declared, not authenticated.**
   *
   * This deployment has no accounts, so nothing verifies it. Carried under a
   * name that says so, because a record whose attribution reads as identity is
   * transparent about something weaker than it appears, and a reader would
   * reasonably assume more.
   */
  readonly decidedByAsEntered: string
  readonly decidedAt: string
  readonly decision: string
  readonly recommendedOutcome: string
  /** Whether it matched what the system suggested. One implementation (§18.5). */
  readonly agreed: boolean
  /**
   * That a reason was given, not the reason itself.
   *
   * The note is free text an agent wrote about an applicant. It is already kept
   * out of the audit chain's detail on D20 grounds, and the same reasoning
   * applies to a list anyone can browse — more so, because a log is read by
   * someone with a reason to be looking. The note stays on the individual
   * trace, where that is true.
   */
  readonly hasNote: boolean
}

interface DecisionListRow {
  submission_id: string
  reference_code: string | null
  source_name: string | null
  job_id: string | null
  judged_at: string | null
  verdict_id: string
  decided_by: string
  decided_at: string
  decision: string
  recommended_outcome: string
  note: string | null
}

/**
 * The decision history, newest first (ui-design §2.3).
 *
 * Deliberately not scoped to a reviewer. Every other read here is about one
 * submission; this is the only view of what people actually did, and it is the
 * ground truth §18.5 says any move toward automation would have to be earned
 * against. Gating it behind a role this deployment cannot authenticate would
 * imply an access control that does not exist.
 */
export async function listDecisions(db: D1Database, limit = 100): Promise<DecisionEntry[]> {
  const { results } = await db
    .prepare(
      `SELECT d.submission_id, d.verdict_id, d.decided_by, d.decided_at,
              d.decision, d.recommended_outcome, d.note,
              s.reference_code, s.source_name, s.job_id,
              v.created_at AS judged_at
         FROM decision d
         LEFT JOIN submission s ON s.id = d.submission_id
         LEFT JOIN verdict    v ON v.id = d.verdict_id
        ORDER BY d.decided_at DESC
        LIMIT ?1`,
    )
    .bind(limit)
    .all<DecisionListRow>()

  return results.map((r) => ({
    submissionId: r.submission_id,
    reference: r.reference_code ?? '',
    sourceName: r.source_name ?? '',
    jobId: r.job_id,
    judgedAt: r.judged_at,
    verdictId: r.verdict_id,
    decidedByAsEntered: r.decided_by,
    decidedAt: r.decided_at,
    decision: r.decision,
    recommendedOutcome: r.recommended_outcome,
    agreed: isDecision(r.decision)
      ? !isDisagreement({
          decision: r.decision,
          recommendedOutcome: r.recommended_outcome as Outcome,
        })
      : false,
    hasNote: (r.note ?? '').trim() !== '',
  }))
}

/**
 * How often the agent agreed, per recommended outcome.
 *
 * The number §18.5 says a graduation to auto-approval would have to be earned
 * against. Reported as counts rather than a percentage: three decisions out of
 * three is not 100% of anything worth acting on, and a bare percentage invites
 * exactly that reading.
 */
export async function agreementByOutcome(
  db: D1Database,
): Promise<Array<{ recommendedOutcome: string; decided: string; count: number }>> {
  const { results } = await db
    .prepare(
      `SELECT recommended_outcome AS recommendedOutcome, decision AS decided, COUNT(*) AS count
         FROM decision GROUP BY recommended_outcome, decision ORDER BY count DESC`,
    )
    .all<{ recommendedOutcome: string; decided: string; count: number }>()
  return results
}
