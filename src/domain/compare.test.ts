/**
 * Unit tests for the deterministic comparison layer.
 *
 * These are the specification of design §8.4 made executable. Test IDs refer to
 * `docs/test-plan.md` §3, and this suite is on the never-cut list: the rules are
 * the product, and without these there is no evidence they work.
 *
 * No model, no network, no credential.
 */

import { describe, expect, it } from 'vitest'
import { compareField, compareFields } from './compare.js'
import type { ApplicationData, Extraction, FieldName, ObservedField } from './types.js'

/** A confidently-read field. Confidence is varied explicitly where under test. */
const read = (raw: string | null, confidence = 1): ObservedField => ({
  raw,
  confidence,
  unreadable: false,
})

const unreadable: ObservedField = { raw: null, confidence: 0, unreadable: true }

const verdict = (field: FieldName, expected: string | null, observed: ObservedField) =>
  compareField(field, expected, observed)

describe('UT-N — tolerant text normalisation', () => {
  const cases: ReadonlyArray<[string, string, string, 'MATCH' | 'MISMATCH']> = [
    ['UT-N01 case folded', 'Old Tom Distillery', 'OLD TOM DISTILLERY', 'MATCH'],
    ["UT-N02 Dave's case", "Stone's Throw", "STONE'S THROW", 'MATCH'],
    ['UT-N03 typographic apostrophe', "Stone's Throw", 'Stone’s Throw', 'MATCH'],
    ['UT-N04 collapsed whitespace', 'Old Tom', 'Old  Tom', 'MATCH'],
    ['UT-N05 trimmed', 'Old Tom', ' Old Tom ', 'MATCH'],
    ['UT-N06 trailing punctuation', 'Old Tom', 'Old Tom.', 'MATCH'],
    ['UT-N07 hyphen as separator', 'Old Tom', 'Old-Tom', 'MATCH'],
    ['UT-N08 substring is not a match', 'Old Tom Distillery', 'Old Tom', 'MISMATCH'],
    ['UT-N09 semantic difference not tolerated', 'Old Tom and Sons', 'Old Tom & Sons', 'MISMATCH'],
  ]

  it.each(cases)('%s', (_id, expected, observed, want) => {
    expect(verdict('brandName', expected, read(observed)).state).toBe(want)
  })

  it('UT-N10 — an empty label value is MISSING_ON_LABEL, never a match', () => {
    expect(verdict('brandName', 'Old Tom', read('')).state).toBe('MISSING_ON_LABEL')
  })

  it('names the rule that tolerated the difference (FR-10, Dave)', () => {
    const v = verdict('brandName', 'Stone’s Throw', read("STONE'S THROW"))
    expect(v.state).toBe('MATCH')
    expect(v.rule).toMatch(/ignoring capitalisation/i)
    expect(v.explanation).toBeDefined()
  })

  it('carries no explanation on an exact match (ui-design §6.3)', () => {
    const v = verdict('brandName', 'Old Tom', read('Old Tom'))
    expect(v.state).toBe('MATCH')
    expect(v.explanation).toBeUndefined()
  })

  it('reports both values as evidence on a mismatch (FR-10)', () => {
    const v = verdict('brandName', 'Old Tom Distillery', read('Old Tom'))
    expect(v.expected).toBe('Old Tom Distillery')
    expect(v.observed).toBe('Old Tom')
  })
})

describe('UT-A — alcohol content', () => {
  const cases: ReadonlyArray<[string, string, string, string]> = [
    ['UT-A01 percentage with proof', '45', '45% Alc./Vol. (90 Proof)', 'MATCH'],
    ['UT-A02 uppercase abbreviation', '45%', '45% ALC/VOL', 'MATCH'],
    ['UT-A03 trailing zero', '45', '45.0%', 'MATCH'],
    ['UT-A04 words around the number', '45', 'ALCOHOL 45% BY VOLUME', 'MATCH'],
    ['UT-A05 genuine mismatch', '45', '40%', 'MISMATCH'],
    ['UT-A06 no tolerance applies (Q7 resolved)', '45', '45.5%', 'MISMATCH'],
    ['UT-A07 decimal-point error must not pass', '45', '4.5%', 'MISMATCH'],
    ['UT-A08 proof converted', '45', '90 Proof', 'MATCH'],
  ]

  it.each(cases)('%s', (_id, expected, observed, want) => {
    expect(verdict('alcoholContent', expected, read(observed)).state).toBe(want)
  })

  it('UT-A09 — absent on the label', () => {
    expect(verdict('alcoholContent', '45', read('')).state).toBe('MISSING_ON_LABEL')
  })

  it('UT-A10 — spelled out, never a silent match', () => {
    const v = verdict('alcoholContent', '45', read('forty-five percent'))
    expect(v.state).not.toBe('MATCH')
    expect(v.state).toBe('UNREADABLE')
  })

  it('explains a numeric mismatch in the agent’s terms', () => {
    const v = verdict('alcoholContent', '45', read('40% Alc./Vol.'))
    expect(v.explanation).toContain('45')
    expect(v.explanation).toContain('40')
  })

  it('names proof conversion when it was used', () => {
    expect(verdict('alcoholContent', '45', read('90 Proof')).explanation).toMatch(/proof/i)
  })
})

