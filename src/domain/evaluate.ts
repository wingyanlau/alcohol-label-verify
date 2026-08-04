/**
 * Executing the check vocabulary (M11, design §18.2).
 *
 * The policy file supplies parameters; every kind is implemented here, in
 * deterministic code, and tested. This is the half of the policy module that
 * actually produces a finding.
 *
 * ---------------------------------------------------------------------------
 * FOUR STATES, AND WHY THE FOURTH IS THE IMPORTANT ONE
 *
 *   SATISFIED       the rule was applied and the label meets it
 *   VIOLATED        the rule was applied and the label does not
 *   NOT_APPLICABLE  the rule does not govern this label
 *   UNDETERMINED    the rule applies and this system cannot tell
 *
 * `UNDETERMINED` is load-bearing. A check that cannot see the answer — net
 * contents moulded into the glass, a designation that resolves to no class, a
 * quantity nobody can parse — must never return `SATISFIED`, because silence
 * read as compliance is precisely how a non-compliant label passes review.
 * Every place this module declines to answer, it is because the regulation or
 * the artwork genuinely does not supply one.
 *
 * The distinction between `NOT_APPLICABLE` and `UNDETERMINED` matters to the
 * agent: the first needs no attention, the second is work.
 */

import { resolveDesignation } from './designation.js'
import { parseAbv, parseProof, parseQuantity } from './parse.js'
import type { PolicyRule } from './policy.js'

export type FindingState = 'SATISFIED' | 'VIOLATED' | 'NOT_APPLICABLE' | 'UNDETERMINED'

export interface PolicyFinding {
  readonly ruleId: string
  readonly requirement: string
  readonly state: FindingState
  /** What was observed and why it decided the way it did. Never a bare verdict. */
  readonly evidence: string
}

/** What a check may look at. Deliberately narrow: no clock, no I/O, no model. */
export interface EvaluationContext {
  /** Values as read from the label. Null where nothing was found. */
  readonly observed: Readonly<Record<string, string | null>>
  /** Fields the extractor reported it could not read. */
  readonly unreadable: ReadonlySet<string>
  /** The warning verdict already computed, or null if it could not be judged. */
  readonly warningOk: boolean | null
}

const finding = (rule: PolicyRule, state: FindingState, evidence: string): PolicyFinding => ({
  ruleId: rule.id,
  requirement: rule.requirement,
  state,
  evidence,
})

/**
 * The permitted forms of an alcohol content statement (27 CFR 5.65(b)(2)-(3)).
 *
 * Three orderings, with the abbreviations the regulation names: alcohol may be
 * "alc", percent may be "%", the "by" between alcohol and volume may be "/",
 * volume may be "vol", and periods and parentheses are optional.
 *
 * Built from the regulation's own list rather than from the corpus, then
 * checked against TTB's four worked examples in 5.65(b)(4) — the label the
 * corpus prints is a fifth case, and it has to pass for the same reason.
 */
const ALC = String.raw`(?:alcohol|alc\.?)`
const VOL = String.raw`(?:volume|vol\.?)`
const PCT = '(?:percent|%)'
const N = String.raw`\d+(?:\.\d+)?`
const ABV_FORMS = [
  // "Alcohol __ percent by volume"
  new RegExp(String.raw`${ALC}\s*${N}\s*${PCT}\s*(?:by|/)\s*${VOL}`, 'i'),
  // "__ percent alcohol by volume"
  new RegExp(String.raw`${N}\s*${PCT}\s*${ALC}\s*(?:by|/)\s*${VOL}`, 'i'),
  // "Alcohol by volume __ percent"
  new RegExp(String.raw`${ALC}\s*(?:by|/)\s*${VOL}\s*${N}\s*${PCT}`, 'i'),
]

