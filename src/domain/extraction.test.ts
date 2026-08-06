/**
 * Contract tests for the extraction boundary.
 *
 * Test IDs refer to `docs/test-plan.md` §4.
 *
 * CT-10 is the guard test. It asserts structurally — not behaviourally — that
 * application data cannot reach the extractor. A behavioural test would only
 * show that it did not happen this time.
 */

import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  ExtractionContractError,
  type ExtractionRequest,
  parseExtractionResponse,
} from './extraction.js'
import type { ApplicationData } from './types.js'

const wellFormed = {
  fields: {
    brandName: { value: 'OLD TOM DISTILLERY', confidence: 0.97 },
    classType: { value: 'Kentucky Straight Bourbon Whiskey', confidence: 0.95 },
    alcoholContent: { value: '45% Alc./Vol.', confidence: 0.93 },
    netContents: { value: '750 mL', confidence: 0.9 },
  },
  warningStatement: 'GOVERNMENT WARNING: (1) According to the Surgeon General…',
}

describe('CT — the extraction contract', () => {
  it('CT-01 — a well-formed response is accepted', () => {
    const e = parseExtractionResponse(wellFormed)
    expect(e.fields.brandName.raw).toBe('OLD TOM DISTILLERY')
    expect(e.fields.brandName.confidence).toBeCloseTo(0.97)
    expect(e.warningStatement).toContain('GOVERNMENT WARNING')
  })

  it('CT-02 — a field explicitly reported absent is accepted', () => {
    // Absence is a first-class answer, not the absence of an answer (§8.3.2).
    const e = parseExtractionResponse({
      ...wellFormed,
      fields: { ...wellFormed.fields, netContents: { present: false } },
    })
    expect(e.fields.netContents.raw).toBeNull()
    expect(e.fields.netContents.unreadable).toBe(false)
  })

  it('CT-03 — a field explicitly reported unreadable is accepted, and distinct from absent', () => {
    const e = parseExtractionResponse({
      ...wellFormed,
      fields: { ...wellFormed.fields, netContents: { unreadable: true } },
    })
    expect(e.fields.netContents.unreadable).toBe(true)
    expect(e.fields.netContents.raw).toBeNull()
  })

  it('CT-03b — a value reported alongside the unreadable flag is discarded', () => {
    // A model under schema pressure may fill the slot and flag it. The flag
    // wins: a guess must never reach the comparator as a reading.
    const e = parseExtractionResponse({
      ...wellFormed,
      fields: { ...wellFormed.fields, netContents: { value: '700 mL', unreadable: true } },
    })
    expect(e.fields.netContents.raw).toBeNull()
  })

  it('CT-04 — a missing required key is rejected', () => {
    const { netContents: _omitted, ...rest } = wellFormed.fields
    expect(() => parseExtractionResponse({ ...wellFormed, fields: rest })).toThrow(
      /missing required field "netContents"/,
    )
  })

  it('CT-05 — a non-string value is rejected', () => {
    expect(() =>
      parseExtractionResponse({
        ...wellFormed,
        fields: { ...wellFormed.fields, alcoholContent: { value: 45 } },
      }),
    ).toThrow(/non-string value/)
  })

  it('CT-06 — unexpected extra keys are ignored, not rejected', () => {
    const e = parseExtractionResponse({
      ...wellFormed,
      fields: { ...wellFormed.fields, vintage: { value: '2019' } },
      somethingElse: true,
    })
    expect(e.fields.brandName.raw).toBe('OLD TOM DISTILLERY')
  })

  it('CT-07 — confidence outside 0..1 is rejected', () => {
    for (const bad of [-0.1, 1.5]) {
      expect(() =>
        parseExtractionResponse({
          ...wellFormed,
          fields: { ...wellFormed.fields, brandName: { value: 'X', confidence: bad } },
        }),
      ).toThrow(/confidence is outside/)
    }
  })

  it('CT-07b — a non-numeric confidence is rejected', () => {
    expect(() =>
      parseExtractionResponse({
        ...wellFormed,
        fields: { ...wellFormed.fields, brandName: { value: 'X', confidence: 'high' } },
      }),
    ).toThrow(/non-numeric confidence/)
  })

  it('CT-08 — an empty response is rejected', () => {
    expect(() => parseExtractionResponse({})).toThrow(/no "fields" object/)
  })

  it('CT-09 — prose instead of structure is rejected, never parsed defensively', () => {
    expect(() => parseExtractionResponse('The label says Old Tom Distillery, 45%.')).toThrow(
      ExtractionContractError,
    )
  })

  // CT-11 is a guard, and it was written from a live failure rather than
  // imagined. The image was not reaching the model, so it answered from the
  // prompt alone and returned the prompt's own template — verbatim, in every
  // field. The response was schema-valid, so the contract accepted it, the
  // comparison ran on it, and `<text exactly as printed>` was recorded as the
  // observed value of a compliance verdict.
  //
  // A model that echoes the schema has not read anything. That is a broken
  // dependency, not an unreadable label, so it fails the item rather than
  // reporting UNREADABLE: the artwork is fine, and saying otherwise would send
  // a reviewer to look at a label that has nothing wrong with it.
  describe('CT-11 — a template echo is not a reading', () => {
    it('rejects the placeholder the prompt itself supplies', () => {
      expect(() =>
        parseExtractionResponse({
          ...wellFormed,
          fields: {
            ...wellFormed.fields,
            brandName: { value: '<text exactly as printed>', confidence: 0.9 },
          },
        }),
      ).toThrow(ExtractionContractError)
    })

    it('rejects any angle-bracketed placeholder, not just the one we shipped', () => {
      for (const echo of ['<brand name>', '<value>', '<the government warning, verbatim>']) {
        expect(() =>
          parseExtractionResponse({
            ...wellFormed,
            fields: { ...wellFormed.fields, classType: { value: echo, confidence: 1 } },
          }),
        ).toThrow(ExtractionContractError)
      }
    })

    it('rejects a placeholder echoed into the warning statement', () => {
      expect(() =>
        parseExtractionResponse({
          ...wellFormed,
          warningStatement: '<the government warning, verbatim>',
        }),
      ).toThrow(ExtractionContractError)
    })

    // The guard must not fire on real artwork. Angle brackets appear in
    // ordinary text, and a false rejection here fails a submission that is
    // perfectly readable.
    it('accepts real text that merely contains angle brackets', () => {
      const e = parseExtractionResponse({
        ...wellFormed,
        fields: {
          ...wellFormed.fields,
          brandName: { value: 'Smith <&> Sons', confidence: 0.9 },
        },
      })
      expect(e.fields.brandName.raw).toBe('Smith <&> Sons')
    })
  })

  it('rejects a field that is not an object', () => {
    expect(() =>
      parseExtractionResponse({
        ...wellFormed,
        fields: { ...wellFormed.fields, brandName: 'OLD TOM' },
      }),
    ).toThrow(/not an object/)
  })

  it('rejects a non-string warning statement', () => {
    expect(() => parseExtractionResponse({ ...wellFormed, warningStatement: 42 })).toThrow(
      /warningStatement must be a string/,
    )
  })

  it('treats a blank value as absence rather than an empty string', () => {
    // An empty string could later compare equal to something. Absence cannot.
    const e = parseExtractionResponse({
      ...wellFormed,
      fields: { ...wellFormed.fields, classType: { value: '   ' } },
    })
    expect(e.fields.classType.raw).toBeNull()
  })

  it('defaults confidence to 1 when the provider omits it', () => {
    const e = parseExtractionResponse({
      ...wellFormed,
      fields: { ...wellFormed.fields, brandName: { value: 'X' } },
    })
    expect(e.fields.brandName.confidence).toBe(1)
  })

  it('omits the warning statement when it was not requested', () => {
    const e = parseExtractionResponse(wellFormed, { includeWarning: false })
    expect(e.warningStatement).toBeNull()
  })

  it('accepts a subset of fields when only that subset was requested', () => {
    const e = parseExtractionResponse(
      { fields: { brandName: { value: 'OLD TOM' } } },
      { fields: ['brandName'], includeWarning: false },
    )
    expect(e.fields.brandName.raw).toBe('OLD TOM')
  })
})

