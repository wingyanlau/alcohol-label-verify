/**
 * Executing the check vocabulary (M11, design §18.2).
 *
 * Each kind is deterministic code taking parameters from the policy file. The
 * cases that matter most are the ones that must NOT return `SATISFIED`: a
 * check that cannot tell reports `UNDETERMINED` and goes to the agent, because
 * silence read as compliance is how a non-compliant label passes.
 */

import { describe, expect, it } from 'vitest'
import { evaluateRule } from './evaluate.js'
import type { PolicyRule } from './policy.js'

const rule = (check: Record<string, unknown>, over: Partial<PolicyRule> = {}): PolicyRule =>
  ({
    id: 'R',
    ruleVersion: 1,
    regulation: '27-CFR-5',
    effectiveFrom: null,
    effectiveTo: null,
    supersedes: null,
    requirement: 'A requirement.',
    appliesWhen: {},
    check,
    severity: 'blocking',
    status: 'active',
    automation: 'advisory',
    ...over,
  }) as unknown as PolicyRule

const ctx = (over: Record<string, unknown> = {}) => ({
  observed: {
    brandName: 'Old Tom Distillery',
    classType: 'Kentucky Straight Bourbon Whiskey',
    alcoholContent: '45% Alc./Vol.',
    netContents: '750 mL',
  },
  unreadable: new Set<string>(),
  warningOk: true,
  ...over,
})

describe('field-present', () => {
  it('is satisfied when the label states the field', () => {
    expect(evaluateRule(rule({ kind: 'field-present', field: 'brandName' }), ctx()).state).toBe(
      'SATISFIED',
    )
  })

  it('is violated when the field is absent', () => {
    const c = ctx({ observed: { ...ctx().observed, brandName: null } })
    expect(evaluateRule(rule({ kind: 'field-present', field: 'brandName' }), c).state).toBe(
      'VIOLATED',
    )
  })

  // 5.63(b)(2) permits net contents to be blown or moulded into the container,
  // which no image can show. The policy file says so per rule; absence is then
  // a question for the agent, not a breach.
  it('is undetermined when absence is not conclusive', () => {
    const c = ctx({ observed: { ...ctx().observed, netContents: null } })
    const r = rule({ kind: 'field-present', field: 'netContents', whenAbsent: 'undetermined' })
    expect(evaluateRule(r, c).state).toBe('UNDETERMINED')
  })

  // An unreadable field is not an absent one. Reporting a breach here would
  // blame an applicant for a poor scan.
  it('is undetermined when the field could not be read', () => {
    const c = ctx({ unreadable: new Set(['brandName']) })
    expect(evaluateRule(rule({ kind: 'field-present', field: 'brandName' }), c).state).toBe(
      'UNDETERMINED',
    )
  })
})

describe('format-matches — the ABV statement (5.65(b))', () => {
  const r = rule({ kind: 'format-matches', field: 'alcoholContent', format: 'abv-statement' })
  const withAbv = (v: string | null) => ctx({ observed: { ...ctx().observed, alcoholContent: v } })

  it.each([
    '40% alc/vol',
    'Alc. 40 percent by vol.',
    'Alc 40% by vol',
    '40% Alcohol by Volume',
    '45% Alc./Vol.',
  ])('accepts %s', (v) => {
    // The first four are TTB's own examples in 5.65(b)(4); the last is the
    // corpus label, which must not be reported as a breach.
    expect(evaluateRule(r, withAbv(v)).state).toBe('SATISFIED')
  })

  it.each(['45 degrees', 'strong', '90 proof'])('rejects %s', (v) => {
    // Proof alone is not a compliant statement: 5.65(b)(1) requires alcohol by
    // volume, with proof permitted only in addition.
    expect(evaluateRule(r, withAbv(v)).state).toBe('VIOLATED')
  })

  it('is not applicable when nothing was stated', () => {
    // Presence is a different rule's job. Reporting both would give an agent
    // two findings for one problem.
    expect(evaluateRule(r, withAbv(null)).state).toBe('NOT_APPLICABLE')
  })
})

