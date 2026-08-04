/**
 * Applying the policy set to a submission.
 *
 * Test IDs refer to `docs/test-plan.md` §3. These cover the join that §18.6
 * step 3 describes: selection from the application record, evaluation against
 * the label, and the binding that makes the result defensible afterwards.
 *
 * The tests run against `config/policy-set.json` itself rather than a fixture
 * set. A hand-built set would prove the plumbing and say nothing about whether
 * the rules this deployment actually enforces select and fire correctly — and
 * that is the part a wrong answer would be embarrassing about.
 */

import { describe, expect, it } from 'vitest'
import { assessPolicy, citationFor, GOVERNED_PRODUCT_TYPES, POLICY_SET } from './findings.js'
import type { PolicySet } from './policy.js'
import type { ApplicationData, Extraction, ObservedField, WarningVerdict } from './types.js'

const observed = (raw: string | null, unreadable = false): ObservedField => ({
  raw,
  confidence: unreadable ? 0 : 0.98,
  unreadable,
})

/** A label that complies: every field stated, in a permitted form. */
const goodLabel = (over: Partial<Record<string, ObservedField>> = {}): Extraction => ({
  fields: {
    brandName: observed('Old Tom'),
    classType: observed('Kentucky Straight Bourbon Whisky'),
    alcoholContent: observed('45% alc/vol'),
    netContents: observed('750 mL'),
    ...over,
  } as Extraction['fields'],
  warningStatement: 'GOVERNMENT WARNING: ...',
})

const spirits = (over: Partial<ApplicationData> = {}): ApplicationData => ({
  brandName: 'Old Tom',
  classType: 'Kentucky Straight Bourbon Whisky',
  alcoholContent: '45% alc/vol',
  netContents: '750 mL',
  productType: 'Distilled spirits',
  ...over,
})

const warningOk: WarningVerdict = {
  present: true,
  ok: true,
  legible: true,
  segments: [],
  advisory: [],
  referenceDataVersion: 1,
}

const assess = (
  application: ApplicationData,
  extraction = goodLabel(),
  warning: WarningVerdict | null = warningOk,
  submittedOn = '2026-08-01',
) => assessPolicy({ application, extraction, warning, submittedOn })

const byId = (r: ReturnType<typeof assess>, id: string) => r.findings.find((f) => f.ruleId === id)

describe('the policy set this deployment enforces', () => {
  it('loads, which is the contract passing on real data', () => {
    // validatePolicySet throws rather than returning a partial set (§18.5a).
    // If this fails, nothing below is meaningful.
    expect(POLICY_SET.policySetVersion).toBeGreaterThan(0)
    expect(POLICY_SET.rules.length).toBeGreaterThan(0)
  })
})

describe('citing the regulation a rule came from (FR-10)', () => {
  it('names the section for a rule in the set', () => {
    expect(citationFor('DS-STANDARD-OF-FILL')).toMatch(/^27 CFR \d/)
  })

  it('returns nothing for a rule the set does not carry', () => {
    // POLICY-SELECTION is the standing case: it reports that no rule was
    // reached, so there is no regulation to cite. A fabricated citation would
    // be worse than none — an agent would go and read the wrong section.
    expect(citationFor('POLICY-SELECTION')).toBeNull()
    expect(citationFor('NOT-A-RULE')).toBeNull()
  })

  it('returns nothing when the rule cites a regulation the set does not register', () => {
    // A set can only reach this state by being inconsistent with itself, and
    // the honest answer is that the citation is unknown rather than invented.
    const broken: PolicySet = {
      ...POLICY_SET,
      regulations: [],
    }
    expect(citationFor('DS-STANDARD-OF-FILL', broken)).toBeNull()
  })
})

describe('the product types offered on the form', () => {
  it('are the ones the archive actually governs', () => {
    expect(GOVERNED_PRODUCT_TYPES).toContain('Distilled spirits')
    expect(GOVERNED_PRODUCT_TYPES).toContain('Wine')
  })

  it('every one of them selects at least one rule', () => {
    // The list exists so the form cannot offer a type that checks nothing.
    for (const productType of GOVERNED_PRODUCT_TYPES) {
      const r = assess(spirits({ productType }))
      expect(r.binding.selectedRuleIds.length, productType).toBeGreaterThan(0)
    }
  })
})

describe('selection — which rules govern this submission (D25)', () => {
  it('selects the rules for the product type the application states', () => {
    const ids = assess(spirits()).binding.selectedRuleIds
    expect(ids).toContain('DS-STANDARD-OF-FILL')
    expect(ids).not.toContain('WINE-STANDARD-OF-FILL')
  })

  it('selects a different set for a different product type', () => {
    const ids = assess(spirits({ productType: 'Wine' })).binding.selectedRuleIds
    expect(ids).toContain('WINE-STANDARD-OF-FILL')
    expect(ids).not.toContain('DS-STANDARD-OF-FILL')
  })

  it('never selects a draft rule', () => {
    // A rule nobody has approved is carried for history, not applied (D27).
    expect(assess(spirits()).binding.selectedRuleIds).not.toContain('DS-MINIMUM-BOTTLING-STRENGTH')
  })

  it('judges a filing by the rules in force when it was filed, not today', () => {
    // Standards of fill changed in January 2025. A 2024 filing judged by
    // today's list is judged by a rule that did not govern it, and the verdict
    // looks perfectly ordinary (§18.5a).
    const earlier = assess(spirits(), goodLabel(), warningOk, '2024-06-01')
    expect(earlier.binding.selectedRuleIds).not.toContain('DS-STANDARD-OF-FILL')
    expect(earlier.binding.selectedRuleIds).toContain('DS-BRAND-NAME-PRESENT')
  })

  it('binds the version, the rules selected and the inputs they were selected on (D26)', () => {
    // Binding the version alone proves the rules were applied correctly.
    // Binding the inputs proves the correct rules were selected — the error
    // that is otherwise silent and systematic.
    const { binding } = assess(spirits())
    expect(binding.policySetVersion).toBe(POLICY_SET.policySetVersion)
    expect(binding.selectionInputs).toEqual({ productType: 'Distilled spirits' })
    expect(binding.submittedOn).toBe('2026-08-01')
    expect(binding.selectedRuleIds.length).toBe(assess(spirits()).findings.length)
  })
})

