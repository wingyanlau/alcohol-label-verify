/**
 * Applying the policy set to one submission (M11, design §18.6 step 3).
 *
 * The join between the two halves that already existed separately: `policy.ts`
 * decides *which* rules govern a submission, `evaluate.ts` decides what each
 * one *says* about it. Neither knew about a submission until here.
 *
 * ---------------------------------------------------------------------------
 * WHICH DOCUMENT ANSWERS WHICH QUESTION
 *
 *   The application record  ->  which rules apply     (selection, D25)
 *   The label artwork       ->  whether they are met  (evaluation, D4)
 *
 * They are never crossed. Selecting on the label would let the artwork choose
 * the regulation it is judged by — a bottle claiming to be something less
 * regulated than it is would be judged as that thing. Evaluating against the
 * record would compare the application with itself and pass every label.
 * ---------------------------------------------------------------------------
 */

import rawPolicySet from '../../config/policy-set.json' with { type: 'json' }
import type { EvaluationContext, PolicyFinding } from './evaluate.js'
import { evaluateRule } from './evaluate.js'
import type { PolicyRule, PolicySet, SelectionInputs } from './policy.js'
import { rulesFor, validatePolicySet } from './policy.js'
import type { ApplicationData, Extraction, WarningVerdict } from './types.js'
import { FIELDS } from './types.js'

/**
 * The archive this deployment enforces.
 *
 * Validated at module load, which means an invalid set stops the worker from
 * starting rather than being partially applied. That is the intended failure
 * mode: refusing to load is loud, and a set that loaded half its rules would
 * report compliance against requirements it never applied (§18.5a).
 */
export const POLICY_SET: PolicySet = validatePolicySet(rawPolicySet)

/**
 * The product types the archive actually governs, for a form to offer.
 *
 * Derived from the rules rather than listed beside them. A hand-kept list drifts
 * the moment a rule for a new type is added, and it drifts in the silent
 * direction: the type is missing from the form, nobody selects it, and its rules
 * never fire.
 */
export const GOVERNED_PRODUCT_TYPES: readonly string[] = [
  ...new Set(
    POLICY_SET.rules
      .filter((rule) => rule.status === 'active')
      .flatMap((rule) => rule.appliesWhen.productType ?? []),
  ),
].sort()

/** What the verdict must carry for its findings to be defensible later (D26). */
export interface PolicyBinding {
  readonly policySetVersion: number
  readonly selectedRuleIds: readonly string[]
  /** The record values selection was performed on, not merely the version. */
  readonly selectionInputs: SelectionInputs
  /** The submission's own date — the one that decides which rules were in force. */
  readonly submittedOn: string
  /**
   * The two dates that reconstruct this rule set (D41, D42).
   *
   * `validOn` is the filing date, and is the same value as `submittedOn` — kept
   * under both names only while the version-era field is still written.
   * `asOf` is when this deployment judged the submission, and is the one the
   * version integer never expressed: it is what lets a verdict be re-derived
   * against the rules as they then stood, rather than refused because they have
   * since moved.
   */
  readonly validOn: string
  readonly asOf: string
}

export interface PolicyAssessment {
  readonly binding: PolicyBinding
  readonly findings: readonly PolicyFinding[]
  /**
   * The rules actually applied, so the caller can snapshot them onto each
   * finding (D44).
   *
   * Returned rather than folded into `PolicyFinding`: a finding is what the
   * agent reads, and thickening it with a quote, a citation and a parameter
   * blob would put the record's needs into the screen's type. The caller that
   * persists has both and can join them.
   */
  readonly applied: readonly PolicyRule[]
}

export interface AssessInput {
  readonly application: ApplicationData
  readonly extraction: Extraction
  readonly warning: WarningVerdict | null
  /** The date the application was filed. Rules in force *then* govern it. */
  readonly submittedOn: string
  /**
   * When this deployment judged the submission. Defaults to the filing date,
   * which is right for a submission being checked now and is what every caller
   * did before transaction time existed.
   */
  readonly asOf?: string | undefined
  /**
   * The rules to select from, **already narrowed to the two dates**.
   *
   * Supplied by the caller because that narrowing is a database query
   * (`ruleSetAsAt`) and this module is in the pure core. When absent the loaded
   * file is used and narrowed here by effective date only — the path every
   * caller took before the archive existed, kept so a test can pin a set
   * without a database.
   */
  readonly rules?: readonly PolicyRule[] | undefined
  /** Defaults to the loaded archive; injectable so tests can pin a set. */
  readonly policySet?: PolicySet | undefined
}