describe('value-in-set — standards of fill (5.203)', () => {
  const r = rule({
    kind: 'value-in-set',
    field: 'netContents',
    unit: 'mL',
    permitted: [750, 1000, 1750],
  })
  const withNet = (v: string | null) => ctx({ observed: { ...ctx().observed, netContents: v } })

  it('accepts an authorised size, however written', () => {
    for (const v of ['750 mL', '750ml', '1 L', '1.75 L']) {
      expect(evaluateRule(r, withNet(v)).state).toBe('SATISFIED')
    }
  })

  it('reports an unauthorised size as a breach, and names it', () => {
    const f = evaluateRule(r, withNet('800 mL'))
    expect(f.state).toBe('VIOLATED')
    expect(f.evidence).toContain('800')
  })

  it('is undetermined when the value cannot be parsed', () => {
    // "a fifth" is a real thing to find on artwork. Not a breach — unknown.
    expect(evaluateRule(r, withNet('one fifth')).state).toBe('UNDETERMINED')
  })

  it('is not applicable above a stated ceiling', () => {
    // 4.72(b) permits wine above 3 litres in even litres, so the enumerated
    // list stops applying rather than condemning the container.
    const wine = rule({
      kind: 'value-in-set',
      field: 'netContents',
      unit: 'mL',
      permitted: [750],
      notApplicableAbove: 3000,
    })
    expect(evaluateRule(wine, withNet('5 L')).state).toBe('NOT_APPLICABLE')
  })
})

describe('numeric-consistency — proof against ABV (5.65(b)(1)(i))', () => {
  const r = rule({
    kind: 'numeric-consistency',
    field: 'alcoholContent',
    relation: 'proof-is-twice-abv',
  })
  const withAbv = (v: string) => ctx({ observed: { ...ctx().observed, alcoholContent: v } })

  it('is satisfied when proof is twice the stated ABV', () => {
    expect(evaluateRule(r, withAbv('45% Alc./Vol. (90 Proof)')).state).toBe('SATISFIED')
  })

  it('is violated when it is not', () => {
    const f = evaluateRule(r, withAbv('45% Alc./Vol. (80 Proof)'))
    expect(f.state).toBe('VIOLATED')
    expect(f.evidence).toMatch(/90/)
  })

  it('is not applicable when no proof is stated', () => {
    // Stating proof is optional. Its absence is not a finding — this is Q8's
    // UT-C03, arriving where it belongs.
    expect(evaluateRule(r, withAbv('45% Alc./Vol.')).state).toBe('NOT_APPLICABLE')
  })
})

describe('numeric-bound — minimum bottling strength by class', () => {
  const r = rule({
    kind: 'numeric-bound',
    field: 'alcoholContent',
    determinedBy: 'classType',
    unit: 'percent-abv',
    source: 'class-type-taxonomy',
    whenClassUnknown: 'undetermined',
    whenClassAmbiguous: 'undetermined',
    whenClassHasNoMinimum: 'undetermined',
  })
  const withBoth = (cls: string, abv: string) =>
    ctx({ observed: { ...ctx().observed, classType: cls, alcoholContent: abv } })

  it('is satisfied at or above the class floor', () => {
    expect(
      evaluateRule(r, withBoth('Kentucky Straight Bourbon Whiskey', '45% alc/vol')).state,
    ).toBe('SATISFIED')
    expect(evaluateRule(r, withBoth('Straight Bourbon Whiskey', '40% alc/vol')).state).toBe(
      'SATISFIED',
    )
  })

  it('is violated below it, naming the floor and its citation', () => {
    const f = evaluateRule(r, withBoth('Straight Bourbon Whiskey', '35% alc/vol'))
    expect(f.state).toBe('VIOLATED')
    expect(f.evidence).toMatch(/40/)
    expect(f.evidence).toMatch(/5\.143/)
  })

  // The three ways this check must decline rather than guess. Each was found by
  // reading the regulation, and each would otherwise pass silently.
  it('declines when the class cannot be resolved', () => {
    expect(evaluateRule(r, withBoth('Old Tom Reserve', '35% alc/vol')).state).toBe('UNDETERMINED')
  })

  it('declines when the designation is ambiguous', () => {
    expect(evaluateRule(r, withBoth('Brandy Liqueur', '25% alc/vol')).state).toBe('UNDETERMINED')
  })

  it('declines when the class states no floor', () => {
    // 5.150 defines cordials and liqueurs without one; every figure there
    // belongs to a type. Treating null as "no limit" would pass any strength.
    expect(evaluateRule(r, withBoth('Coffee Liqueur', '5% alc/vol')).state).toBe('UNDETERMINED')
  })
})

