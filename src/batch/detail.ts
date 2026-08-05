/**
 * Read a stored verdict back for the results view.
 *
 * Design reference: ui-design §5–§7, FR-10.
 *
 * The worklist stream carries only a summary (batch design §7.1); the full
 * record is fetched when a row is opened. This assembles that record from D1 and
 * the reference data — the field rows with both values and the rule that decided
 * each (FR-10), the warning statement by segment, and the advisory checklist the
 * system cannot judge from an image (FR-6a).
 *
 * It reads only. The verdict was computed once, deterministically, by the item
 * worker; nothing here re-derives it.
 */

import { OUTCOME_HEADLINE, OUTCOME_RECOMMENDATION } from '../domain/aggregate.js'
import { approverFor, citationFor } from '../domain/findings.js'
import { referenceIsUnverified, warningReference } from '../domain/reference.js'
import type { FieldName, Outcome } from '../domain/types.js'
import { FIELD_LABELS, FIELDS } from '../domain/types.js'
import { isDecision, isDisagreement } from './decision.js'
import { referenceCodeFor } from './reference-code.js'
import { productTypeFrom } from './replay-load.js'

export interface DetailField {
  readonly field: string
  readonly label: string
  readonly state: string
  readonly expected: string | null
  readonly observed: string | null
  readonly rule: string
  readonly explanation: string | null
}

export interface DetailWarningSegment {
  readonly segmentId: string
  readonly label: string
  readonly ok: boolean
  readonly required: string
  readonly observed: string | null
  readonly deviation: string | null
}

export interface DetailFinding {
  readonly ruleId: string
  readonly requirement: string
  readonly state: string
  readonly severity: string
  readonly evidence: string
  readonly citation: string | null
  /**
   * The rest of the rule as applied (D44), for an auditor rather than an agent.
   *
   * Null on a finding written before the snapshot columns existed. Null is the
   * honest answer there: the record does not hold it, and resolving it from
   * today's archive would present a rule this verdict may never have seen.
   */
  readonly regulationId: string | null
  readonly quote: string | null
  readonly checkParams: string | null
  readonly approvedBy: string | null
  /**
   * The regulation text this finding rests on, and the issue it was read from.
   *
   * What makes a finding traceable when its rule carries no verbatim quote —
   * which is every enacted rule today. A digest cannot be paraphrased.
   */
  readonly regulationDigest: string | null
  readonly regulationIssued: string | null
}

export interface SubmissionDetail {
  readonly submissionId: string
  readonly sourceName: string
  readonly state: string
  readonly outcome: Outcome | null
  readonly headline: string | null
  /** What the system suggests. Never an approval (§18.4). */
  readonly recommendation: string | null
  readonly cause: string | null
  /** What the policy set said, as recorded when the verdict was reached. */
  readonly findings: readonly DetailFinding[]
  /** Which rules were applied, and what they were selected on (D26). */
  readonly policy: {
    readonly policySetVersion: number | null
    readonly selectedRuleIds: readonly string[]
    readonly submittedOn: string | null
    /**
     * Item 5 — the product type the rules were selected on.
     *
     * On the detail because "no rules applied" and "no rule could be selected"
     * are different facts that look identical without it, and one of them means
     * the label was never examined against any regulation.
     */
    readonly productType: string | null
  }
  /** The agent's decision, once one has been recorded (§18.5). */
  readonly decision: {
    readonly decision: string
    readonly decidedBy: string
    readonly decidedAt: string
    readonly recommendedOutcome: string
    /**
     * Whether it matched what the system suggested.
     *
     * Computed here, from the same function the endpoint uses. The page had its
     * own version — a string-prefix test on the outcome name — and a second
     * implementation of "did the agent agree" is one that can disagree with the
     * one the agreement statistics are drawn from.
     */
    readonly agreed: boolean
    readonly note: string | null
  } | null
  /** The verdict this detail describes, so a decision can name what it answered. */
  readonly verdictId: string | null
  readonly fields: readonly DetailField[]
  readonly warning: {
    readonly evaluated: boolean
    readonly ok: boolean
    readonly segments: readonly DetailWarningSegment[]
    readonly advisory: readonly { id: string; text: string; citation: string }[]
    /** The statutory text has not been confirmed against the primary source (M0). */
    readonly referenceUnverified: boolean
  }
  readonly labelImageUrl: string
  /**
   * The quotable identifier (D21). Derived from `submissionId`, so it is
   * stable and needs no storage — see `reference-code.ts`.
   */
  readonly reference: string
  /**
   * When the staged content was deleted under the retention policy, or null
   * while it is still held. The panels read this rather than discovering the
   * absence by failing to load an image — "deleted on 3 August" is a policy
   * working; a broken panel is a tool that looks broken.
   */
  readonly contentPurgedAt: string | null
}