describe('CT-10 — blind extraction, enforced structurally (D4)', () => {
  it('the request type has no slot for expected values', () => {
    // This is the guard. If ExtractionRequest ever gains a field carrying
    // application data, this assertion fails at compile time — which is the
    // point. A runtime test could only show that anchoring did not happen on
    // one occasion, not that it cannot happen.
    expectTypeOf<ExtractionRequest>().toHaveProperty('region')
    expectTypeOf<ExtractionRequest>().toHaveProperty('image')
    expectTypeOf<ExtractionRequest>().toHaveProperty('fields')
    expectTypeOf<ExtractionRequest>().not.toHaveProperty('application')
    expectTypeOf<ExtractionRequest>().not.toHaveProperty('expected')
    expectTypeOf<ExtractionRequest>().not.toHaveProperty('applicationData')
  })

  it('the request carries field NAMES, never field VALUES', () => {
    // A job description, not an answer key. `fields` is a list of names, so
    // there is nowhere for an expected value to travel.
    expectTypeOf<ExtractionRequest['fields']>().toEqualTypeOf<
      readonly ('brandName' | 'classType' | 'alcoholContent' | 'netContents')[]
    >()
  })

  it('ApplicationData is not assignable to any part of the request', () => {
    expectTypeOf<ApplicationData>().not.toMatchTypeOf<ExtractionRequest['fields']>()
  })

  it('a constructed request contains no application values at runtime', () => {
    const request: ExtractionRequest = {
      region: 'label',
      image: new ArrayBuffer(8),
      mimeType: 'image/png',
      fields: ['brandName', 'classType', 'alcoholContent', 'netContents'],
      includeWarning: true,
    }
    const serialised = JSON.stringify({ ...request, image: '<bytes>' })
    for (const leak of ['Old Tom Distillery', '45%', '750 mL', 'Kentucky']) {
      expect(serialised).not.toContain(leak)
    }
  })
})