describe('statutory-text — the health warning', () => {
  const r = rule({ kind: 'statutory-text', reference: 'warning-statement' })

  it('defers to the warning verdict already computed', () => {
    // Not re-checked here: one implementation of the statutory comparison, or
    // the two drift and the same label passes one and fails the other.
    expect(evaluateRule(r, ctx({ warningOk: true })).state).toBe('SATISFIED')
    expect(evaluateRule(r, ctx({ warningOk: false })).state).toBe('VIOLATED')
  })

  it('is undetermined when the warning could not be judged', () => {
    expect(evaluateRule(r, ctx({ warningOk: null })).state).toBe('UNDETERMINED')
  })
})

/**
 * Wine states its alcohol content differently from spirits (27 CFR 4.36(b)).
 *
 * Two differences make this its own format rather than a reuse of the spirits
 * one, and both cut in the dangerous direction if conflated:
 *
 *   - wine may state a RANGE, "___% to ___% alcohol by volume" (4.36(b)(2)).
 *     Judged by the spirits format a lawful range reads as a violation.
 *   - only "alc." and "vol." may abbreviate. TTB says plainly that **"ABV" is
 *     not allowed**, and the spirits format never had to care because it does
 *     not match "ABV" either — so the prohibition would have looked satisfied
 *     by accident rather than by rule.
 *
 * Cases are TTB's own worked examples from its wine alcohol content guidance,
 * plus the range forms from the regulation.
 */
describe('wine-abv-statement — the permitted forms for wine', () => {
  const wine = (value: string) =>
    evaluateRule(
      rule({ kind: 'format-matches', field: 'alcoholContent', format: 'wine-abv-statement' }),
      ctx({ observed: { ...ctx().observed, alcoholContent: value } }),
    )

  it.each([
    'ALCOHOL 13.5% BY VOLUME',
    '13.5% Alc. by Vol.',
    'Alc. 13.5% By Vol.',
    '12.5% alcohol by volume',
    'ALC 13 % BY VOL',
  ])('accepts the specific percentage form: %s', (value) => {
    expect(wine(value).state).toBe('SATISFIED')
  })

  it.each([
    '12% to 14% alcohol by volume',
    'ALC. 12% TO 14% BY VOL.',
    '12.5% to 13.5% Alcohol by Volume',
  ])('accepts the range form 4.36(b)(2) permits: %s', (value) => {
    expect(wine(value).state).toBe('SATISFIED')
  })

  it('refuses "ABV", which TTB names as not allowed', () => {
    // The one abbreviation the guidance calls out explicitly.
    const f = wine('13.5% ABV')
    expect(f.state).toBe('VIOLATED')
    expect(f.evidence).toContain('13.5% ABV')
  })

  it('refuses proof, which is not a wine statement at all', () => {
    expect(wine('27 proof').state).toBe('VIOLATED')
  })

  it('refuses a bare number with no unit of measure', () => {
    expect(wine('13.5').state).toBe('VIOLATED')
  })

  it('is out of scope when nothing is stated — presence is a separate rule', () => {
    expect(wine('   ').state).toBe('NOT_APPLICABLE')
  })

  /*
   * A gap in the SPIRITS format, pinned rather than fixed here.
   *
   * The 5.65 patterns are unanchored, so "12% to 14% alcohol by volume"
   * matches on the substring "14% alcohol by volume" and passes. A range is
   * not a permitted spirits form — 5.65(b) lists none — so this is an
   * over-permissive match, and over-permissive is the dangerous direction.
   *
   * It is left alone deliberately. DS-ALCOHOL-CONTENT-FORMAT is active and
   * approved, and tightening it changes what an enacted rule does to labels
   * already judged by it; that is a rule change requiring a version bump and a
   * named approval (D27, §18.5a), not a passing edit while adding wine.
   *
   * If someone tightens it, this test fails and should be deleted along with
   * the note — which is the point of writing it down.
   */
  it('documents that the spirits format accepts a range it should not', () => {
    const spirits = evaluateRule(
      rule({ kind: 'format-matches', field: 'alcoholContent', format: 'abv-statement' }),
      ctx({ observed: { ...ctx().observed, alcoholContent: '12% to 14% alcohol by volume' } }),
    )
    expect(spirits.state).toBe('SATISFIED')
  })
})

/**
 * The decline paths.
 *
 * Every branch below returns something other than SATISFIED when the check
 * cannot be performed. They were the least-covered part of the module, which
 * is the wrong way round: a check that wrongly reports compliance does its
 * damage silently, and these are precisely the paths where that could happen.
 */
