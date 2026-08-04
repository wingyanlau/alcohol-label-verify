/**
 * The policy module's boundary (M11, design §18).
 *
 * The rules come from outside this system. What lives here is the contract
 * they must satisfy and the refusal when they do not — because a deployment
 * that quietly accepts a rule set it cannot honour under-enforces silently,
 * which is the failure nobody sees.
 */

import { describe, expect, it } from 'vitest'
import { PolicyContractError, rulesFor, validatePolicySet } from './policy.js'

const REG = {
  id: '27-CFR-5.203',
  title: 27,
  part: 5,
  section: '5.203',
  heading: 'Standards of fill',
  amendmentCitation: 'T.D. TTB-200, 90 FR 1876, Jan. 10, 2025',
  textDigest: 'abc123',
  extractedFromIssueDate: '2026-07-31',
}

const RULE = {
  id: 'DS-STANDARD-OF-FILL',
  ruleVersion: 1,
  regulation: '27-CFR-5.203',
  effectiveFrom: '2025-01-10',
  effectiveTo: null,
  supersedes: null,
  requirement: 'Net contents are an authorised standard of fill.',
  appliesWhen: { productType: ['Distilled spirits'] },
  check: { kind: 'value-in-set', field: 'netContents', unit: 'mL', permitted: [750, 1000] },
  severity: 'blocking',
  status: 'active',
  automation: 'advisory',
}

const SET = (over: Record<string, unknown> = {}) => ({
  policySetVersion: 1,
  approvedBy: 'IT Systems Administrator',
  approvedAt: '2026-08-03',
  regulations: [REG],
  rules: [RULE],
  ...over,
})

describe('accepting a policy set from outside', () => {
  it('accepts a set that meets the contract', () => {
    expect(() => validatePolicySet(SET())).not.toThrow()
  })

  // D27: nothing is enforced without a named approval. An unsigned rule set is
  // someone's draft, and applying it would make this deployment the approver.
  it('refuses a set nobody approved', () => {
    expect(() => validatePolicySet(SET({ approvedBy: '' }))).toThrow(PolicyContractError)
    expect(() => validatePolicySet(SET({ approvedBy: undefined }))).toThrow(PolicyContractError)
  })

  it('refuses a set with no version', () => {
    expect(() => validatePolicySet(SET({ policySetVersion: 0 }))).toThrow(PolicyContractError)
  })

  // The decision that matters most. An unrecognised check cannot be evaluated,
  // and skipping it would mean the deployment reports compliance against a rule
  // it never applied — under-enforcement that looks exactly like enforcement.
  it('refuses a rule whose check it cannot perform', () => {
    const bad = { ...RULE, check: { kind: 'ask-a-lawyer', field: 'netContents' } }
    expect(() => validatePolicySet(SET({ rules: [bad] }))).toThrow(/ask-a-lawyer/)
  })

  it('refuses a rule citing a regulation the set does not carry', () => {
    const orphan = { ...RULE, regulation: '27-CFR-9.99' }
    expect(() => validatePolicySet(SET({ rules: [orphan] }))).toThrow(/27-CFR-9\.99/)
  })

  it('refuses duplicate rule ids, which would make a finding ambiguous', () => {
    expect(() => validatePolicySet(SET({ rules: [RULE, RULE] }))).toThrow(/DS-STANDARD-OF-FILL/)
  })

  it('refuses a rule with no requirement text', () => {
    // FR-10: a finding names the rule that produced it. A rule that cannot
    // state what it requires cannot produce a defensible finding.
    expect(() => validatePolicySet(SET({ rules: [{ ...RULE, requirement: '  ' }] }))).toThrow(
      PolicyContractError,
    )
  })
})

