/**
 * The instruction itself.
 *
 * Untested until now, which was a gap with a shape: the prompt is the only
 * input to extraction that is not data, and every verdict in the system rests
 * on it. Two properties are worth asserting, and neither is about wording.
 *
 * **Nothing that anchors.** D4 keeps expected values away from the extractor
 * because a model that can see them tends to confirm them, and every such error
 * is a false *match* — a non-compliant label passing review. The prompt is
 * built from a request that carries no application data at all, so the property
 * holds structurally; what these tests pin is that the two regions ask
 * different questions, and that the label is never asked which regulation
 * governs the bottle.
 *
 * **The digest covers what was actually sent.** It exists so a prompt edited
 * without a version bump cannot leave audit records citing a version that no
 * longer describes the instruction. Taken over the label region alone, it did
 * not cover the record region — and the change that added item 5 to the record
 * prompt passed straight through it.
 */

import { describe, expect, it } from 'vitest'
import type { ExtractionRequest } from '../domain/extraction.js'
import { FORM_PRODUCT_TYPES } from '../domain/types.js'
import { buildPrompt, digestedPromptText, promptDigest } from './prompt.js'

const request = (over: Partial<ExtractionRequest> = {}): ExtractionRequest => ({
  region: 'label',
  image: new ArrayBuffer(0),
  mimeType: 'image/png',
  fields: ['brandName', 'classType', 'alcoholContent', 'netContents'],
  includeWarning: true,
  ...over,
})

describe('the extraction instruction', () => {
  it('never asks the label which product this is (D25)', () => {
    // No label states "Distilled spirits". Asking here would invite the model
    // to infer the governing body of regulation from the artwork — the bottle
    // choosing the law it is judged by.
    const label = buildPrompt(request())
    for (const type of FORM_PRODUCT_TYPES) {
      expect(label).not.toContain(type)
    }
    expect(label.toLowerCase()).not.toContain('productType'.toLowerCase())
  })

  it('asks the record for item 5 as a closed choice', () => {
    const record = buildPrompt(request({ region: 'record', includeProductType: true }))
    for (const type of FORM_PRODUCT_TYPES) {
      expect(record).toContain(type)
    }
    // The refusal has to be as easy as the answer (§8.3.2), and here it is the
    // *safe* answer: a guessed product type selects the wrong regulation and
    // every finding after it looks perfectly ordinary.
    expect(record).toMatch(/return null/i)
    expect(record).toMatch(/do not infer/i)
  })

  it('leaves item 5 out when it was not asked for', () => {
    const record = buildPrompt(request({ region: 'record', includeWarning: false }))
    expect(record).not.toContain('TYPE OF PRODUCT')
  })

  it('asks for the warning verbatim only where the warning is wanted', () => {
    expect(buildPrompt(request())).toMatch(/VERBATIM/)
    expect(buildPrompt(request({ includeWarning: false }))).not.toMatch(/VERBATIM/)
  })
})

describe('the prompt digest', () => {
  it('is stable across calls', async () => {
    expect(await promptDigest()).toBe(await promptDigest())
  })

  it('covers the record region, not only the label', async () => {
    // The gap this pins: the digest was taken over the label form alone. The
    // record prompt could then be rewritten — as it was, to add item 5 — with
    // the digest unmoved and every audit record still citing a version that no
    // longer described the instruction actually sent.
    const text = digestedPromptText()
    expect(text).toContain('TYPE OF PRODUCT')
    expect(text).toContain('the government warning, verbatim')
    expect((await promptDigest()).length).toBe(16)
  })
})