/**
 * Selection produced nothing, so no regulation was applied.
 *
 * Reported rather than passed over. Every rule in the set is conditioned on
 * product type, so a record that states none — or states one nothing governs —
 * would otherwise evaluate zero rules and read as a clean result, having
 * checked nothing at all. Same reasoning as §18.5a's refusal of an unknown
 * check: under-enforcement must not be indistinguishable from enforcement.
 *
 * It cites no rule because no rule was reached. `UNDETERMINED` is exactly
 * right: the policy applies, and this system cannot say what it requires.
 */
const selectionUndetermined = (evidence: string): PolicyFinding => ({
  ruleId: 'POLICY-SELECTION',
  requirement: 'The rules governing a submission must be identifiable from the application record',
  state: 'UNDETERMINED',
  severity: 'blocking',
  evidence,
})

/**
 * The regulation a rule came from, as an agent would cite it.
 *
 * A finding an agent cannot trace to a section is one they have to take on
 * trust, and FR-10 exists precisely so they do not have to. Returns null when
 * the rule is not in the set — `POLICY-SELECTION` is the standing case, since
 * it reports that no rule was reached.
 */
export function citationFor(ruleId: string, set: PolicySet = POLICY_SET): string | null {
  const rule = set.rules.find((r) => r.id === ruleId)
  if (rule === undefined) return null
  const regulation = set.regulations.find((r) => r.id === rule.regulation)
  // Title 27 is not read from the entry because the contract does not carry it:
  // a section like "5.63" is only meaningful under title 27 in the first place,
  // and this system knows no other title.
  return regulation === undefined ? null : `27 CFR ${regulation.section}`
}

/**
 * What the checks are allowed to look at.
 *
 * The label extraction only. `unreadable` is carried separately from a null
 * reading because they mean different things to a check: nothing was printed,
 * versus something was printed and could not be made out.
 */
function contextFor(extraction: Extraction, warning: WarningVerdict | null): EvaluationContext {
  const observed: Record<string, string | null> = {}
  const unreadable = new Set<string>()
  for (const field of FIELDS) {
    const read = extraction.fields[field]
    observed[field] = read.raw
    if (read.unreadable) unreadable.add(field)
  }
  return {
    observed,
    unreadable,
    // An illegible warning is not a failed one. The model returns the statute
    // from memory when it cannot read it, so a verdict drawn from an illegible
    // region says nothing — and a check told `false` there would report a
    // violation nobody observed.
    warningOk: warning === null || !warning.legible ? null : warning.ok,
  }
}

/**
 * Which of a set of rules govern this submission.
 *
 * The product-type half of selection, split from the temporal half. When the
 * caller supplies `rules` those have already been narrowed to `validOn` and
 * `asOf` by a database query, and doing it twice would be a second
 * implementation of the same predicate — the kind that agrees right up until it
 * does not.
 */
function governedBy(rules: readonly PolicyRule[], inputs: SelectionInputs): readonly PolicyRule[] {
  return rules.filter((rule) => {
    if (rule.status !== 'active') return false
    const types = rule.appliesWhen.productType
    if (types === undefined || types.length === 0) return true
    return inputs.productType !== undefined && types.includes(inputs.productType)
  })
}

export function assessPolicy({
  application,
  extraction,
  warning,
  submittedOn,
  asOf,
  rules,
  policySet = POLICY_SET,
}: AssessInput): PolicyAssessment {
  const productType = application.productType ?? undefined
  // Absent means absent: an input recorded as `undefined` and one never
  // recorded should not be distinguishable in the binding.
  const selectionInputs: SelectionInputs = productType === undefined ? {} : { productType }
  const judgedAt = asOf ?? submittedOn

  // Rules from the archive arrive already narrowed to both dates; the file path
  // is narrowed here by effective date alone, which is all a file can express.
  const selected =
    rules === undefined
      ? rulesFor(policySet, selectionInputs, submittedOn)
      : governedBy(rules, selectionInputs)

  const binding: PolicyBinding = {
    policySetVersion: policySet.policySetVersion,
    selectedRuleIds: selected.map((r) => r.id),
    selectionInputs,
    submittedOn,
    validOn: submittedOn,
    asOf: judgedAt,
  }

  if (selected.length === 0) {
    const evidence =
      productType === undefined
        ? 'the application states no product type, so no rule could be selected and nothing was checked against the policy set'
        : `no rule governing product type "${productType}" was in force on ${submittedOn}, so nothing was checked against the policy set`
    return { binding, findings: [selectionUndetermined(evidence)], applied: [] }
  }

  const ctx = contextFor(extraction, warning)
  return {
    binding,
    findings: selected.map((rule) => evaluateRule(rule, ctx)),
    applied: selected,
  }
}