/**
 * CT-12 — item 5, TYPE OF PRODUCT.
 *
 * Read from the application record and nowhere else. It is a **classification
 * against three known boxes**, not a transcription, which is the only reason it
 * can be asked of a model at all: the answer is a choice from a closed set, and
 * anything outside that set is a bad read rather than an unusual product.
 *
 * Every case here fails closed, because a wrong product type is the most
 * dangerous single misread in this system. It selects the body of regulation —
 * read `Wine` on a spirits filing and every finding downstream looks perfectly
 * ordinary while the wrong rules were applied. `null` costs a reviewer the
 * sentence "nothing could be checked"; a guess costs them the truth.
 */
describe('CT-12 — the product type is classified, never guessed', () => {
  const withProductType = (productType: unknown) => ({ ...wellFormed, productType })

  const parse = (body: unknown) =>
    parseExtractionResponse(body, { includeWarning: false, includeProductType: true })

  it('CT-12a — one box ticked is read as that type', () => {
    expect(parse(withProductType('Distilled spirits')).productType).toBe('Distilled spirits')
  })

  it('CT-12b — the three form options are all recognised', () => {
    expect(parse(withProductType('Wine')).productType).toBe('Wine')
    expect(parse(withProductType('Malt beverages')).productType).toBe('Malt beverages')
  })

  it('CT-12c — capitalisation follows the form, not the model', () => {
    // The form prints the options in caps. Canonicalising here is what lets a
    // selection input be compared to a rule's `appliesWhen` as a plain string.
    expect(parse(withProductType('DISTILLED SPIRITS')).productType).toBe('Distilled spirits')
    expect(parse(withProductType('  malt beverages ')).productType).toBe('Malt beverages')
  })

  it('CT-12d — null when the model reports no single tick', () => {
    // None ticked, two ticked, or unreadable all arrive here as null: the
    // prompt asks for exactly that rather than for a best effort.
    expect(parse(withProductType(null)).productType).toBeNull()
  })

  it('CT-12e — a value outside the three is null, not the nearest match', () => {
    // "Beer" is very nearly "Malt beverages" and must not become it. The
    // system does not know what the model saw; it only knows this is not one
    // of the three boxes on the form.
    expect(parse(withProductType('Beer')).productType).toBeNull()
    expect(parse(withProductType('Whiskey')).productType).toBeNull()
    expect(parse(withProductType('Wine cooler')).productType).toBeNull()
  })

  it('CT-12f — a missing key is null, and does not fail the whole read', () => {
    // The four compared fields were read perfectly. Throwing the reading away
    // over a checkbox would turn a usable verdict into a dependency failure;
    // reporting that nothing could be checked is the honest, cheaper answer.
    expect(parse(wellFormed).productType).toBeNull()
  })

  it('CT-12g — a non-string is refused rather than coerced', () => {
    expect(() => parse(withProductType(3))).toThrow(ExtractionContractError)
    expect(() => parse(withProductType({ value: 'Wine' }))).toThrow(ExtractionContractError)
  })

  it('CT-12h — the prompt template echoed back is not a reading (CT-11)', () => {
    expect(() =>
      parse(withProductType('<Wine | Distilled spirits | Malt beverages, or null>')),
    ).toThrow(ExtractionContractError)
  })

  it('CT-12i — not asked for means absent, not unresolved', () => {
    // A label read never carries the key at all. "Was not asked" and "was
    // asked and could not be settled" are different facts about a reading.
    const label = parseExtractionResponse(wellFormed)
    expect(label.productType).toBeUndefined()
  })
})