describe('UT-Q — net contents', () => {
  const cases: ReadonlyArray<[string, string, string, string]> = [
    ['UT-Q01 case-insensitive unit', '750 ml', '750 mL', 'MATCH'],
    ['UT-Q02 no space before unit', '750 mL', '750ML', 'MATCH'],
    ['UT-Q03 centilitres converted', '750 mL', '75 cL', 'MATCH'],
    ['UT-Q04 litres converted', '1000 mL', '1 L', 'MATCH'],
    ['UT-Q05 genuine mismatch', '750 mL', '700 mL', 'MISMATCH'],
    ['UT-Q07 fluid ounces, whole-mL resolution', '750 mL', '25.4 fl oz', 'MATCH'],
  ]

  it.each(cases)('%s', (_id, expected, observed, want) => {
    expect(verdict('netContents', expected, read(observed)).state).toBe(want)
  })

  it('UT-Q06 — a bare number assumes millilitres and lowers confidence', () => {
    const v = verdict('netContents', '750 mL', read('750'))
    expect(v.state).toBe('LOW_CONFIDENCE')
    expect(v.explanation).toMatch(/assumed/i)
  })

  it('explains a unit conversion so the agent sees why it matched', () => {
    expect(verdict('netContents', '750 mL', read('75 cL')).explanation).toMatch(/units differ/i)
  })

  it('does not guess at an unrecognised unit', () => {
    expect(verdict('netContents', '750 mL', read('750 gallons')).state).toBe('UNREADABLE')
  })
})

describe('field-independent states', () => {
  it('NOT_SUPPLIED when the application carries no value', () => {
    const v = verdict('brandName', null, read('OLD TOM DISTILLERY'))
    expect(v.state).toBe('NOT_SUPPLIED')
    expect(v.expected).toBeNull()
  })

  it('NOT_SUPPLIED for whitespace-only application input', () => {
    expect(verdict('brandName', '   ', read('OLD TOM')).state).toBe('NOT_SUPPLIED')
  })

  it('FR-11 — UNREADABLE is never downgraded to a mismatch', () => {
    const v = verdict('alcoholContent', '45', unreadable)
    expect(v.state).toBe('UNREADABLE')
    expect(v.observed).toBeNull()
  })

  it('UNREADABLE wins over a value being present but wrong', () => {
    // An extractor may return a low-quality guess alongside the unreadable
    // flag. The flag wins: a guess must not become a discrepancy.
    const v = compareField('alcoholContent', '45', {
      raw: '40%',
      confidence: 0.2,
      unreadable: true,
    })
    expect(v.state).toBe('UNREADABLE')
  })

  it('flags a low-confidence match for confirmation, in plain language', () => {
    const v = compareField('brandName', 'Old Tom', {
      raw: 'Old Tom',
      confidence: 0.4,
      unreadable: false,
    })
    expect(v.state).toBe('LOW_CONFIDENCE')
    expect(v.explanation).toMatch(/double-check/i)
  })

  it('does not soften a mismatch just because confidence was low', () => {
    const v = compareField('brandName', 'Old Tom', {
      raw: 'Young Tom',
      confidence: 0.3,
      unreadable: false,
    })
    expect(v.state).toBe('MISMATCH')
  })

  it('handles an application value that cannot be parsed as a quantity', () => {
    expect(verdict('netContents', 'a bottle', read('750 mL')).state).toBe('MISMATCH')
  })

  it('handles an application value that cannot be parsed as a number', () => {
    expect(verdict('alcoholContent', 'strong', read('45%')).state).toBe('MISMATCH')
  })
})

describe('UT-V — verdicts are self-describing (FR-10)', () => {
  it('every verdict names the rule applied', () => {
    const samples = [
      verdict('brandName', 'Old Tom', read('OLD TOM')),
      verdict('alcoholContent', '45', read('40%')),
      verdict('netContents', '750 mL', unreadable),
      verdict('classType', null, read('Bourbon')),
      verdict('netContents', '750 mL', read('')),
    ]
    for (const v of samples) expect(v.rule.length).toBeGreaterThan(0)
  })
})

describe('compareFields — every field, in checklist order', () => {
  const application: ApplicationData = {
    brandName: 'Old Tom Distillery',
    classType: 'Kentucky Straight Bourbon Whiskey',
    alcoholContent: '45',
    netContents: '750 mL',
  }
  const extraction: Extraction = {
    fields: {
      brandName: read('OLD TOM DISTILLERY'),
      classType: read('Kentucky Straight Bourbon Whiskey'),
      alcoholContent: read('40% Alc./Vol.'),
      netContents: read('750 mL'),
    },
    warningStatement: null,
  }

  it('returns one verdict per field, in order', () => {
    const out = compareFields(application, extraction)
    expect(out.map((v) => v.field)).toEqual([
      'brandName',
      'classType',
      'alcoholContent',
      'netContents',
    ])
  })

  it('localises the discrepancy to the offending field', () => {
    const out = compareFields(application, extraction)
    expect(out.filter((v) => v.state === 'MISMATCH').map((v) => v.field)).toEqual([
      'alcoholContent',
    ])
  })
})

describe('determinism (NFR-13)', () => {
  it('produces an identical verdict on repeated evaluation', () => {
    const once = verdict('alcoholContent', '45', read('45% Alc./Vol. (90 Proof)'))
    const twice = verdict('alcoholContent', '45', read('45% Alc./Vol. (90 Proof)'))
    expect(once).toEqual(twice)
  })
})
