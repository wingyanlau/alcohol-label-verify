/**
 * NFR-13 — a verdict is re-derivable exactly, without re-invoking the model.
 *
 * The claim the audit record makes. Until this test existed the record said
 * what produced a verdict and nobody had shown the verdict could be produced
 * again from it.
 */

import { describe, expect, it } from 'vitest'
import { verifySubmission } from '../domain/verify.js'
import { createReplayProvider, type RecordedExtraction } from './replay.js'

const application = {
  brandName: 'Old Tom Distillery',
  classType: 'Kentucky Straight Bourbon Whiskey',
  alcoholContent: '45% Alc./Vol.',
  netContents: '750 mL',
}

const labelReading = JSON.stringify({
  fields: {
    brandName: { value: 'Old Tom Distillery', confidence: 0.97 },
    classType: { value: 'KENTUCKY STRAIGHT BOURBON WHISKEY', confidence: 0.95 },
    alcoholContent: { value: '45% Alc./Vol.', confidence: 0.93 },
    netContents: { value: '750 mL', confidence: 0.9 },
  },
  warningStatement:
    'GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink ' +
    'alcoholic beverages during pregnancy because of the risk of birth defects. ' +
    '(2) Consumption of alcoholic beverages impairs your ability to drive a car or ' +
    'operate machinery, and may cause health problems.',
})

const recorded = (over: Partial<RecordedExtraction> = {}): RecordedExtraction => ({
  region: 'label',
  rawResponse: labelReading,
  provider: 'gemini',
  modelId: 'gemini-3.5-flash',
  promptVersion: 'label-extract@1',
  sampling: '{"temperature":0}',
  latencyMs: 900,
  ...over,
})

const replay = (opts: { legible?: boolean; recordedRows?: RecordedExtraction[] } = {}) =>
  verifySubmission(
    {
      // No image is read. The bytes are gone; the reading is what survives.
      label: { image: new ArrayBuffer(0), mimeType: 'image/png' },
      record: { applicationData: application },
    },
    {
      provider: createReplayProvider(opts.recordedRows ?? [recorded()]),
      ...(opts.legible === false ? { warningLegible: false } : {}),
    },
  )

describe('replaying a recorded verdict', () => {
  it('reaches a verdict without calling a model', async () => {
    const result = await replay()
    expect(result.outcome).toBe('CLEAR')
    // Provenance is the recorded one, not a fresh claim: the replay did not
    // read anything, and must not appear to have done.
    expect(result.provenance.label.provider).toBe('gemini')
    expect(result.provenance.label.modelId).toBe('gemini-3.5-flash')
  })

  it('is bit-identical across repeated replays', async () => {
    const a = await replay()
    const b = await replay()
    expect(JSON.stringify(a.fields)).toBe(JSON.stringify(b.fields))
    expect(JSON.stringify(a.warning.segments)).toBe(JSON.stringify(b.warning.segments))
    expect(a.outcome).toBe(b.outcome)
  })

  // The reason the migration exists. Legibility decides the verdict and cannot
  // be recomputed — the pixels are transient — so a replay that defaulted it
  // would disagree with the verdict it is meant to reproduce.
  it('reproduces INCOMPLETE when the warning was recorded as illegible', async () => {
    expect((await replay({ legible: false })).outcome).toBe('INCOMPLETE')
    expect((await replay()).outcome).toBe('CLEAR')
  })

  it('goes through the same comparison the live path uses', async () => {
    // Not a parallel implementation: the replay provider satisfies the same
    // interface, so a rule change that altered live verdicts alters replays
    // too — which is what makes disagreement meaningful rather than expected.
    const result = await replay()
    expect(result.fields.map((f) => f.field).sort()).toEqual([
      'alcoholContent',
      'brandName',
      'classType',
      'netContents',
    ])
    expect(result.warning.segments.length).toBeGreaterThan(0)
  })

  it('refuses to invent a reading it was not given', async () => {
    await expect(replay({ recordedRows: [] })).rejects.toThrow(/no recorded extraction/i)
  })
})