describe('a submission this system cannot select rules for', () => {
  /*
   * The dangerous case, and the reason it gets its own finding.
   *
   * Every rule in the set is conditioned on product type. An application that
   * states none selects nothing, evaluates nothing, and — without this — would
   * report a clean result having applied no regulation whatsoever. That is
   * under-enforcement indistinguishable from enforcement, exactly what §18.5a
   * refuses for an unknown check.
   */
  it('says so, rather than reporting a clean result', () => {
    const r = assess(spirits({ productType: null }))
    expect(r.findings.length).toBe(1)
    const [only] = r.findings
    expect(only?.state).toBe('UNDETERMINED')
    expect(only?.evidence).toMatch(/product type/i)
  })

  it('says so when the product type is one no rule governs', () => {
    const r = assess(spirits({ productType: 'Perry' }))
    expect(r.findings.some((f) => f.state === 'UNDETERMINED')).toBe(true)
  })

  it('records the empty selection honestly in the binding', () => {
    // The finding must not be mistaken for a rule that was applied.
    const r = assess(spirits({ productType: null }))
    expect(r.binding.selectedRuleIds).toEqual([])
  })
})

describe('evaluation — the findings themselves', () => {
  it('reports a compliant submission as satisfied throughout', () => {
    const r = assess(spirits())
    expect(r.findings.some((f) => f.state === 'VIOLATED')).toBe(false)
    expect(r.findings.some((f) => f.state === 'UNDETERMINED')).toBe(false)
    expect(byId(r, 'DS-STANDARD-OF-FILL')?.state).toBe('SATISFIED')
  })

  it('reports an unauthorised standard of fill, naming what it saw', () => {
    const r = assess(spirits(), goodLabel({ netContents: observed('800 mL') }))
    const f = byId(r, 'DS-STANDARD-OF-FILL')
    expect(f?.state).toBe('VIOLATED')
    expect(f?.evidence).toContain('800')
  })

  it('reports an alcohol statement in a form the regulation does not permit', () => {
    const r = assess(spirits(), goodLabel({ alcoholContent: observed('90 proof') }))
    expect(byId(r, 'DS-ALCOHOL-CONTENT-FORMAT')?.state).toBe('VIOLATED')
  })

  it('never reports satisfied for a field the extractor could not read', () => {
    // The degraded-input case. A check that could not see its subject must
    // decline, or an unreadable label passes on rules nobody applied.
    //
    // Asserted as an equality, not as "not SATISFIED": the negative form also
    // passes when the finding is missing entirely, which is the bug it would
    // most need to catch.
    const r = assess(spirits(), goodLabel({ netContents: observed(null, true) }))
    expect(byId(r, 'DS-NET-CONTENTS-PRESENT')?.state).toBe('UNDETERMINED')
    // Presence is a separate rule, so the fill check is out of scope rather
    // than breached — reporting both would be two findings for one problem.
    expect(byId(r, 'DS-STANDARD-OF-FILL')?.state).toBe('NOT_APPLICABLE')
  })

  it('carries each rule severity onto its finding, for aggregation to rank', () => {
    for (const f of assess(spirits()).findings) {
      expect(['blocking', 'advisory']).toContain(f.severity)
    }
  })

  it('declines the warning rule when the warning could not be judged', () => {
    const r = assess(spirits(), goodLabel(), { ...warningOk, legible: false, ok: false })
    expect(byId(r, 'HEALTH-WARNING-TEXT')?.state).toBe('UNDETERMINED')
  })

  it('reports a warning failure the legibility check permitted', () => {
    const r = assess(spirits(), goodLabel(), { ...warningOk, ok: false })
    expect(byId(r, 'HEALTH-WARNING-TEXT')?.state).toBe('VIOLATED')
  })

  it('declines the warning rule when no warning verdict exists at all', () => {
    expect(byId(assess(spirits(), goodLabel(), null), 'HEALTH-WARNING-TEXT')?.state).toBe(
      'UNDETERMINED',
    )
  })
})

describe('the label is read; the record selects (D4 still holds)', () => {
  it('evaluates against what the label says, never what the application claims', () => {
    // The application says 750 mL and the label says 800 mL. A check that read
    // the application would report compliance on a non-compliant label — the
    // false match D4 exists to prevent.
    const r = assess(
      spirits({ netContents: '750 mL' }),
      goodLabel({ netContents: observed('800 mL') }),
    )
    expect(byId(r, 'DS-STANDARD-OF-FILL')?.state).toBe('VIOLATED')
  })
})