interface SubmissionRecord {
  source_name: string
  state: string
  failure_cause: string | null
  content_purged_at: string | null
}
interface VerdictRecord {
  id: string
  outcome: string
  policy_set_version: number | null
  selected_rule_ids: string | null
  submitted_on: string | null
  selection_inputs: string | null
}
interface FindingRecord {
  rule_id: string
  requirement: string
  state: string
  severity: string
  evidence: string
  regulation_id: string | null
  citation: string | null
  quote: string | null
  check_params: string | null
  approved_by: string | null
  regulation_digest: string | null
  regulation_issued: string | null
}
interface DecisionRecordRow {
  decision: string
  decided_by: string
  decided_at: string
  recommended_outcome: string
  note: string | null
}
interface FieldRecord {
  field: string
  state: string
  expected: string | null
  observed: string | null
  rule: string
  explanation: string | null
}
interface WarningRecord {
  segment_id: string
  ok: number
  observed: string | null
  deviation: string | null
}

/**
 * Rule ids as stored, or none.
 *
 * Tolerant on purpose: this column is JSON written by an older or newer
 * revision of this system, and a malformed value should cost the binding
 * display, not the whole result panel an agent is trying to read.
 */
function parseRuleIds(raw: string | null): readonly string[] {
  if (raw === null) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

/**
 * Load one submission's full result, or `null` if the submission is unknown.
 *
 * A submission with no verdict yet (queued, running, or failed before a verdict)
 * returns its state and cause with empty field/warning sections, so the caller
 * can render "still running" or a failure without a second shape.
 */
export async function loadSubmissionDetail(
  db: D1Database,
  submissionId: string,
  labelImageUrl: string,
): Promise<SubmissionDetail | null> {
  const reference = await referenceCodeFor(submissionId)
  const submission = await db
    .prepare(
      `SELECT source_name, state, failure_cause, content_purged_at FROM submission WHERE id = ?`,
    )
    .bind(submissionId)
    .first<SubmissionRecord>()
  if (submission === null) return null

  const verdict = await db
    .prepare(
      `SELECT id, outcome, policy_set_version, selected_rule_ids, submitted_on,
              selection_inputs
         FROM verdict
        WHERE submission_id = ? AND superseded_by IS NULL
        ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(submissionId)
    .first<VerdictRecord>()

  const ref = warningReference()
  const advisory = ref.advisoryChecks.map((a) => ({ id: a.id, text: a.text, citation: a.citation }))
  const referenceUnverified = referenceIsUnverified(ref)

  if (verdict === null) {
    return {
      submissionId,
      sourceName: submission.source_name,
      state: submission.state,
      outcome: null,
      headline: null,
      recommendation: null,
      cause: submission.failure_cause,
      findings: [],
      policy: { policySetVersion: null, selectedRuleIds: [], submittedOn: null, productType: null },
      decision: null,
      verdictId: null,
      fields: [],
      warning: { evaluated: false, ok: false, segments: [], advisory, referenceUnverified },
      labelImageUrl,
      reference,
      contentPurgedAt: submission.content_purged_at,
    }
  }

  const fieldRows = (
    await db
      .prepare(
        `SELECT field, state, expected, observed, rule, explanation
           FROM field_verdict WHERE verdict_id = ?`,
      )
      .bind(verdict.id)
      .all<FieldRecord>()
  ).results

  const byField = new Map(fieldRows.map((r) => [r.field, r]))
  const fields: DetailField[] = FIELDS.map((name: FieldName) => {
    const r = byField.get(name)
    return {
      field: name,
      label: FIELD_LABELS[name],
      state: r?.state ?? 'NOT_SUPPLIED',
      expected: r?.expected ?? null,
      observed: r?.observed ?? null,
      rule: r?.rule ?? '',
      explanation: r?.explanation ?? null,
    }
  })

  const warningRows = (
    await db
      .prepare(
        `SELECT segment_id, ok, observed, deviation FROM warning_verdict WHERE verdict_id = ?`,
      )
      .bind(verdict.id)
      .all<WarningRecord>()
  ).results
  const bySegment = new Map(warningRows.map((r) => [r.segment_id, r]))

  const segments: DetailWarningSegment[] = ref.segments.map((seg) => {
    const r = bySegment.get(seg.id)
    return {
      segmentId: seg.id,
      label: seg.label,
      ok: r ? r.ok === 1 : false,
      required: seg.text,
      observed: r?.observed ?? null,
      deviation: r?.deviation ?? null,
    }
  })

  const findingRows = (
    await db
      .prepare(
        `SELECT rule_id, requirement, state, severity, evidence,
                regulation_id, citation, quote, check_params, approved_by,
                regulation_digest, regulation_issued
           FROM policy_finding WHERE verdict_id = ?`,
      )
      .bind(verdict.id)
      .all<FindingRecord>()
  ).results

  // Everything here comes from the row, not from today's policy set. A rule
  // superseded since this verdict was reached would otherwise be shown with
  // wording, a citation and parameters it never had when it was applied.
  //
  // The citation used to be resolved live, which quietly undid the point of
  // storing it: the snapshot was written by D44 and then ignored on the way
  // out. It falls back to a live lookup only for a finding written before the
  // snapshot columns existed, where there is nothing stored to prefer.
  const findings: DetailFinding[] = findingRows.map((r) => ({
    ruleId: r.rule_id,
    requirement: r.requirement,
    state: r.state,
    severity: r.severity,
    evidence: r.evidence,
    citation: r.citation ?? citationFor(r.rule_id),
    regulationId: r.regulation_id,
    quote: r.quote,
    checkParams: r.check_params,
    // Stored where the snapshot has it. A finding written before the approver
    // was resolved falls back to today's archive — which is a live lookup, and
    // says so by being the fallback rather than the answer.
    approvedBy: r.approved_by ?? approverFor(r.rule_id),
    regulationDigest: r.regulation_digest,
    regulationIssued: r.regulation_issued,
  }))

  const decisionRow = await db
    .prepare(
      `SELECT decision, decided_by, decided_at, recommended_outcome, note
         FROM decision WHERE submission_id = ?
        ORDER BY decided_at DESC LIMIT 1`,
    )
    .bind(submissionId)
    .first<DecisionRecordRow>()

  return {
    submissionId,
    sourceName: submission.source_name,
    state: submission.state,
    outcome: verdict.outcome as Outcome,
    headline: OUTCOME_HEADLINE[verdict.outcome as Outcome],
    recommendation: OUTCOME_RECOMMENDATION[verdict.outcome as Outcome],
    cause: null,
    findings,
    policy: {
      policySetVersion: verdict.policy_set_version,
      selectedRuleIds: parseRuleIds(verdict.selected_rule_ids),
      submittedOn: verdict.submitted_on,
      // What selection actually ran on (D26). Read back from the bound inputs
      // rather than from a field verdict, because product type is not one of
      // FIELDS and no field row carries it — the same reason replay has to
      // read it from here.
      productType: productTypeFrom(verdict.selection_inputs),
    },
    decision:
      decisionRow === null
        ? null
        : {
            decision: decisionRow.decision,
            decidedBy: decisionRow.decided_by,
            decidedAt: decisionRow.decided_at,
            recommendedOutcome: decisionRow.recommended_outcome,
            agreed: isDecision(decisionRow.decision)
              ? !isDisagreement({
                  decision: decisionRow.decision,
                  recommendedOutcome: decisionRow.recommended_outcome as Outcome,
                })
              : false,
            note: decisionRow.note,
          },
    verdictId: verdict.id,
    fields,
    warning: {
      evaluated: true,
      ok: segments.every((s) => s.ok),
      segments,
      advisory,
      referenceUnverified,
    },
    labelImageUrl,
    reference,
    contentPurgedAt: submission.content_purged_at,
  }
}
