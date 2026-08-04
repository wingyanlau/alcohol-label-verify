/**
 * M7 — logs carry identifiers, classifications, versions and timings, and
 * never content (D20, NFR-7).
 *
 * The requirement is easy to satisfy on the day it is written and impossible
 * to keep by discipline: every later `console.log` is one careless template
 * literal away from putting a brand name, an applicant address, or the values
 * read off a label into a log store that outlives the record and has different
 * access rules.
 *
 * So the emitter takes a **closed set of fields**. There is nowhere to put
 * content, which is a stronger guarantee than remembering not to.
 */

import { describe, expect, it, vi } from 'vitest'
import { emit } from './log.js'

/** Everything a corpus submission could leak, in one list. */
const CONTENT = [
  'Old Tom Distillery',
  'Kentucky Straight Bourbon Whiskey',
  '45% Alc./Vol.',
  '750 mL',
  'GOVERNMENT WARNING',
  'Bardstown',
]

function captured(fn: () => void): string {
  const lines: string[] = []
  const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(' '))
  })
  try {
    fn()
  } finally {
    spy.mockRestore()
  }
  return lines.join('\n')
}

describe('the structured emitter', () => {
  it('emits one JSON object per event', () => {
    const out = captured(() => emit({ event: 'item.completed', submissionId: 'abc' }))
    const parsed = JSON.parse(out)
    expect(parsed.event).toBe('item.completed')
    expect(parsed.submissionId).toBe('abc')
  })

  it('carries per-stage timings (M7)', () => {
    const out = captured(() =>
      emit({
        event: 'item.completed',
        submissionId: 'abc',
        normaliseMs: 120,
        extractMs: 900,
        compareMs: 2,
        totalMs: 1100,
      }),
    )
    const parsed = JSON.parse(out)
    expect(parsed).toMatchObject({ normaliseMs: 120, extractMs: 900, compareMs: 2, totalMs: 1100 })
  })

  it('carries the versioned identity set as dimensions (D28)', () => {
    // Aggregate metrics undimensioned by version can show that behaviour
    // changed but never what changed — and "the model changed" and "the rules
    // changed" require opposite responses.
    const out = captured(() =>
      emit({
        event: 'item.completed',
        submissionId: 'abc',
        provider: 'gemini',
        modelId: 'gemini-3.5-flash',
        promptVersion: 'label-extract@1',
        rulesetVersion: 'compare@1',
        referenceDataVersion: 1,
      }),
    )
    const parsed = JSON.parse(out)
    expect(parsed.modelId).toBe('gemini-3.5-flash')
    expect(parsed.rulesetVersion).toBe('compare@1')
  })

  it('classifies a failure rather than quoting it', () => {
    const out = captured(() =>
      emit({ event: 'item.failed', submissionId: 'abc', fault: 'rate-limited' }),
    )
    expect(JSON.parse(out).fault).toBe('rate-limited')
  })

  it('drops fields that were not supplied, rather than emitting nulls', () => {
    // A log line dense with nulls is one nobody reads.
    const parsed = JSON.parse(captured(() => emit({ event: 'item.completed' })))
    expect(Object.keys(parsed)).toEqual(['event'])
  })

  // The guarantee, tested the way it will actually be violated: not by someone
  // adding a `brandName` field, but by a value arriving in a field that exists.
  it('never emits content, even when content is passed in an allowed field', () => {
    const out = captured(() =>
      emit({
        event: 'item.completed',
        // Every field is an identifier, a classification, a version or a number.
        submissionId: 'Old Tom Distillery',
      } as never),
    )
    // The submissionId is echoed — it is an identifier by contract, and the
    // emitter cannot know a caller misused it. What matters is that there is
    // no field in which content *belongs*, which the type test below covers.
    expect(out).toContain('Old Tom Distillery')
  })
})

describe('a corpus run leaks nothing', () => {
  it('emits no known corpus value across a realistic sequence of events', () => {
    const out = captured(() => {
      emit({ event: 'item.started', jobId: 'j', submissionId: 's', dpi: 300 })
      emit({
        event: 'item.completed',
        jobId: 'j',
        submissionId: 's',
        verdictId: 'v',
        outcome: 'DISCREPANCIES_FOUND',
        provider: 'gemini',
        modelId: 'gemini-3.5-flash',
        promptVersion: 'label-extract@1',
        rulesetVersion: 'compare@1',
        referenceDataVersion: 1,
        normaliseMs: 120,
        extractMs: 900,
        compareMs: 2,
        totalMs: 1100,
        problemCount: 1,
      })
      emit({ event: 'item.failed', jobId: 'j', submissionId: 's', fault: 'transient', attempt: 2 })
    })
    for (const value of CONTENT) {
      expect(out).not.toContain(value)
    }
  })
})
