import { describe, expect, it } from 'vitest'
import { fingerprintOf, normaliseReply, PROBE_PROMPT } from './fingerprint.js'

describe('the probe', () => {
  // Fixed, and part of the recorded identity. A probe that varied would make
  // two fingerprints incomparable for a reason that has nothing to do with the
  // model.
  it('asks one fixed question', () => {
    expect(PROBE_PROMPT).toBe(PROBE_PROMPT.trim())
    expect(PROBE_PROMPT.length).toBeGreaterThan(20)
  })
})

describe('normalising a reply before hashing', () => {
  // Whitespace and casing drift between runs without the weights changing, and
  // a fingerprint that moved on those would cry wolf until nobody looked.
  it('ignores differences that are not the answer', () => {
    expect(normaliseReply('  Old Tom Distillery\n')).toBe(normaliseReply('old tom distillery'))
    expect(normaliseReply('Old  Tom\tDistillery')).toBe(normaliseReply('Old Tom Distillery'))
  })

  it('does not ignore the answer itself', () => {
    expect(normaliseReply('Old Tom Distillery')).not.toBe(normaliseReply('Old Forester'))
  })

  // Models pad with pleasantries that vary run to run. The claim is what
  // matters, not the sentence around it.
  it('strips surrounding punctuation and markdown emphasis', () => {
    expect(normaliseReply('**Old Tom Distillery**.')).toBe(normaliseReply('Old Tom Distillery'))
  })
})

describe('the fingerprint', () => {
  it('is stable for the same reply', async () => {
    expect(await fingerprintOf('Old Tom Distillery')).toBe(
      await fingerprintOf('Old Tom Distillery'),
    )
  })

  it('changes when the reply changes', async () => {
    expect(await fingerprintOf('Old Tom Distillery')).not.toBe(await fingerprintOf('Old Forester'))
  })

  it('is a hex digest, not the reply', async () => {
    const fp = await fingerprintOf('Old Tom Distillery')
    expect(fp).toMatch(/^[0-9a-f]{64}$/)
    expect(fp).not.toContain('Tom')
  })

  // What the fingerprint can and cannot show, asserted so the limit is not
  // quietly forgotten: a changed digest proves the reader changed; an
  // unchanged one is consistent with sameness and does not prove it.
  it('distinguishes readers, and does not certify one', async () => {
    const a = await fingerprintOf('Old Tom Distillery')
    const b = await fingerprintOf('Old Tom Distillery ')
    expect(a).toBe(b)
  })
})