describe('selecting the rules in force', () => {
  const set = validatePolicySet(SET())

  // §18.3 — a deterministic query over the application record. A model never
  // selects rules (D25), because the same label evaluated against different
  // rules on different days is worse than a wrong verdict: nothing reveals it.
  it('selects by product type', () => {
    expect(rulesFor(set, { productType: 'Distilled spirits' }, '2026-08-03')).toHaveLength(1)
    expect(rulesFor(set, { productType: 'Wine' }, '2026-08-03')).toHaveLength(0)
  })

  // The point of effective dating: an application filed in 2024 is judged by
  // the rules in force in 2024. Standards of fill changed in January 2025, and
  // judging an earlier filing by today's list would be applying a rule that did
  // not govern it.
  it('does not apply a rule to a submission that predates it', () => {
    expect(rulesFor(set, { productType: 'Distilled spirits' }, '2024-06-01')).toHaveLength(0)
    expect(rulesFor(set, { productType: 'Distilled spirits' }, '2025-01-10')).toHaveLength(1)
  })

  it('stops applying a rule once it has been superseded', () => {
    const retired = validatePolicySet(SET({ rules: [{ ...RULE, effectiveTo: '2026-01-01' }] }))
    expect(rulesFor(retired, { productType: 'Distilled spirits' }, '2026-08-03')).toHaveLength(0)
    expect(rulesFor(retired, { productType: 'Distilled spirits' }, '2025-06-01')).toHaveLength(1)
  })

  // A draft is somebody's proposal. Enforcing it would make this deployment the
  // approver of a rule nobody signed (D27).
  it('never applies a draft or a superseded rule', () => {
    for (const status of ['draft', 'superseded']) {
      const s = validatePolicySet(SET({ rules: [{ ...RULE, status }] }))
      expect(rulesFor(s, { productType: 'Distilled spirits' }, '2026-08-03')).toHaveLength(0)
    }
  })

  it('is stable — the same inputs select the same rules', () => {
    const a = rulesFor(set, { productType: 'Distilled spirits' }, '2026-08-03')
    const b = rulesFor(set, { productType: 'Distilled spirits' }, '2026-08-03')
    expect(a.map((r) => r.id)).toEqual(b.map((r) => r.id))
  })
})

describe('rules extracted from a supplied document', () => {
  // The governing principle, turned on the policy itself. A model may read a
  // regulation and propose rules; it may never enact one. If an extracted rule
  // could become enforceable without a person signing it, the model would be
  // deciding what the law says — a worse version of the failure the whole
  // system is arranged to prevent for labels.
  const extracted = (over: Record<string, unknown> = {}) => ({
    ...RULE,
    provenance: {
      sourceDocument: 'DOC-27CFR5',
      quote: 'The following metric standards of fill are authorized for distilled spirits',
      extractedBy: 'model',
      model: 'gemini-3.5-flash',
      extractedAt: '2026-08-03',
    },
    ...over,
  })

  const withDoc = (rules: unknown[]) =>
    SET({
      rules,
      sourceDocuments: [
        { id: 'DOC-27CFR5', title: '27 CFR part 5', digest: 'deadbeef', retrievedAt: '2026-07-31' },
      ],
    })

  it('accepts a model-extracted rule that a person has approved', () => {
    expect(() =>
      validatePolicySet(
        withDoc([extracted({ approval: { by: 'A. Reviewer', at: '2026-08-03' } })]),
      ),
    ).not.toThrow()
  })

  it('refuses to enact a model-extracted rule nobody signed', () => {
    expect(() => validatePolicySet(withDoc([extracted()]))).toThrow(/approval/i)
  })

  // A proposal is welcome; it simply cannot be active. This is how an LLM-
  // assisted knowledge base stays useful without becoming authoritative.
  it('accepts an unapproved extraction as a draft', () => {
    expect(() => validatePolicySet(withDoc([extracted({ status: 'draft' })]))).not.toThrow()
  })

  it('refuses a rule quoting a document the set does not carry', () => {
    const orphan = extracted({
      approval: { by: 'A. Reviewer', at: '2026-08-03' },
      provenance: { ...extracted().provenance, sourceDocument: 'DOC-UNKNOWN' },
    })
    expect(() => validatePolicySet(withDoc([orphan]))).toThrow(/DOC-UNKNOWN/)
  })

  // Without the verbatim basis a reviewer must re-read the whole regulation to
  // check one rule, which means in practice nobody checks it.
  it('refuses an extraction with no quoted basis', () => {
    const unquoted = extracted({
      approval: { by: 'A. Reviewer', at: '2026-08-03' },
      provenance: { ...extracted().provenance, quote: '' },
    })
    expect(() => validatePolicySet(withDoc([unquoted]))).toThrow(/quote/i)
  })

  // Which reader proposed it is part of the record, for the same reason the
  // label pipeline records which model produced a verdict.
  it('refuses a model extraction that does not say which model', () => {
    const anon = extracted({
      approval: { by: 'A. Reviewer', at: '2026-08-03' },
      provenance: { ...extracted().provenance, model: undefined },
    })
    expect(() => validatePolicySet(withDoc([anon]))).toThrow(/model/i)
  })

  it('still accepts a hand-written rule with no provenance block', () => {
    // The contract must not force ceremony onto a rule someone simply wrote.
    expect(() => validatePolicySet(SET())).not.toThrow()
  })
})

