/**
 * The legibility floor is configuration, not a constant.
 *
 * It decides how degraded a warning statement may be before a transcription of
 * it stops meaning anything — which is a question about scanner quality and
 * how strict an agency wants to be, not a fact about this code. The corpus is
 * synthetic vector text; a deployment reading real scans will need a different
 * number, and should not need a release to say so.
 *
 * The floor travels WITH the measurement (`{ measured, floor }`) rather than
 * beside it, so "measured against nothing" cannot be expressed.
 */

import { describe, expect, it } from 'vitest'
import type { ExtractionProvider } from './extraction.js'
import { configuredLegibilityFloor } from './legibility.js'
import { verifySubmission } from './verify.js'

/** A deterministic clock. Timings are then facts about the test, not the machine. */
const clock = () => {
  let t = 0
  return () => (t += 10)
}

/**
 * The filing date, stated rather than derived.
 *
 * `now` above is the TIMING clock — it counts in tens so durations are facts
 * about the test. Deriving a calendar date from it gave 1970-01-01, which
 * silently dropped every rule with an `effectiveFrom` and left these tests
 * exercising seven rules while reading as though they exercised eight.
 */
const FILED = '2026-08-01'

const COMPLIANT = JSON.stringify({
  fields: {
    brandName: { value: 'Old Tom Distillery', confidence: 0.97 },
    classType: { value: 'Kentucky Straight Bourbon Whiskey', confidence: 0.95 },
    alcoholContent: { value: '45% Alc./Vol.', confidence: 0.93 },
    netContents: { value: '750 mL', confidence: 0.9 },
  },
  warningStatement:
    'GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink ' +
    'alcoholic beverages during pregnancy because of the risk of birth defects. ' +
    '(2) Consumption of alcoholic beverages impairs your ability to drive a car or ' +
    'operate machinery, and may cause health problems.',
})

const provider: ExtractionProvider = {
  name: 'stub',
  async extract() {
    return {
      extraction: JSON.parse(COMPLIANT) && {
        fields: {
          brandName: { raw: 'Old Tom Distillery', confidence: 0.97, unreadable: false },
          classType: {
            raw: 'Kentucky Straight Bourbon Whiskey',
            confidence: 0.95,
            unreadable: false,
          },
          alcoholContent: { raw: '45% Alc./Vol.', confidence: 0.93, unreadable: false },
          netContents: { raw: '750 mL', confidence: 0.9, unreadable: false },
        },
        warningStatement: JSON.parse(COMPLIANT).warningStatement,
      },
      rawResponse: COMPLIANT,
      provenance: {
        provider: 'stub',
        modelId: 'stub',
        promptVersion: 'p@1',
        samplingParameters: {},
        latencyMs: 1,
      },
    }
  },
}

const application = {
  brandName: 'Old Tom Distillery',
  classType: 'Kentucky Straight Bourbon Whiskey',
  alcoholContent: '45% Alc./Vol.',
  netContents: '750 mL',
  // Stated on the application, and the input rule selection runs on (D25).
  productType: 'Distilled spirits',
}

const check = (legibility?: { measured: number; floor: number }) =>
  verifySubmission(
    {
      label: {
        image: new ArrayBuffer(0),
        mimeType: 'image/png',
        ...(legibility ? { warningLegibility: legibility } : {}),
      },
      record: { applicationData: application },
    },
    { provider, now: clock(), submittedOn: FILED },
  )

describe('the legibility floor', () => {
  it('decides the verdict, and the same pixels can go either way', async () => {
    // One measurement, two policies. This is the whole argument for making it
    // configurable: an agency reading real scans sets the bar where its own
    // evidence puts it, and the verdict follows.
    expect((await check({ measured: 28, floor: 30 })).outcome).toBe('INCOMPLETE')
    expect((await check({ measured: 28, floor: 20 })).outcome).toBe('CLEAR')
  })

  it('treats the floor as a minimum, not a threshold to exceed', async () => {
    // Exactly at the floor is legible. A boundary that excluded its own value
    // would make the configured number mean one less than it says.
    expect((await check({ measured: 30, floor: 30 })).outcome).toBe('CLEAR')
    expect((await check({ measured: 29, floor: 30 })).outcome).toBe('INCOMPLETE')
  })

  it('assumes legible when nothing was measured', async () => {
    // Absence of a measurement is not evidence of illegibility, and failing
    // every unmeasured submission would make the check useless on uploads.
    expect((await check()).outcome).toBe('CLEAR')
  })
})

describe('reading the floor from configuration', () => {
  it('accepts a usable value', () => {
    expect(configuredLegibilityFloor({ LEGIBILITY_FLOOR: '30' })).toBe(30)
    expect(configuredLegibilityFloor({ LEGIBILITY_FLOOR: '55' })).toBe(55)
  })

  // No fallback. An invented threshold would decide real verdicts on a policy
  // the deployment never stated — and the dangerous direction is a low one,
  // which accepts transcriptions of artwork nobody could read.
  it('refuses a missing or unusable value rather than defaulting', () => {
    expect(configuredLegibilityFloor({})).toBeNull()
    expect(configuredLegibilityFloor({ LEGIBILITY_FLOOR: '' })).toBeNull()
    expect(configuredLegibilityFloor({ LEGIBILITY_FLOOR: 'strict' })).toBeNull()
    expect(configuredLegibilityFloor({ LEGIBILITY_FLOOR: '0' })).toBeNull()
    expect(configuredLegibilityFloor({ LEGIBILITY_FLOOR: '-3' })).toBeNull()
  })

  // Edge energy is a continuous measurement, so a fractional floor is
  // meaningful here in a way that a fractional retention window is not.
  it('allows a fractional floor', () => {
    expect(configuredLegibilityFloor({ LEGIBILITY_FLOOR: '29.5' })).toBe(29.5)
  })
})
