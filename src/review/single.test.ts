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
  // Item 5 on the form, and the input rule selection runs on (D25). Without
  // it no rule is selected and the screen has nothing to show.
  productType: 'Distilled spirits',
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

const run = async () =>
  (
    await reviewOne(
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
  ).view

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

describe('the rules the screen shows (§18.4)', () => {
  it('shows one entry per rule applied, each citing its regulation', async () => {
    const result = await run()
    expect(result.findings.length).toBeGreaterThan(0)
    expect(result.findings.length).toBe(result.policy.selectedRuleIds.length)
    for (const f of result.findings) {
      // A finding an agent cannot trace to a section is one they can only take
      // on trust, which is what FR-10 exists to avoid.
      expect(f.citation, f.ruleId).toMatch(/^27 CFR \d/)
      expect(f.requirement.length, f.ruleId).toBeGreaterThan(0)
      expect(f.evidence.length, f.ruleId).toBeGreaterThan(0)
    }
  })

  it('binds which rules were applied and when they were in force (D26)', async () => {
    const result = await run()
    expect(result.policy.policySetVersion).toBeGreaterThan(0)
    expect(result.policy.selectedRuleIds).toContain('DS-STANDARD-OF-FILL')
    expect(result.policy.submittedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('recommends without approving', async () => {
    // The governing principle, at the one point a user reads it. This screen
    // is where "Approved" would be most tempting and most wrong.
    const result = await run()
    expect(result.recommendation).toMatch(/do not approve/i)
    expect(result.recommendation).not.toMatch(/^\s*approved\b/i)
  })

  it('reports the alcohol statement rule as met even though the value mismatches', async () => {
    // The two layers answer different questions and must not be confused. The
    // label says 40% where the application says 45% — a discrepancy — but
    // "40% Alc./Vol." is a perfectly legal way to state alcohol content, so
    // the format rule is satisfied. A screen showing both as failures would be
    // reporting one problem twice and misnaming it.
    const result = await run()
    const format = result.findings.find((f) => f.ruleId === 'DS-ALCOHOL-CONTENT-FORMAT')
    expect(format?.state).toBe('SATISFIED')
  })
})

/**
 * The filed form, checked as one PDF (UC-1, revised).
 *
 * The single path and the batch path now take the same input: the filled TTB
 * F 5100.31 as a PDF, rasterised into a label region and a record region, and
 * read blind. Typing the application data by hand was a second way in, and a
 * second way in is a second thing to keep in agreement — the agent's typing
 * against the filed form. Reading the record removes the transcription step
 * that was never part of the job.
 *
 * What must NOT change is the blindness. Two reads, neither shown the other's
 * answer: the record read never sees the label, the label read never sees the
 * record, and no expected value exists before both have answered (D4, CT-10).
 */
describe('a filed form, checked as one PDF', () => {
  const recordReading = (productType: string | null) =>
    JSON.stringify({
      fields: {
        brandName: { value: 'Old Tom Distillery', confidence: 0.99 },
        classType: { value: 'Kentucky Straight Bourbon Whiskey', confidence: 0.99 },
        alcoholContent: { value: '45% Alc./Vol.', confidence: 0.99 },
        netContents: { value: '750 mL', confidence: 0.99 },
      },
      productType,
    })

  /** Answers per region, so the two reads can be told apart in the assertions. */
  function twoRegionProvider(productType: string | null) {
    const asked: ExtractionRequest[] = []
    const provider: ExtractionProvider = {
      name: 'stub',
      async extract(request) {
        asked.push(request)
        const body = request.region === 'label' ? reading : recordReading(productType)
        const { parseExtractionResponse } = await import('../domain/extraction.js')
        return {
          extraction: parseExtractionResponse(JSON.parse(body), {
            fields: request.fields,
            includeWarning: request.includeWarning,
            includeProductType: request.includeProductType === true,
          }),
          rawResponse: body,
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
    return { provider, asked }
  }

  const runPdf = async (productType: string | null) => {
    const { provider, asked } = twoRegionProvider(productType)
    const out = await reviewOne(
      {
        kind: 'submission',
        image: new ArrayBuffer(8),
        mimeType: 'image/png',
        record: { image: new ArrayBuffer(8), mimeType: 'image/png' },
      },
      {
        provider,
        submissionId: 's-2',
        reference: 'ABCD-5678',
        labelImageUrl: '/review/s-2/label.png',
        sourceName: 'TTB-F-5100-31.pdf',
        env: { LEGIBILITY_FLOOR: '30' },
      },
    )
    return { ...out, asked }
  }

  it('reads both regions, and neither read is shown the other', async () => {
    const { asked } = await runPdf('Distilled spirits')
    expect(asked.map((r) => r.region).sort()).toEqual(['label', 'record'])
    // CT-10 restated for this path: an extraction request has nowhere to put
    // an expected value, so blindness holds by construction rather than by
    // this assertion — which pins that the shape has not been widened.
    const allowed = [
      'fields',
      'image',
      'includeProductType',
      'includeWarning',
      'mimeType',
      'region',
    ]
    for (const request of asked) {
      expect(Object.keys(request).filter((k) => !allowed.includes(k))).toEqual([])
    }
    // And item 5 is asked of the record alone: no label states "Distilled
    // spirits", so asking there would let the artwork choose the regulation.
    expect(asked.find((r) => r.region === 'label')?.includeProductType).not.toBe(true)
    expect(asked.find((r) => r.region === 'record')?.includeProductType).toBe(true)
  })

  it('compares the label against what the record said, not against typing', async () => {
    // The label reading declares 40% where the record says 45%. Nobody typed
    // either number; both were read, separately, and the discrepancy is
    // between two readings of the filed submission.
    const { view } = await runPdf('Distilled spirits')
    const abv = view.fields.find((f) => f.field === 'alcoholContent')
    expect(abv?.state).toBe('MISMATCH')
    expect(abv?.expected).toBe('45% Alc./Vol.')
    expect(abv?.observed).toBe('40% Alc./Vol.')
  })

  it('selects the rules from item 5, and shows what selected them', async () => {
    const { view } = await runPdf('Distilled spirits')
    expect(view.policy.productType).toBe('Distilled spirits')
    expect(view.policy.selectedRuleIds).toContain('DS-BRAND-NAME-PRESENT')
  })

  it('checks nothing when item 5 could not be settled, and says so', async () => {
    // The screen has to be able to say WHY no rule applied. Without the
    // product type on the view, "no findings" and "nothing could be checked"
    // look identical to an agent — and one of them means the label was never
    // examined against any regulation.
    const { view } = await runPdf(null)
    expect(view.policy.productType).toBeNull()
    expect(view.policy.selectedRuleIds).toEqual([])
    expect(view.findings.map((f) => f.ruleId)).toEqual(['POLICY-SELECTION'])
    // The outcome still reports the alcohol-content mismatch, which is right:
    // a failed selection does not suppress a discrepancy between the two
    // readings. It suppresses the regulation check, and the finding says so.
    expect(view.outcome).toBe('DISCREPANCIES_FOUND')
  })
})

describe('the document the verdict was reached on', () => {
  /*
   * Reported from staging: the results panel showed the label crop and nothing
   * else. The crop is what the model was given; it is not what was filed, and
   * an agent adjudicating a discrepancy needs the document — a verdict that
   * disagrees with the form, or a crop that caught the wrong region, is visible
   * only by looking at both.
   *
   * The batch path has shown the submission since it was built. Single review
   * did not, because it never kept the upload.
   */
  const withSource = async (source?: string) =>
    (
      await reviewOne(
        {
          kind: 'submission',
          image: new ArrayBuffer(8),
          mimeType: 'image/png',
          record: { image: new ArrayBuffer(8), mimeType: 'image/png' },
        },
        {
          provider,
          submissionId: 's-3',
          reference: 'ABCD-9012',
          labelImageUrl: '/review/s-3/label.png',
          ...(source === undefined ? {} : { sourceUrl: source }),
          sourceName: 'TTB-F-5100-31.pdf',
          env: { LEGIBILITY_FLOOR: '30' },
        },
      )
    ).view

  it('carries the submission alongside the crop', async () => {
    expect((await withSource('/review/s-3/source.pdf')).sourceUrl).toBe('/review/s-3/source.pdf')
  })

  it('says there is none rather than inventing a link', async () => {
    // The typed path has no filed document, and a panel pointing at one that
    // does not exist is worse than a panel that is honestly absent.
    expect((await withSource()).sourceUrl).toBeNull()
  })
})