describe('CT-13 — item 19, the declared label reduction (D53)', () => {
  const withReduction = (labelReduction: unknown) => ({ ...wellFormed, labelReduction })
  const parse = (body: unknown) =>
    parseExtractionResponse(body, { includeWarning: false, includeReduction: true })

  it('CT-13a — the percentage is read as printed, not interpreted', () => {
    // The model transcribes; `parseReductionPercent` interprets. Splitting
    // them keeps the model doing perception and the arithmetic testable.
    expect(parse(withReduction('50%')).labelReduction).toBe('50%')
    expect(parse(withReduction('reduced to 75 percent')).labelReduction).toBe(
      'reduced to 75 percent',
    )
  })

  it('CT-13b — nothing stated at item 19 is null, meaning actual size', () => {
    expect(parse(withReduction(null)).labelReduction).toBeNull()
    expect(parse(wellFormed).labelReduction).toBeNull()
  })

  it('CT-13c — a non-string is refused rather than coerced', () => {
    // A number here would be ambiguous in the one way that matters: 50 could
    // be the percentage or the reduction, and the two are inverses.
    expect(() => parse(withReduction(50))).toThrow(ExtractionContractError)
  })

  it('CT-13d — the template echoed back is not a reading (CT-11)', () => {
    expect(() => parse(withReduction('<percentage, or null>'))).toThrow(ExtractionContractError)
  })

  it('CT-13e — not asked for means absent', () => {
    expect(parseExtractionResponse(wellFormed).labelReduction).toBeUndefined()
  })
})

describe('CT-14 — warning geometry, for the §16.22 measurements (D53)', () => {
  const withGeometry = (warningGeometry: unknown) => ({ ...wellFormed, warningGeometry })
  const parse = (body: unknown) =>
    parseExtractionResponse(body, { includeWarning: true, includeGeometry: true })

  const sound = { capHeightPx: 21, longestLineCharacters: 62, longestLineWidthPx: 540 }

  it('CT-14a — the three measurements are carried through', () => {
    expect(parse(withGeometry(sound)).warningGeometry).toEqual(sound)
  })

  it('CT-14b — a measurement that cannot be a length is dropped, not zeroed', () => {
    // Zero would flow into the arithmetic and produce 0.00 mm, which reads as
    // a measured failure rather than an absent measurement.
    const g = parse(withGeometry({ ...sound, capHeightPx: 0 })).warningGeometry
    expect(g?.capHeightPx).toBeNull()
    expect(g?.longestLineCharacters).toBe(62)
  })

  it('CT-14c — a negative or non-numeric measurement is dropped', () => {
    for (const bad of [-4, 'twenty', null, {}]) {
      const g = parse(withGeometry({ ...sound, capHeightPx: bad })).warningGeometry
      expect(g?.capHeightPx, String(bad)).toBeNull()
    }
  })

  it('CT-14d — a missing or malformed block is null, not a partial reading', () => {
    expect(parse(withGeometry(null)).warningGeometry).toBeNull()
    expect(parse(withGeometry('21px')).warningGeometry).toBeNull()
    expect(parse(wellFormed).warningGeometry).toBeNull()
  })

  it('CT-14e — not asked for means absent', () => {
    expect(parseExtractionResponse(wellFormed).warningGeometry).toBeUndefined()
  })
})
