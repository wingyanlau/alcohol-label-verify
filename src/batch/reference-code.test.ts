/**
 * D21 — the correlation identifier a person can quote.
 *
 * The identifier already existed; it was a UUID, which is not the same thing.
 * An agent reporting a wrong result reads the code aloud or writes it on a
 * form, and `98d097c9-7662-4393-819e-55d4f0987c6c` does not survive that trip.
 */

import { describe, expect, it } from 'vitest'
import { isReferenceCode, referenceCodeFor } from './reference-code.js'

const ID = '98d097c9-7662-4393-819e-55d4f0987c6c'

describe('the reference code', () => {
  it('is the same code every time for the same submission', async () => {
    expect(await referenceCodeFor(ID)).toBe(await referenceCodeFor(ID))
  })

  it('differs between submissions', async () => {
    expect(await referenceCodeFor(ID)).not.toBe(
      await referenceCodeFor('ab73f0b4-275a-4f08-812b-115afc31d0db'),
    )
  })

  // The shape in ui-design §10: two groups of four, hyphenated. Short enough
  // to read down a phone line, long enough not to collide across a corpus.
  it('is two groups of four, in the documented shape', async () => {
    expect(await referenceCodeFor(ID)).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/)
  })

  // Crockford's alphabet, and the reason for it: I/L/O/U are omitted because a
  // person transcribing a code confuses them with 1/1/0/V. A code that cannot
  // be dictated accurately fails at the one job it has.
  it('contains no character that can be misheard or miswritten', async () => {
    const codes = await Promise.all(
      Array.from({ length: 200 }, (_, i) => referenceCodeFor(`submission-${i}`)),
    )
    for (const code of codes) {
      expect(code).not.toMatch(/[ILOU]/)
    }
  })

  it('does not leak the identifier it was derived from', async () => {
    const code = await referenceCodeFor(ID)
    expect(ID.toUpperCase()).not.toContain(code.replace('-', ''))
  })

  // Not a security boundary and not claimed as one: the code is a label for a
  // record, and the record is reachable by whoever can reach the endpoint.
  // Recognising a well-formed code is only to reject typos before a lookup.
  it('recognises its own shape and rejects anything else', () => {
    expect(isReferenceCode('7K2M-4QX9')).toBe(true)
    expect(isReferenceCode('7k2m-4qx9')).toBe(true) // case is forgiving on input
    expect(isReferenceCode('7K2M4QX9')).toBe(false)
    expect(isReferenceCode('7K2M-4QX')).toBe(false)
    expect(isReferenceCode('7I2M-4QX9')).toBe(false) // I is not in the alphabet
    expect(isReferenceCode('')).toBe(false)
  })

  it('is spread across the space rather than clustered', async () => {
    // A derivation that varied only in its last character would collide in
    // practice long before the arithmetic says it should.
    const codes = new Set(
      await Promise.all(Array.from({ length: 500 }, (_, i) => referenceCodeFor(`s-${i}`))),
    )
    expect(codes.size).toBe(500)
  })
})