function checkFieldPresent(rule: PolicyRule, ctx: EvaluationContext): PolicyFinding {
  const field = String(rule.check.field)
  // Unreadable is not absent. Reporting a breach here would blame an applicant
  // for a poor scan, which is the failure D5 exists to prevent.
  if (ctx.unreadable.has(field)) {
    return finding(rule, 'UNDETERMINED', `${field} could not be read from the artwork`)
  }
  const value = ctx.observed[field] ?? null
  if (value !== null && value.trim() !== '') {
    return finding(rule, 'SATISFIED', `${field} appears on the label as "${value}"`)
  }
  // Some absences are inconclusive by regulation — net contents may be moulded
  // into the container (5.63(b)(2)) and no image can show that. The policy file
  // says which, per rule.
  if (rule.check.whenAbsent === 'undetermined') {
    return finding(
      rule,
      'UNDETERMINED',
      `${field} does not appear on the artwork, which is not conclusive — it may ` +
        'be blown, embossed or moulded into the container',
    )
  }
  return finding(rule, 'VIOLATED', `${field} does not appear on the label`)
}

function checkFormat(rule: PolicyRule, ctx: EvaluationContext): PolicyFinding {
  const field = String(rule.check.field)
  const value = ctx.observed[field] ?? null
  if (value === null || value.trim() === '') {
    // Presence is another rule's job. Two findings for one problem is how a
    // reviewer stops reading them.
    return finding(rule, 'NOT_APPLICABLE', `${field} is not stated; presence is checked separately`)
  }
  if (rule.check.format !== 'abv-statement') {
    return finding(rule, 'UNDETERMINED', `unknown format "${String(rule.check.format)}"`)
  }
  const ok = ABV_FORMS.some((re) => re.test(value))
  return ok
    ? finding(rule, 'SATISFIED', `"${value}" is a permitted form of the statement`)
    : finding(
        rule,
        'VIOLATED',
        `"${value}" is not one of the permitted forms — alcohol content must be ` +
          'expressed as a percentage of alcohol by volume',
      )
}

function checkValueInSet(rule: PolicyRule, ctx: EvaluationContext): PolicyFinding {
  const field = String(rule.check.field)
  const value = ctx.observed[field] ?? null
  if (value === null || value.trim() === '') {
    return finding(rule, 'NOT_APPLICABLE', `${field} is not stated; presence is checked separately`)
  }
  const parsed = parseQuantity(value)
  if (parsed === null) {
    // "one fifth" is a real thing to find on artwork. Unknown, not unlawful.
    return finding(rule, 'UNDETERMINED', `"${value}" could not be read as a quantity`)
  }
  const ceiling = rule.check.notApplicableAbove
  if (typeof ceiling === 'number' && parsed.milliliters > ceiling) {
    return finding(
      rule,
      'NOT_APPLICABLE',
      `${parsed.milliliters} mL is above the ${ceiling} mL the enumerated list covers`,
    )
  }
  const permitted = (rule.check.permitted ?? []) as readonly number[]
  const ok = permitted.some((p) => Math.abs(p - parsed.milliliters) < 0.5)
  return ok
    ? finding(rule, 'SATISFIED', `${parsed.milliliters} mL is an authorised standard of fill`)
    : finding(rule, 'VIOLATED', `${parsed.milliliters} mL is not an authorised standard of fill`)
}

function checkNumericConsistency(rule: PolicyRule, ctx: EvaluationContext): PolicyFinding {
  const field = String(rule.check.field)
  const value = ctx.observed[field] ?? null
  if (value === null) {
    return finding(rule, 'NOT_APPLICABLE', `${field} is not stated`)
  }
  if (rule.check.relation !== 'proof-is-twice-abv') {
    return finding(rule, 'UNDETERMINED', `unknown relation "${String(rule.check.relation)}"`)
  }
  const proof = parseProof(value)
  if (proof === null) {
    // Stating proof is optional (5.65(b)(1)(i)). Its absence is not a finding.
    return finding(rule, 'NOT_APPLICABLE', 'no proof is stated alongside the alcohol content')
  }
  // The percentage, not a proof-derived figure — otherwise the check compares
  // a number with itself and can never fail.
  const percent = /(\d+(?:\.\d+)?)\s*%/.exec(value) ?? /(\d+(?:\.\d+)?)\s*percent/i.exec(value)
  const abv = percent?.[1] !== undefined ? Number(percent[1]) : (parseAbv(value)?.value ?? null)
  if (abv === null) {
    return finding(rule, 'UNDETERMINED', `no alcohol by volume could be read from "${value}"`)
  }
  const expected = abv * 2
  return Math.abs(expected - proof) < 0.05
    ? finding(rule, 'SATISFIED', `${proof} proof is twice ${abv}% alcohol by volume`)
    : finding(
        rule,
        'VIOLATED',
        `${abv}% alcohol by volume implies ${expected} proof, but the label states ${proof}`,
      )
}

