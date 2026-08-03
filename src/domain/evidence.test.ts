/**
 * §3.7 — a verdict describes itself, or it is not a verdict.
 *
 * FR-10: every finding names the rule that produced it, and shows both values,
 * so an agent can defend it to an applicant rather than relaying a machine's
 * opinion. `UT-V03` asks for more than that being true today — it asks for it
 * to be *unrepresentable* otherwise, "enforced by the type, not by convention",
 * because a rule that holds only while everyone remembers it is a rule that
 * ends the first time someone adds a state in a hurry.
 */

import { describe, expect, it } from 'vitest'
import { compareFields } from './compare.js'
import { EvidenceMissing, rule } from './evidence.js'
import type { Extraction } from './types.js'
import { verifyWarning } from './warning.js'

const application = {
  brandName: 'Old Tom Distillery',
  classType: 'Kentucky Straight Bourbon Whiskey',
  alcoholContent: '45% Alc./Vol.',
  netContents: '750 mL',
}

const observed = (over: Partial<Record<string, string | null>> = {}): Extraction => ({
  fields: {
    brandName: { raw: 'Old Tom Distillery', confidence: 0.97, unreadable: false },
    classType: { raw: 'Kentucky Straight Bourbon Whiskey', confidence: 0.95, unreadable: false },
    alcoholContent: { raw: '40% Alc./Vol.', confidence: 0.93, unreadable: false },
    netContents: { raw: null, confidence: 0.2, unreadable: true },
    ...Object.fromEntries(
      Object.entries(over).map(([k, v]) => [
        k,
        { raw: v, confidence: 0.9, unreadable: v === null },
      ]),
    ),
  },
  warningStatement: null,
})

describe('UT-V01 — every field verdict carries its evidence', () => {
  it('names a rule on every field, whatever the state', () => {
    // Across a mixture of match, mismatch and unreadable — the states differ,
    // the obligation does not.
    for (const verdict of compareFields(application, observed())) {
      expect(verdict.rule.length).toBeGreaterThan(0)
      expect(verdict).toHaveProperty('expected')
      expect(verdict).toHaveProperty('observed')
    }
  })

  it('shows both values on a mismatch, so the agent can see what differs', () => {
    const abv = compareFields(application, observed()).find((v) => v.field === 'alcoholContent')
    expect(abv?.state).toBe('MISMATCH')
    expect(abv?.expected).toBe('45% Alc./Vol.')
    expect(abv?.observed).toBe('40% Alc./Vol.')
  })
})

describe('UT-V02 — a failing warning verdict names the deviation', () => {
  it('says what is wrong, not merely that something is', () => {
    // "The warning is wrong" sends an agent to read four sentences of statute
    // and guess. The segment and the deviation are the finding.
    const result = verifyWarning(
      'Government Warning: (1) According to the Surgeon General, women should not ' +
        'drink alcoholic beverages during pregnancy because of the risk of birth defects. ' +
        '(2) Consumption of alcoholic beverages impairs your ability to drive a car or ' +
        'operate machinery, and may cause health problems.',
    )
    expect(result.ok).toBe(false)
    const failing = result.segments.filter((s) => !s.ok)
    expect(failing.length).toBeGreaterThan(0)
    for (const segment of failing) {
      expect(segment.segmentId.length).toBeGreaterThan(0)
      expect(segment.deviation).toBeTruthy()
    }
  })
})

describe('UT-V03 — evidence is enforced by the type, not by convention', () => {
  // The point of the exercise: not "we remembered to fill this in" but "it
  // cannot be left out". A rule citation is constructed, and construction is
  // where the requirement is enforced.
  it('refuses to construct a rule citation from nothing', () => {
    expect(() => rule('')).toThrow(EvidenceMissing)
    expect(() => rule('   ')).toThrow(EvidenceMissing)
  })

  it('refuses a citation that names no rule', () => {
    // Placeholders are the realistic failure: something has to go in the slot
    // during development and is never revisited.
    expect(() => rule('TODO')).toThrow(EvidenceMissing)
    expect(() => rule('n/a')).toThrow(EvidenceMissing)
    expect(() => rule('-')).toThrow(EvidenceMissing)
  })

  it('accepts a citation that says what was applied', () => {
    expect(rule('Exact match after normalising capitalisation')).toBe(
      'Exact match after normalising capitalisation',
    )
  })

  it('every rule the comparison produces survives that constructor', () => {
    // The guarantee, applied to real output rather than asserted in the
    // abstract: if any comparison path ever emits an empty or placeholder
    // rule, this fails.
    for (const verdict of compareFields(application, observed())) {
      expect(() => rule(verdict.rule)).not.toThrow()
    }
  })
})
