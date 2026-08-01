/**
 * Parser unit tests.
 *
 * The parsers are deliberately conservative: unparseable input returns `null`
 * rather than a guess, because a guess becomes a false match downstream — the
 * error direction that lets a non-compliant label pass (§8.3.1).
 */

import { describe, expect, it } from 'vitest'
import { parseAbv, parseProof, parseQuantity } from './parse.js'

describe('parseAbv', () => {
  it('prefers the percentage when proof is also present', () => {
    // The percentage is the primary statement; the proof is derived from it.
    expect(parseAbv('45% Alc./Vol. (90 Proof)')).toEqual({ value: 45, source: 'percent' })
  })

  it('reads a bare number', () => {
    expect(parseAbv('45')).toEqual({ value: 45, source: 'bare-number' })
  })

  it('converts proof when no percentage is stated', () => {
    expect(parseAbv('90 Proof')).toEqual({ value: 45, source: 'proof' })
  })

  it('returns null for text with no numeral', () => {
    expect(parseAbv('forty-five percent')).toBeNull()
  })

  it('returns null for empty input', () => {
    expect(parseAbv('   ')).toBeNull()
  })

  it('handles decimals', () => {
    expect(parseAbv('45.5%')?.value).toBe(45.5)
  })
})

describe('parseProof', () => {
  it('reads a stated proof', () => {
    expect(parseProof('45% Alc./Vol. (90 Proof)')).toBe(90)
  })

  it('is case-insensitive', () => {
    expect(parseProof('80 PROOF')).toBe(80)
  })

  it('returns null when no proof is stated', () => {
    expect(parseProof('45% Alc./Vol.')).toBeNull()
  })
})

describe('parseQuantity', () => {
  const cases: ReadonlyArray<[string, number, string | null]> = [
    ['750 mL', 750, 'mL'],
    ['750ML', 750, 'mL'],
    ['75 cL', 750, 'cL'],
    ['1 L', 1000, 'L'],
    ['7.5 dL', 750, 'dL'],
    ['1 liter', 1000, 'L'],
    ['750 millilitres', 750, 'mL'],
  ]

  it.each(cases)('parses %s', (input, ml, unit) => {
    const q = parseQuantity(input)
    expect(q?.milliliters).toBeCloseTo(ml, 4)
    expect(q?.unit).toBe(unit)
    expect(q?.unitAssumed).toBe(false)
  })

  it('converts fluid ounces', () => {
    expect(parseQuantity('25.4 fl oz')?.milliliters).toBeCloseTo(751.17, 1)
  })

  it('assumes millilitres for a bare number, and says so', () => {
    const q = parseQuantity('750')
    expect(q?.milliliters).toBe(750)
    expect(q?.unit).toBeNull()
    expect(q?.unitAssumed).toBe(true)
  })

  it('returns null for an unrecognised unit rather than guessing', () => {
    expect(parseQuantity('750 gallons')).toBeNull()
  })

  it('returns null for empty input', () => {
    expect(parseQuantity('')).toBeNull()
  })

  it('returns null for text with no numeral', () => {
    expect(parseQuantity('a bottle')).toBeNull()
  })
})
