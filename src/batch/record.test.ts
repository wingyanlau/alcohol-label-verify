import { describe, expect, it } from 'vitest'
import { compareFields } from '../domain/compare.js'
import { FIELDS } from '../domain/types.js'
import { applicationDataFrom } from './record.js'

describe('the application record, as declared', () => {
  it('takes the four compared fields and ignores the rest', () => {
    const data = applicationDataFrom({
      brandName: 'Old Tom Distillery',
      classType: 'Kentucky Straight Bourbon Whiskey',
      alcoholContent: '45% Alc./Vol.',
      netContents: '750 mL',
      // Present on the form, and neither compared nor carried.
      fancifulName: 'Barrel Reserve',
      applicant: 'Old Tom Distillery, LLC',
      // Carried, and NOT compared — see the next test.
      productType: 'Distilled spirits',
    })

    expect(data).toEqual({
      brandName: 'Old Tom Distillery',
      classType: 'Kentucky Straight Bourbon Whiskey',
      alcoholContent: '45% Alc./Vol.',
      netContents: '750 mL',
      productType: 'Distilled spirits',
    })
  })

  // Product type is carried for one purpose: selecting which policy rules
  // govern the submission (27 CFR 5.141). It is NOT a comparison field, and no
  // label states "Distilled spirits" — so if it ever reached `compareFields`
  // it would report a discrepancy against every compliant label.
  //
  // This test previously said so in a comment while asserting the field was
  // dropped entirely. Now that it is carried, the guarantee has to be checked
  // rather than described.
  it('carries product type without ever comparing it', () => {
    const data = applicationDataFrom({
      brandName: 'Old Tom Distillery',
      productType: 'Distilled spirits',
    })
    expect(data.productType).toBe('Distilled spirits')

    const verdicts = compareFields(data, {
      fields: Object.fromEntries(
        FIELDS.map((f) => [f, { raw: null, confidence: 0, unreadable: false }]),
      ) as never,
      warningStatement: null,
    })
    expect(verdicts.map((v) => v.field).sort()).toEqual([...FIELDS].sort())
    expect(verdicts.some((v) => v.field === ('productType' as never))).toBe(false)
  })

  // L21 exists for this: the record leaves class/type blank. A blank must
  // become "not stated" rather than an empty string, which could later compare
  // equal to something.
  it('reads a blank field as absent, not as an empty value', () => {
    const data = applicationDataFrom({
      brandName: 'Old Tom Distillery',
      classType: '',
      alcoholContent: '45% Alc./Vol.',
      netContents: '   ',
    })
    expect(data.classType).toBeNull()
    expect(data.netContents).toBeNull()
  })

  it('reads a missing field as absent', () => {
    const data = applicationDataFrom({ brandName: 'Old Tom Distillery' })
    expect(data.classType).toBeNull()
    expect(data.alcoholContent).toBeNull()
    expect(data.netContents).toBeNull()
  })

  // The declared values are the applicant's own. The expected VERDICT is
  // authored ground truth and must never become an input — a comparison fed
  // its own answer key proves nothing.
  it('cannot carry an expected outcome, whatever the source contains', () => {
    const data = applicationDataFrom({
      brandName: 'Old Tom Distillery',
      expected: { outcome: 'CLEAR' },
      outcome: 'CLEAR',
    } as Record<string, unknown>)

    expect(Object.keys(data).sort()).toEqual([
      'alcoholContent',
      'brandName',
      'classType',
      'netContents',
      'productType',
    ])
    expect(JSON.stringify(data)).not.toContain('CLEAR')
  })

  it('tolerates a non-string value rather than coercing it into a comparison', () => {
    const data = applicationDataFrom({ brandName: 42 } as Record<string, unknown>)
    expect(data.brandName).toBeNull()
  })
})
