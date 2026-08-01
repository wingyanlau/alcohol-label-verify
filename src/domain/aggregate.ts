/**
 * Overall outcome aggregation.
 *
 * Design reference: §8.4.2, D5.
 *
 * The ordering below is a safety property, not a presentation choice:
 *
 *   UNREADABLE outranks everything.
 *
 * A field that could not be read must never aggregate into a clear result. The
 * failure this prevents is the serious one — a label passing review because the
 * system could not see the problem. UT-G03 and UT-G04 assert it directly.
 *
 * Never produced by a model (D1).
 */

import type { FieldVerdict, Outcome, WarningVerdict } from './types.js'

export interface AggregateInput {
  readonly fields: readonly FieldVerdict[]
  readonly warning: WarningVerdict | null
}

export function aggregate({ fields, warning }: AggregateInput): Outcome {
  // 1. Anything unreadable blocks a conclusion, whatever else was found.
  if (fields.some((f) => f.state === 'UNREADABLE')) return 'INCOMPLETE'

  // 2. A discrepancy on any field, or on the warning statement.
  const fieldProblem = fields.some((f) => f.state === 'MISMATCH' || f.state === 'MISSING_ON_LABEL')
  const warningProblem = warning !== null && !warning.ok
  if (fieldProblem || warningProblem) return 'DISCREPANCIES_FOUND'

  // 3. Everything agreed, but something was read with low confidence.
  if (fields.some((f) => f.state === 'LOW_CONFIDENCE')) return 'CLEAR_CONFIRM_FLAGGED'

  // 4. Nothing outstanding. NOT_SUPPLIED is not assessed, not failed.
  return 'CLEAR'
}

/** Plain-language outcome text (§5.3 P7 — no internal vocabulary reaches a user). */
export const OUTCOME_HEADLINE: Record<Outcome, string> = {
  CLEAR: 'Everything matches',
  CLEAR_CONFIRM_FLAGGED: 'Everything matches — please confirm the flagged fields',
  DISCREPANCIES_FOUND: 'Problems found',
  INCOMPLETE: 'Could not finish the check',
}

/** Count of findings an agent must act on. */
export function problemCount({ fields, warning }: AggregateInput): number {
  const fieldProblems = fields.filter(
    (f) => f.state === 'MISMATCH' || f.state === 'MISSING_ON_LABEL',
  ).length
  return fieldProblems + (warning !== null && !warning.ok ? 1 : 0)
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
  return 'Warning statement is not correct'
}
