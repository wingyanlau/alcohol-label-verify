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
import type { PolicySet, SelectionInputs } from './policy.js'
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
}

export interface PolicyAssessment {
  readonly binding: PolicyBinding
  readonly findings: readonly PolicyFinding[]
}

export interface AssessInput {
  readonly application: ApplicationData
  readonly extraction: Extraction
  readonly warning: WarningVerdict | null
  /** The date the application was filed. Rules in force *then* govern it. */
  readonly submittedOn: string
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

export function assessPolicy({
  application,
  extraction,
  warning,
  submittedOn,
  policySet = POLICY_SET,
}: AssessInput): PolicyAssessment {
  const productType = application.productType ?? undefined
  // Absent means absent: an input recorded as `undefined` and one never
  // recorded should not be distinguishable in the binding.
  const selectionInputs: SelectionInputs = productType === undefined ? {} : { productType }
  const selected = rulesFor(policySet, selectionInputs, submittedOn)

  const binding: PolicyBinding = {
    policySetVersion: policySet.policySetVersion,
    selectedRuleIds: selected.map((r) => r.id),
    selectionInputs,
    submittedOn,
  }

  if (selected.length === 0) {
    const evidence =
      productType === undefined
        ? 'the application states no product type, so no rule could be selected and nothing was checked against the policy set'
        : `no rule in policy set v${policySet.policySetVersion} governs product type "${productType}", so nothing was checked against the policy set`
    return { binding, findings: [selectionUndetermined(evidence)] }
  }

  const ctx = contextFor(extraction, warning)
  return { binding, findings: selected.map((rule) => evaluateRule(rule, ctx)) }
}
