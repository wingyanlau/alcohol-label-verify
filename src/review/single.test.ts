/**
 * Single review (UC-1, ui-design §4).
 *
 * The behaviours worth pinning are the ones a second entry point could quietly
 * get wrong: which fields are required, and whether the extractor can see what
 * the applicant claimed.
 */

import { describe, expect, it } from 'vitest'
import type { ExtractionProvider, ExtractionRequest } from '../domain/extraction.js'
import { checkReviewRequest, ReviewRejected, reviewOne } from './single.js'

const application = {
  brandName: 'Old Tom Distillery',
  classType: 'Kentucky Straight Bourbon Whiskey',
  alcoholContent: '45% Alc./Vol.',
  netContents: '750 mL',
}

const reading = JSON.stringify({
  fields: {
    brandName: { value: 'Old Tom Distillery', confidence: 0.97 },
    classType: { value: 'Kentucky Straight Bourbon Whiskey', confidence: 0.95 },
    alcoholContent: { value: '40% Alc./Vol.', confidence: 0.93 },
    netContents: { value: '750 mL', confidence: 0.9 },
  },
  warningStatement:
    'GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink ' +
    'alcoholic beverages during pregnancy because of the risk of birth defects. ' +
    '(2) Consumption of alcoholic beverages impairs your ability to drive a car or ' +
    'operate machinery, and may cause health problems.',
})

const seen: ExtractionRequest[] = []
const provider: ExtractionProvider = {
  name: 'stub',
  async extract(request) {
    seen.push(request)
    const parsed = JSON.parse(reading)
    return {
      extraction: {
        fields: Object.fromEntries(
          Object.entries(parsed.fields).map(([k, v]) => [
            k,
            { raw: (v as { value: string }).value, confidence: 0.9, unreadable: false },
          ]),
        ) as never,
        warningStatement: parsed.warningStatement,
      },
      rawResponse: reading,
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

const run = () =>
  reviewOne(
    { application, image: new ArrayBuffer(8), mimeType: 'image/png' },
    {
      provider,
      submissionId: 's-1',
      reference: 'ABCD-1234',
      labelImageUrl: '/review/s-1/label.png',
      sourceName: 'label.png',
      env: { LEGIBILITY_FLOOR: '30' },
    },
  )

describe('validation on submit (§4.5)', () => {
  it('requires only the brand name', () => {
    // Everything else absent is a legitimate outcome, not a validation
    // failure. Requiring more would make an agent invent a value, and an
    // invented value produces a false discrepancy.
    expect(() =>
      checkReviewRequest({ application: { brandName: 'Old Tom' }, image: new ArrayBuffer(8) }),
    ).not.toThrow()
  })

  it('names the missing brand name in the words the screen uses', () => {
    try {
      checkReviewRequest({ application: {}, image: new ArrayBuffer(8) })
      throw new Error('expected a rejection')
    } catch (error) {
      expect(error).toBeInstanceOf(ReviewRejected)
      expect((error as ReviewRejected).field).toBe('brandName')
      expect((error as ReviewRejected).message).toBe(
        'Please enter the brand name from the application.',
      )
    }
  })

  it('names a missing image the same way', () => {
    try {
      checkReviewRequest({ application: { brandName: 'Old Tom' }, image: null })
      throw new Error('expected a rejection')
    } catch (error) {
      expect((error as ReviewRejected).field).toBe('image')
      expect((error as ReviewRejected).message).toBe('Please add an image of the label.')
    }
  })

  it('treats whitespace as absent', () => {
    expect(() =>
      checkReviewRequest({ application: { brandName: '   ' }, image: new ArrayBuffer(8) }),
    ).toThrow(ReviewRejected)
  })
})

describe('the review itself', () => {
  it('finds a genuine discrepancy and names the rule', async () => {
    const result = await run()
    expect(result.outcome).toBe('DISCREPANCIES_FOUND')
    const abv = result.fields.find((f) => f.field === 'alcoholContent')
    expect(abv?.state).toBe('MISMATCH')
    expect(abv?.expected).toBe('45% Alc./Vol.')
    expect(abv?.observed).toBe('40% Alc./Vol.')
    expect(abv?.rule.length).toBeGreaterThan(0)
  })

  // D4, on the second entry point. A new path is exactly where blind
  // extraction gets lost, because the application data is right there in the
  // same request object.
  it('never shows the extractor what the application claimed', async () => {
    seen.length = 0
    await run()
    expect(seen.length).toBeGreaterThan(0)
    for (const request of seen) {
      const serialised = JSON.stringify(request)
      expect(serialised).not.toContain('Old Tom Distillery')
      expect(serialised).not.toContain('750 mL')
      expect(serialised).not.toContain('45%')
    }
  })

  it('calls the model once — the record is data, not something to read', async () => {
    seen.length = 0
    await run()
    expect(seen).toHaveLength(1)
    expect(seen[0]?.region).toBe('label')
  })

  it('carries the quotable reference and the advisory checklist', async () => {
    const result = await run()
    expect(result.reference).toBe('ABCD-1234')
    expect(result.warning.advisory.length).toBeGreaterThan(0)
  })
})