function checkNumericBound(rule: PolicyRule, ctx: EvaluationContext): PolicyFinding {
  const determinedBy = String(rule.check.determinedBy ?? 'classType')
  const designation = ctx.observed[determinedBy] ?? null
  if (designation === null || designation.trim() === '') {
    return finding(rule, 'UNDETERMINED', `${determinedBy} is not stated, so no class applies`)
  }

  const resolved = resolveDesignation(designation)
  if (resolved.class === null) {
    // Unresolved or ambiguous. 5.141(b)(2) lets a product belong to several
    // classes, so choosing one here would silently pick which floor applies.
    return finding(rule, 'UNDETERMINED', resolved.reason)
  }
  const floor = resolved.class.minimumBottlingAbv
  if (floor === null) {
    // The class states none and its TYPES carry their own — 5.150 is the case.
    // Reading null as "no limit" would pass any strength at all.
    return finding(
      rule,
      'UNDETERMINED',
      `${resolved.class.name} (${resolved.class.citation}) states no class-level ` +
        'minimum; the applicable figure belongs to a type, which is not extracted',
    )
  }

  const field = String(rule.check.field)
  const stated = ctx.observed[field] ?? null
  if (stated === null) {
    return finding(rule, 'NOT_APPLICABLE', `${field} is not stated; presence is checked separately`)
  }
  const abv = parseAbv(stated)
  if (abv === null) {
    return finding(rule, 'UNDETERMINED', `no alcohol by volume could be read from "${stated}"`)
  }
  return abv.value >= floor
    ? finding(
        rule,
        'SATISFIED',
        `${abv.value}% meets the ${floor}% minimum for ${resolved.class.name} ` +
          `(${resolved.class.citation})`,
      )
    : finding(
        rule,
        'VIOLATED',
        `${abv.value}% is below the ${floor}% minimum for ${resolved.class.name} ` +
          `(${resolved.class.citation})`,
      )
}

function checkStatutoryText(rule: PolicyRule, ctx: EvaluationContext): PolicyFinding {
  // Deferred, never re-checked. One implementation of the statutory comparison,
  // or the two drift and the same label passes on one screen and fails on the
  // next.
  if (ctx.warningOk === null) {
    return finding(rule, 'UNDETERMINED', 'the warning statement could not be judged')
  }
  return ctx.warningOk
    ? finding(rule, 'SATISFIED', 'the warning statement matches the prescribed text')
    : finding(rule, 'VIOLATED', 'the warning statement departs from the prescribed text')
}

/**
 * Apply one rule.
 *
 * An unknown kind cannot occur — `validatePolicySet` refuses a set containing
 * one — but it is handled rather than thrown, because a rule reaching here
 * unrecognised means the contract and this switch have drifted apart, and the
 * honest report is that the check could not be performed.
 */
export function evaluateRule(rule: PolicyRule, ctx: EvaluationContext): PolicyFinding {
  switch (rule.check.kind) {
    case 'field-present':
      return checkFieldPresent(rule, ctx)
    case 'format-matches':
      return checkFormat(rule, ctx)
    case 'value-in-set':
      return checkValueInSet(rule, ctx)
    case 'numeric-consistency':
      return checkNumericConsistency(rule, ctx)
    case 'numeric-bound':
      return checkNumericBound(rule, ctx)
    case 'statutory-text':
      return checkStatutoryText(rule, ctx)
    default:
      return finding(
        rule,
        'UNDETERMINED',
        `check "${String(rule.check.kind)}" is not implemented in this deployment`,
      )
  }
}
