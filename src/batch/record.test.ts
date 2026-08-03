import { describe, expect, it } from 'vitest'
import { applicationDataFrom } from './record.js'

describe('the application record, as declared', () => {
  it('takes the four compared fields and ignores the rest', () => {
    const data = applicationDataFrom({
      brandName: 'Old Tom Distillery',
      classType: 'Kentucky Straight Bourbon Whiskey',
      alcoholContent: '45% Alc./Vol.',
      netContents: '750 mL',
      // Present on the form, not part of the comparison.
      fancifulName: 'Barrel Reserve',
      productType: 'Distilled spirits',
      applicant: 'Old Tom Distillery, LLC',
    })

    expect(data).toEqual({
      brandName: 'Old Tom Distillery',
      classType: 'Kentucky Straight Bourbon Whiskey',
      alcoholContent: '45% Alc./Vol.',
      netContents: '750 mL',
    })
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
    ])
    expect(JSON.stringify(data)).not.toContain('CLEAR')
  })

  it('tolerates a non-string value rather than coercing it into a comparison', () => {
    const data = applicationDataFrom({ brandName: 42 } as Record<string, unknown>)
    expect(data.brandName).toBeNull()
  })
})