describe('malformed sets are refused, not repaired', () => {
  // Each of these is a way a supplied set can be wrong. None is exotic: they
  // are what a hand-edited file, a truncated export, or a half-finished
  // extraction actually looks like.
  it.each([
    ['not an object', 'nonsense'],
    ['no regulations array', SET({ regulations: 'none' })],
    ['a regulation with no id', SET({ regulations: [{ section: '5.203' }] })],
    ['no rules array', SET({ rules: {} })],
    ['a rule that is not an object', SET({ rules: ['DS-STANDARD-OF-FILL'] })],
    ['a rule with no check', SET({ rules: [{ ...RULE, check: undefined }] })],
    ['an unknown severity', SET({ rules: [{ ...RULE, severity: 'catastrophic' }] })],
    ['an unknown status', SET({ rules: [{ ...RULE, status: 'pending' }] })],
    ['an unknown automation level', SET({ rules: [{ ...RULE, automation: 'full-self-driving' }] })],
    ['a source document with no digest', SET({ sourceDocuments: [{ id: 'D', title: 'T' }] })],
  ])('refuses %s', (_name, value) => {
    expect(() => validatePolicySet(value)).toThrow(PolicyContractError)
  })

  it('refuses a malformed provenance block', () => {
    expect(() =>
      validatePolicySet(SET({ rules: [{ ...RULE, provenance: 'from the internet' }] })),
    ).toThrow(PolicyContractError)
  })

  it('refuses an extraction that says neither human nor model read it', () => {
    expect(() =>
      validatePolicySet(
        SET({
          sourceDocuments: [{ id: 'D', title: 'T', digest: 'x', retrievedAt: '2026-01-01' }],
          rules: [
            {
              ...RULE,
              provenance: {
                sourceDocument: 'D',
                quote: 'words',
                extractedBy: 'osmosis',
                extractedAt: '2026-01-01',
              },
            },
          ],
        }),
      ),
    ).toThrow(/human or a model/)
  })

  it('refuses an approval that names nobody', () => {
    expect(() =>
      validatePolicySet(SET({ rules: [{ ...RULE, approval: { by: '   ', at: '2026-01-01' } }] })),
    ).toThrow(/names nobody/)
  })
})

describe('the shipped example satisfies its own contract', () => {
  // The worked example is only worth shipping if it passes the validation it
  // was written to demonstrate. Without this, the contract and the example
  // could drift apart and each would still look fine on its own.
  it('loads config/policy-set.json', async () => {
    const set = validatePolicySet(
      JSON.parse(
        await import('node:fs').then((fs) => fs.readFileSync('config/policy-set.json', 'utf8')),
      ),
    )
    expect(set.rules.length).toBeGreaterThan(0)
    // Every rule cites a regulation the set carries — checked by validation,
    // asserted here so the example's own coverage is visible.
    for (const rule of set.rules) {
      expect(set.regulations.some((r) => r.id === rule.regulation)).toBe(true)
    }
  })

  it('selects only distilled-spirits rules for a bourbon filed today', () => {
    const set = validatePolicySet(
      JSON.parse(require('node:fs').readFileSync('config/policy-set.json', 'utf8')),
    )
    const selected = rulesFor(set, { productType: 'Distilled spirits' }, '2026-08-03')
    expect(selected.length).toBeGreaterThan(0)
    expect(selected.some((r) => r.id === 'WINE-STANDARD-OF-FILL')).toBe(false)
  })

  // The dating actually bites on real data: standards of fill changed in
  // January 2025, and the archive does not carry the list that preceded it.
  it('withholds the standards-of-fill rule from a 2024 filing', () => {
    const set = validatePolicySet(
      JSON.parse(require('node:fs').readFileSync('config/policy-set.json', 'utf8')),
    )
    const then = rulesFor(set, { productType: 'Distilled spirits' }, '2024-06-01')
    expect(then.some((r) => r.id === 'DS-STANDARD-OF-FILL')).toBe(false)
  })
})
