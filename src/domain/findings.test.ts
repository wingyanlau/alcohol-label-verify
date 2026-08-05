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
import {
  approverFor,
  assessPolicy,
  citationFor,
  GOVERNED_PRODUCT_TYPES,
  POLICY_SET,
  regulationSourceFor,
} from './findings.js'
import type { PolicyRule, PolicySet } from './policy.js'
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

describe('citing a regulation that is not a numbered section', () => {
  /*
   * Surfaced by enacting DS-MINIMUM-BOTTLING-STRENGTH. Every regulation this
   * system had cited until then was a numbered section — "5.63" — which already
   * carries its part, so the citation could be built by prefixing "27 CFR".
   *
   * A subpart does not. `27-CFR-5-SUBPART-I` has part 5 and section
   * "subpart I", and the old builder dropped the part: "27 CFR subpart I",
   * which identifies nothing. An agent quoting that to an applicant would be
   * citing a subpart of an unnamed part of an unstated title.
   */
  it('keeps the part when the section is not a number', () => {
    expect(citationFor('DS-MINIMUM-BOTTLING-STRENGTH')).toBe('27 CFR 5, subpart I')
  })

  it('leaves a numbered section exactly as it was', () => {
    // The common case must not move: "5.63" already embeds its part.
    expect(citationFor('DS-BRAND-NAME-PRESENT')).toBe('27 CFR 5.63')
  })
})