describe('a check that cannot be performed', () => {
  const withField = (field: string, value: string | null) =>
    ctx({ observed: { ...ctx().observed, [field]: value } })

  it('declines a format it does not implement', () => {
    // The contract refuses an unknown check KIND at load; an unknown format
    // PARAMETER slips past it, because validation does not read inside a check.
    const r = rule({ kind: 'format-matches', field: 'brandName', format: 'sonnet' })
    const f = evaluateRule(r, ctx())
    expect(f.state).toBe('UNDETERMINED')
    expect(f.evidence).toContain('sonnet')
  })

  it('declines a relation it does not implement', () => {
    const r = rule({ kind: 'numeric-consistency', field: 'alcoholContent', relation: 'golden' })
    expect(evaluateRule(r, ctx()).state).toBe('UNDETERMINED')
  })

  it('treats an absent field as out of scope for value-in-set', () => {
    // Presence is a separate rule. Reporting an unauthorised fill for a label
    // that states no fill would be a second finding for one problem.
    const r = rule({ kind: 'value-in-set', field: 'netContents', unit: 'mL', permitted: [750] })
    for (const empty of [null, '   ']) {
      expect(evaluateRule(r, withField('netContents', empty)).state).toBe('NOT_APPLICABLE')
    }
  })

  it('violates when a policy set lists no permitted values at all', () => {
    // An empty list is a set nothing belongs to. Silently passing would make a
    // misconfigured rule look like a satisfied one.
    const r = rule({ kind: 'value-in-set', field: 'netContents', unit: 'mL' })
    expect(evaluateRule(r, withField('netContents', '750 mL')).state).toBe('VIOLATED')
  })

  it('treats an absent alcohol content as out of scope for consistency', () => {
    const r = rule({
      kind: 'numeric-consistency',
      field: 'alcoholContent',
      relation: 'proof-is-twice-abv',
    })
    expect(evaluateRule(r, withField('alcoholContent', null)).state).toBe('NOT_APPLICABLE')
  })

  it('declines when proof is stated but no percentage can be read', () => {
    // "90 proof" alone: the rule compares proof against ABV, and there is no
    // ABV. Deriving one FROM the proof would compare the number with itself
    // and could never fail.
    const r = rule({
      kind: 'numeric-consistency',
      field: 'alcoholContent',
      relation: 'proof-is-twice-abv',
    })
    const f = evaluateRule(r, withField('alcoholContent', '90 proof'))
    expect(f.state).toBe('UNDETERMINED')
    expect(f.evidence).toMatch(/alcohol by volume/i)
  })

  it('accepts a percentage written in words alongside proof', () => {
    const r = rule({
      kind: 'numeric-consistency',
      field: 'alcoholContent',
      relation: 'proof-is-twice-abv',
    })
    expect(
      evaluateRule(r, withField('alcoholContent', '45 percent alc/vol (90 proof)')).state,
    ).toBe('SATISFIED')
  })

  it('declines a bound when no designation is stated', () => {
    const r = rule({ kind: 'numeric-bound', field: 'alcoholContent', determinedBy: 'classType' })
    for (const empty of [null, '  ']) {
      expect(evaluateRule(r, withField('classType', empty)).state).toBe('UNDETERMINED')
    }
  })

  it('treats an absent alcohol content as out of scope for a bound', () => {
    // The class resolves and has a floor, but there is no figure to test. That
    // is the presence rule's finding, not this one's.
    const r = rule({ kind: 'numeric-bound', field: 'alcoholContent', determinedBy: 'classType' })
    expect(evaluateRule(r, withField('alcoholContent', null)).state).toBe('NOT_APPLICABLE')
  })

  it('declines a bound when the stated strength cannot be read', () => {
    const r = rule({ kind: 'numeric-bound', field: 'alcoholContent', determinedBy: 'classType' })
    const f = evaluateRule(r, withField('alcoholContent', 'cask strength'))
    expect(f.state).toBe('UNDETERMINED')
    expect(f.evidence).toContain('cask strength')
  })

  it('defaults determinedBy to the class field when the rule omits it', () => {
    const r = rule({ kind: 'numeric-bound', field: 'alcoholContent' })
    expect(evaluateRule(r, ctx()).state).toBe('SATISFIED')
  })

  // Unreachable through the contract, which refuses an unknown kind at load.
  // Handled anyway: a rule arriving here unrecognised means the validator and
  // this switch have drifted, and the honest report is that nothing was
  // checked — not that everything was fine.
  it('reports an unimplemented kind rather than passing it', () => {
    const r = rule({ kind: 'ask-a-lawyer' })
    const f = evaluateRule(r, ctx())
    expect(f.state).toBe('UNDETERMINED')
    expect(f.evidence).toContain('ask-a-lawyer')
  })
})
