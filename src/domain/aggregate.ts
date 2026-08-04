/**
 * Overall outcome aggregation.
 *
 * Design reference: §8.4.2, D5.
 *
 * The ordering below is a safety property, not a presentation choice:
 *
 *   UNREADABLE outranks everything — including an illegible warning.
 *
 * A field that could not be read must never aggregate into a clear result. The
 * failure this prevents is the serious one — a label passing review because the
 * system could not see the problem. UT-G03 and UT-G04 assert it directly.
 *
 * Never produced by a model (D1).
 */

import type { PolicyFinding } from './evaluate.js'
import type { FieldVerdict, Outcome, WarningVerdict } from './types.js'

export interface AggregateInput {
  readonly fields: readonly FieldVerdict[]
  readonly warning: WarningVerdict | null
  /**
   * Findings from the policy set, when one governed this submission (§18.4).
   *
   * Optional, and it means what it says: no rules were applied. A verdict
   * replayed from before the policy layer existed genuinely had none, and
   * defaulting to an empty list reports that faithfully rather than inventing
   * checks that never ran.
   */
  readonly findings?: readonly PolicyFinding[]
}

/** A rule that failed in a way the policy set says blocks (D40). */
const isBlockingViolation = (f: PolicyFinding) =>
  f.state === 'VIOLATED' && f.severity === 'blocking'

/**
 * A rule the agent must resolve by eye: one the artwork could not settle, or
 * one the policy set marks advisory rather than blocking.
 */
const needsJudgement = (f: PolicyFinding) =>
  f.state === 'UNDETERMINED' || (f.state === 'VIOLATED' && f.severity === 'advisory')

export function aggregate({ fields, warning, findings = [] }: AggregateInput): Outcome {
  // 1. Anything unreadable blocks a conclusion, whatever else was found.
  //
  // The warning counts here as much as any field, and for a sharper reason:
  // its text is a fixed statute, so a model can return it perfectly without
  // reading it. Legibility is measured from the pixels precisely because the
  // extractor's own account of what it could see is worth nothing for a string
  // it already knows.
  if (fields.some((f) => f.state === 'UNREADABLE')) return 'INCOMPLETE'
  if (warning !== null && !warning.legible) return 'INCOMPLETE'

  // 2. A discrepancy on any field, on the warning statement, or a rule the
  //    policy set says blocks.
  const fieldProblem = fields.some((f) => f.state === 'MISMATCH' || f.state === 'MISSING_ON_LABEL')
  const warningProblem = warning !== null && !warning.ok
  if (fieldProblem || warningProblem || findings.some(isBlockingViolation)) {
    return 'DISCREPANCIES_FOUND'
  }

  // 3. Nothing blocking, but a rule needs the agent's judgement.
  //
  //    Ranked above a low-confidence reading (D40): that asks them to confirm
  //    what the label says, which a better scan would settle. This asks them to
  //    decide something the artwork cannot answer at all.
  if (findings.some(needsJudgement)) return 'CLEAR_CONFIRM_POLICY'

  // 4. Everything agreed, but something was read with low confidence.
  if (fields.some((f) => f.state === 'LOW_CONFIDENCE')) return 'CLEAR_CONFIRM_FLAGGED'

  // 5. Nothing outstanding. NOT_SUPPLIED is not assessed, not failed.
  return 'CLEAR'
}

/**
 * Plain-language outcome text (§5.3 P7 — no internal vocabulary reaches a user).
 *
 * `CLEAR_CONFIRM_POLICY` says *nothing blocking was found*, never *approved*.
 * The system recommends; the human decides (§18.4).
 */
export const OUTCOME_HEADLINE: Record<Outcome, string> = {
  CLEAR: 'Everything matches',
  CLEAR_CONFIRM_FLAGGED: 'Everything matches — please confirm the flagged fields',
  CLEAR_CONFIRM_POLICY: 'Nothing blocking found — some rules need your judgement',
  DISCREPANCIES_FOUND: 'Problems found',
  INCOMPLETE: 'Could not finish the check',
}

/**
 * What the system suggests the agent do (§18.4).
 *
 * It recommends; it does not approve. Every line here hands the decision back —
 * *ready for your approval*, never *approved*. The distinction is the governing
 * principle in the one place a user actually reads, and it is the sentence most
 * likely to be softened later by someone making the screen feel decisive.
 * `RECOMMENDATION_KEEPS_THE_DECISION` asserts it.
 */
export const OUTCOME_RECOMMENDATION: Record<Outcome, string> = {
  CLEAR: 'Nothing blocking found — ready for your approval',
  CLEAR_CONFIRM_FLAGGED:
    'Nothing blocking found — confirm the flagged readings, then it is ready for your approval',
  CLEAR_CONFIRM_POLICY:
    'Nothing blocking found — some rules need your judgement before your approval',
  DISCREPANCIES_FOUND: 'Do not approve until the problems below are resolved',
  INCOMPLETE: 'Not enough could be read to make a recommendation',
}

/** Count of findings an agent must act on. */
export function problemCount({ fields, warning, findings = [] }: AggregateInput): number {
  const fieldProblems = fields.filter(
    (f) => f.state === 'MISMATCH' || f.state === 'MISSING_ON_LABEL',
  ).length
  return (
    fieldProblems +
    (warning !== null && !warning.ok ? 1 : 0) +
    findings.filter(isBlockingViolation).length
  )
}

/**
 * Rules awaiting the agent's judgement.
 *
 * Counted apart from `problemCount` for the same reason the outcomes are
 * distinct: these are not defects found, they are questions this system is not
 * entitled to answer.
 */
export function judgementCount({ findings = [] }: AggregateInput): number {
  return findings.filter(needsJudgement).length
}

/** Fields that could not be read, for the `INCOMPLETE` explanation. */
export function unreadableFields({ fields }: AggregateInput): readonly FieldVerdict[] {
  return fields.filter((f) => f.state === 'UNREADABLE')
}

/** One-line summary for a batch worklist row (ui-design §9). */
export function summarise(input: AggregateInput): string {
  const outcome = aggregate(input)
  if (outcome === 'CLEAR') return 'Everything matches'
  if (outcome === 'CLEAR_CONFIRM_FLAGGED') return 'Matches — confirm flagged fields'
  if (outcome === 'CLEAR_CONFIRM_POLICY') {
    const n = judgementCount(input)
    return `Needs your judgement on ${n} rule${n === 1 ? '' : 's'}`
  }
  if (outcome === 'INCOMPLETE') {
    const n = unreadableFields(input).length
    return `Could not read ${n} field${n === 1 ? '' : 's'}`
  }
  const first = input.fields.find((f) => f.state === 'MISMATCH' || f.state === 'MISSING_ON_LABEL')
  if (first) {
    const label = first.field.replace(/([A-Z])/g, ' $1').toLowerCase()
    return first.state === 'MISMATCH'
      ? `${label.charAt(0).toUpperCase()}${label.slice(1)} does not match`
      : `${label.charAt(0).toUpperCase()}${label.slice(1)} missing from the label`
  }
  if (input.warning !== null && !input.warning.ok) return 'Warning statement is not correct'

  // The remaining way to reach a discrepancy: a rule the policy set blocks on.
  // Naming it beats a generic line — the worklist row is where an agent decides
  // which submission to open first.
  const broken = (input.findings ?? []).find(isBlockingViolation)
  return broken ? `Fails ${broken.ruleId}` : 'Problems found'
}