describe('who is answerable for a rule, and which text it rests on', () => {
  /*
   * Both came back null on every real finding, for opposite reasons.
   *
   * The approver was looked for in one place: a rule's own `approval`. None of
   * the ENACTED rules carry one — they are covered by the set's, which is a
   * named person, and D27 is that no rule reaches force without one. So the
   * approval existed one level up and the snapshot simply did not look there.
   *
   * The quote is null because the enacted rules hold no provenance at all, and
   * that cannot be fixed from code: writing provenance for a rule already in
   * force is a claim about who read the regulation, and a governance act.
   */
  it('inherits the set approver for a rule that names none', () => {
    const rule = POLICY_SET.rules.find((r) => r.status === 'active' && r.approval === undefined)
    expect(rule, 'no enacted rule lacks its own approval — this test is stale').toBeDefined()
    expect(approverFor(rule?.id ?? '')).toBe(POLICY_SET.approvedBy)
  })

  it('prefers a rule’s own approver when it has one', () => {
    const own: PolicySet = {
      ...POLICY_SET,
      rules: POLICY_SET.rules.map((r) =>
        r.id === 'DS-STANDARD-OF-FILL'
          ? { ...r, approval: { by: 'A Person', at: '2026-01-01' } }
          : r,
      ),
    }
    expect(approverFor('DS-STANDARD-OF-FILL', own)).toBe('A Person')
  })

  it('names nobody for a rule the set does not carry', () => {
    // POLICY-SELECTION reaches no rule, so there is nobody to be answerable.
    expect(approverFor('POLICY-SELECTION')).toBeNull()
  })

  it('pins the regulation text a finding rests on', () => {
    // What makes a finding traceable without a verbatim quote. A digest cannot
    // be paraphrased the way a copied fragment can.
    const source = regulationSourceFor('DS-STANDARD-OF-FILL')
    expect(source?.digest).toMatch(/^[0-9a-f]{8,}$/)
    expect(source?.issued).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('names no source for a rule that reached no regulation', () => {
    expect(regulationSourceFor('POLICY-SELECTION')).toBeNull()
  })

  it('records which enacted rules can be reviewed from their own quote', () => {
    /*
     * This used to assert that NO enacted rule carried a quote, which was true
     * while the only rules in force were the nine written by hand. Enacting the
     * six model-drafted ones changed the fact, and the test now records the
     * split rather than the old absolute — because the split is the thing worth
     * knowing.
     *
     * A rule with a quote can be reviewed on its own terms. One without pins
     * its regulation by digest and issue date, which is traceable but not
     * reviewable: checking it means re-reading the regulation (§18.5a). That is
     * the gap the README calls the recall gap, and it is the ORIGINAL nine that
     * still have it.
     */
    const enacted = POLICY_SET.rules.filter((r) => r.status === 'active')
    const quoted = enacted.filter((r) => r.provenance?.quote !== undefined)

    expect(enacted.length).toBeGreaterThan(0)
    expect(quoted.length).toBeGreaterThan(0)

    // Every quoted rule is one a person enacted by name — a rule drafted by a
    // model cannot be in force without that (D27), and the quote is what makes
    // the approval reviewable rather than ceremonial.
    for (const rule of quoted) {
      expect(rule.approval?.by, `${rule.id} is quoted but names no approver`).toBeTruthy()
    }

    // And every rule still without one carries its regulation by digest, so
    // nothing in force is untraceable.
    for (const rule of enacted.filter((r) => r.provenance?.quote === undefined)) {
      expect(
        regulationSourceFor(rule.id)?.digest,
        `${rule.id} has neither quote nor digest`,
      ).toBeTruthy()
    }
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

/**
 * The governing principle, turned on the policy itself (§18.5a).
 *
 * "A model may propose a rule; only a person may enact one." The blast radius
 * is why this is stricter than for labels: a model misreading one label
 * produces one wrong verdict a reviewer catches; a model misreading a
 * REGULATION produces a wrong rule applied confidently to every submission
 * thereafter, with each verdict correctly citing it.
 *
 * `validatePolicySet` refuses such a set at load. These assert the archive as
 * it actually stands, so a rule quietly promoted to active — by a hand, a
 * merge, or a future agent — fails here rather than at a deployment.
 */
describe('a model may propose a rule; only a person may enact one', () => {
  const proposed = POLICY_SET.rules.filter((r) => r.provenance?.extractedBy === 'model')

  it('has rules that a model proposed, so this is not vacuous', () => {
    expect(proposed.length).toBeGreaterThan(0)
  })

  it('leaves every one of them unenacted unless a person signed it', () => {
    for (const rule of proposed) {
      if (rule.status === 'active') {
        expect(rule.approval?.by, `${rule.id} is active`).toBeTruthy()
      }
    }
  })

  it('gives every one of them the verbatim words it was drawn from', () => {
    // Without the quote, reviewing one rule means re-reading the whole
    // regulation — which means nobody reviews it, and the approval becomes a
    // formality.
    for (const rule of proposed) {
      expect(rule.provenance?.quote?.length ?? 0, rule.id).toBeGreaterThan(40)
      expect(rule.provenance?.sourceDocument, rule.id).toBeTruthy()
    }
  })

  it('registers the document each one cites, with a digest', () => {
    // A rule whose source cannot be produced is a rule nobody can check, and a
    // document without a digest can be edited afterwards with nothing showing.
    const registered = new Map((POLICY_SET.sourceDocuments ?? []).map((d) => [d.id, d]))
    for (const rule of proposed) {
      const doc = registered.get(rule.provenance?.sourceDocument ?? '')
      expect(doc, `${rule.id} cites an unregistered document`).toBeDefined()
      expect(doc?.digest?.length ?? 0, rule.id).toBeGreaterThan(8)
    }
  })

  it('applies no unapproved rule, whether or not the file currently holds one', () => {
    /*
     * This used to read the drafts out of the shipped file. All six have since
     * been enacted, so the file holds none — and a test that depends on one
     * existing stops testing anything the moment the backlog empties, while
     * still passing. It now constructs a draft and proves selection refuses it,
     * which is the property rather than the circumstance.
     */
    const draft: PolicyRule = {
      ...(POLICY_SET.rules.find((r) => r.id === 'DS-BRAND-NAME-PRESENT') as PolicyRule),
      id: 'TEST-UNAPPROVED',
      status: 'draft',
    }
    const withDraft = assessPolicy({
      application: spirits(),
      extraction: goodLabel(),
      warning: warningOk,
      submittedOn: '2026-08-01',
      rules: [...POLICY_SET.rules, draft],
    })
    expect(withDraft.binding.selectedRuleIds).not.toContain('TEST-UNAPPROVED')
    // And the rules that ARE in force were still selected, so this did not pass
    // by selecting nothing at all.
    expect(withDraft.binding.selectedRuleIds).toContain('DS-BRAND-NAME-PRESENT')
  })
})

/**
 * Selection from the archive rather than the file (D41, D42).
 *
 * The rules arrive already narrowed to both dates by a database query, so all
 * that remains here is the product-type question. Doing the temporal filtering
 * again would be a second implementation of the same predicate — the kind that
 * agrees right up until it does not.
 */
describe('rules supplied by the caller, already narrowed to two dates', () => {
  const ruleOf = (over: Record<string, unknown> = {}) =>
    ({
      id: 'X-RULE',
      ruleVersion: 1,
      regulation: '27-CFR-5.63',
      effectiveFrom: null,
      effectiveTo: null,
      supersedes: null,
      requirement: 'a requirement',
      appliesWhen: { productType: ['Distilled spirits'] },
      check: { kind: 'field-present', field: 'brandName' },
      severity: 'blocking',
      status: 'active',
      automation: 'advisory',
      ...over,
    }) as unknown as (typeof POLICY_SET)['rules'][number]

  const withRules = (rules: unknown[], productType: string | null = 'Distilled spirits') =>
    assessPolicy({
      application: spirits({ productType }),
      extraction: goodLabel(),
      warning: warningOk,
      submittedOn: '2026-08-01',
      asOf: '2026-08-04T10:00:00.000Z',
      rules: rules as (typeof POLICY_SET)['rules'],
    })

  it('applies the rules it was given rather than the loaded file', () => {
    const r = withRules([ruleOf()])
    expect(r.binding.selectedRuleIds).toEqual(['X-RULE'])
  })

  it('still asks which product type a rule governs', () => {
    // The half of selection that is not a date, and the only half left here.
    expect(withRules([ruleOf()], 'Wine').findings.map((f) => f.ruleId)).toEqual([
      'POLICY-SELECTION',
    ])
  })

  it('applies a rule that names no product type to everything', () => {
    const r = withRules([ruleOf({ appliesWhen: {} })], 'Wine')
    expect(r.binding.selectedRuleIds).toEqual(['X-RULE'])
  })

  it('never applies a draft, however it arrived', () => {
    // The archive query already excludes them; asserting it here too is
    // deliberate. This is the property §18.5a rests on, and it should not
    // depend on exactly one layer remembering.
    const r = withRules([ruleOf({ status: 'draft' })])
    expect(r.binding.selectedRuleIds).toEqual([])
  })

  it('binds both dates, so the set can be rebuilt later (D41)', () => {
    const { binding } = withRules([ruleOf()])
    expect(binding.validOn).toBe('2026-08-01')
    expect(binding.asOf).toBe('2026-08-04T10:00:00.000Z')
  })

  it('returns the rules as applied, for the record to snapshot', () => {
    // Not shown to anyone — it is what keeps the verdict defensible after the
    // archive has moved on (D44).
    const r = withRules([ruleOf()])
    expect(r.applied.map((x) => x.id)).toEqual(['X-RULE'])
    expect(r.applied[0]?.check).toEqual({ kind: 'field-present', field: 'brandName' })
  })

  it('reports that nothing was checked when the archive had nothing in force', () => {
    const r = withRules([])
    expect(r.findings.map((f) => f.ruleId)).toEqual(['POLICY-SELECTION'])
    expect(r.applied).toEqual([])
    expect(r.findings[0]?.evidence).toMatch(/in force on 2026-08-01/)
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

  it('now selects the minimum-bottling-strength rule, which was a draft', () => {
    // It was enacted on 2026-08-05 by a named policy-approver. The test that
    // asserted its absence has become the record of its arrival — which is what
    // a rule taking force should look like in a suite.
    expect(assess(spirits()).binding.selectedRuleIds).toContain('DS-MINIMUM-BOTTLING-STRENGTH')
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

describe('the judging moment, when the caller does not state one', () => {
  it('defaults to the filing date', () => {
    // Right for a submission being checked now, and what every caller did
    // before transaction time existed.
    const { binding } = assess(spirits())
    expect(binding.asOf).toBe(binding.validOn)
    expect(binding.validOn).toBe('2026-08-01')
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
