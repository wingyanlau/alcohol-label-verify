/**
 * Reference-data validation.
 *
 * FR-5 compares against a constant loaded from configuration. If that file is
 * malformed the system must fail loudly at the boundary — a partially-parsed
 * warning statement would produce confident nonsense in a compliance verdict,
 * which is the worst failure class this system has.
 */

import { describe, expect, it } from 'vitest'
import { parseWarningReference, referenceIsUnverified, warningReference } from './reference.js'

const valid = {
  configVersion: 1,
  citation: '27 CFR 16.21',
  appliesTo: 'All alcoholic beverages',
  verificationStatus: 'UNCONFIRMED',
  segments: [
    { id: 'header', label: 'Header', text: 'GOVERNMENT WARNING:', caseSensitive: true },
    {
      id: 'clause_1',
      label: 'One',
      text: '(1) According to the Surgeon General.',
      caseSensitive: false,
    },
  ],
  advisoryChecks: [{ id: 'a', text: 'check this', citation: '27 CFR 16.22' }],
}

describe('parseWarningReference — accepts well-formed data', () => {
  it('parses a valid document', () => {
    const ref = parseWarningReference(valid)
    expect(ref.configVersion).toBe(1)
    expect(ref.segments).toHaveLength(2)
    expect(ref.segments[0]?.caseSensitive).toBe(true)
  })

  it('falls back to the id when a segment has no label', () => {
    const ref = parseWarningReference({
      ...valid,
      segments: [{ id: 'header', text: 'X', caseSensitive: true }],
    })
    expect(ref.segments[0]?.label).toBe('header')
  })

  it('tolerates missing advisory checks', () => {
    expect(parseWarningReference({ ...valid, advisoryChecks: undefined }).advisoryChecks).toEqual(
      [],
    )
  })

  it('coerces advisory fields to strings rather than trusting them', () => {
    const ref = parseWarningReference({
      ...valid,
      advisoryChecks: [{ id: 1, text: 2, citation: 3 }],
    })
    expect(ref.advisoryChecks[0]).toEqual({ id: '1', text: '2', citation: '3' })
  })
})

describe('parseWarningReference — rejects malformed data', () => {
  const cases: ReadonlyArray<[string, unknown, RegExp]> = [
    ['not an object', 'a string', /not an object/],
    ['null', null, /not an object/],
    ['non-integer configVersion', { ...valid, configVersion: 1.5 }, /configVersion/],
    ['missing configVersion', { ...valid, configVersion: undefined }, /configVersion/],
    [
      'unknown verification status',
      { ...valid, verificationStatus: 'MAYBE' },
      /verificationStatus/,
    ],
    ['segments not an array', { ...valid, segments: 'x' }, /segments/],
    ['segments empty', { ...valid, segments: [] }, /segments/],
    ['segment not an object', { ...valid, segments: ['x'] }, /segment 0/],
    ['segment without id', { ...valid, segments: [{ text: 'x', caseSensitive: true }] }, /no id/],
    ['segment without text', { ...valid, segments: [{ id: 'h', caseSensitive: true }] }, /no text/],
    [
      'segment without caseSensitive',
      { ...valid, segments: [{ id: 'h', text: 'x' }] },
      /caseSensitive/,
    ],
  ]

  it.each(cases)('throws on %s', (_name, input, message) => {
    expect(() => parseWarningReference(input)).toThrow(message)
  })
})

describe('the shipped reference data', () => {
  it('loads and is well-formed', () => {
    const ref = warningReference()
    expect(ref.segments.length).toBeGreaterThanOrEqual(3)
    expect(ref.segments.some((s) => s.caseSensitive)).toBe(true)
  })

  it('is cached — repeated loads return the same object', () => {
    expect(warningReference()).toBe(warningReference())
  })

  it('reports its verification status honestly (M0, Q1a)', () => {
    // FR-5 rests on a constant that has not been checked against the primary
    // source. The system must be able to say so rather than imply confidence.
    expect(referenceIsUnverified()).toBe(warningReference().verificationStatus !== 'CONFIRMED')
  })

  it('the header segment is case-sensitive — FR-6 depends on it', () => {
    expect(warningReference().segments.find((s) => s.id === 'header')?.caseSensitive).toBe(true)
  })

  it('the clause segments are not case-sensitive', () => {
    const clauses = warningReference().segments.filter((s) => s.id !== 'header')
    expect(clauses.every((s) => !s.caseSensitive)).toBe(true)
  })
})
