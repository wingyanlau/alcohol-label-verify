/**
 * Comparing a fresh reading against the one a verdict rests on.
 *
 * The failure modes here are all about **what a difference is taken to mean**.
 * Overstate it and a stable system looks unreliable; understate it and a verdict
 * resting on a reading nobody can reproduce passes without comment.
 */

import { describe, expect, it } from 'vitest'
import type { Extraction, ObservedField } from '../domain/types.js'
import { compareReadings } from './reread.js'

const f = (raw: string | null, unreadable = false): ObservedField => ({
  raw,
  confidence: 0.95,
  unreadable,
})

const reading = (
  over: Partial<Record<string, ObservedField>> = {},
  warning: string | null = 'W',
): Extraction =>
  ({
    fields: {
      brandName: f('OLD TOM DISTILLERY'),
      classType: f('Kentucky Straight Bourbon Whiskey'),
      alcoholContent: f('45% Alc./Vol.'),
      netContents: f('750 mL'),
      ...over,
    },
    warningStatement: warning,
  }) as unknown as Extraction

const sameReader = {
  recordedModel: 'gemini-3.5-flash',
  freshModel: 'gemini-3.5-flash',
  recordedPrompt: 'label-extract@2',
  freshPrompt: 'label-extract@2',
}

describe('re-reading the artwork', () => {
  it('reports a reproduced reading as identical', () => {
    const r = compareReadings('label', reading(), reading(), sameReader)
    expect(r.identical).toBe(true)
    expect(r.sameReader).toBe(true)
  })

  it('localises a difference to the field that moved', () => {
    const r = compareReadings(
      'label',
      reading(),
      reading({ alcoholContent: f('40% Alc./Vol.') }),
      sameReader,
    )
    expect(r.identical).toBe(false)
    expect(r.fields.filter((x) => !x.same).map((x) => x.field)).toEqual(['alcoholContent'])
  })

  it('counts a changed warning transcription as a difference', () => {
    // The warning is the field most likely to move on a degraded scan, and the
    // one where a difference matters most — FR-5 turns on it word for word.
    const r = compareReadings(
      'label',
      reading({}, 'GOVERNMENT WARNING: …'),
      reading({}, 'Government Warning: …'),
      sameReader,
    )
    expect(r.warningStatement.same).toBe(false)
    expect(r.identical).toBe(false)
  })

  it('separates "read differently" from "declined to read"', () => {
    // Different destinations for a reviewer: one sends them to the artwork,
    // the other to the model. Collapsing them would send them to the wrong one.
    const r = compareReadings(
      'label',
      reading(),
      reading({ netContents: f(null, true) }),
      sameReader,
    )
    const net = r.fields.find((x) => x.field === 'netContents')
    expect(net?.same).toBe(false)
    expect(net?.unreadable).toBe(true)
  })

  it('says when the reader is not the one that answered originally', () => {
    // A deployment reconfigured, or a prompt revised, means the two readings
    // come from different agents (D29). A difference then says the reader
    // changed, not that perception drifted — and reporting it without this
    // would attribute a configuration change to the model.
    const r = compareReadings('label', reading(), reading({ brandName: f('OLD TOM') }), {
      ...sameReader,
      freshModel: '@cf/meta/llama-4-scout-17b-16e-instruct',
    })
    expect(r.sameReader).toBe(false)
    expect(r.identical).toBe(false)
  })

  it('notices a prompt revision even when the model is unchanged', () => {
    // The prompt is half the reader. Same weights, different instruction, is a
    // different agent for this purpose.
    const r = compareReadings('label', reading(), reading(), {
      ...sameReader,
      freshPrompt: 'label-extract@3',
    })
    expect(r.sameReader).toBe(false)
    // And the readings still agreed, which is worth reporting rather than
    // hiding behind the reader mismatch.
    expect(r.identical).toBe(true)
  })

  it('treats absence as absence, not as an empty string', () => {
    const r = compareReadings(
      'label',
      reading({ classType: f(null) }),
      reading({ classType: f(null) }),
      sameReader,
    )
    expect(r.fields.find((x) => x.field === 'classType')?.same).toBe(true)
  })
})
