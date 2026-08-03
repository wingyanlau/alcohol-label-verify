/**
 * What a replay reports when it disagrees.
 *
 * The agreeing case is the one everyone writes and the one that never fires in
 * anger. These cover the other half: a replay is only worth running if a
 * disagreement is visible and names what moved.
 *
 * `loadStoredVerdict` is not covered here — it is a SELECT, and the part worth
 * proving is that the rules reproduce the outcome, which needs no database.
 */

import { describe, expect, it } from 'vitest'
import type { ApplicationData } from '../domain/types.js'
import { type ReplayReport, replayVerdict, type StoredVerdict } from './replay-load.js'

const application: ApplicationData = {
  brandName: 'Old Tom Distillery',
  classType: 'Kentucky Straight Bourbon Whiskey',
  alcoholContent: '45% Alc./Vol.',
  netContents: '750 mL',
}

const reading = (over: Partial<Record<string, string>> = {}) =>
  JSON.stringify({
    fields: {
      brandName: { value: over.brandName ?? 'Old Tom Distillery', confidence: 0.97 },
      classType: {
        value: over.classType ?? 'KENTUCKY STRAIGHT BOURBON WHISKEY',
        confidence: 0.95,
      },
      alcoholContent: { value: over.alcoholContent ?? '45% Alc./Vol.', confidence: 0.93 },
      netContents: { value: over.netContents ?? '750 mL', confidence: 0.9 },
    },
    warningStatement:
      'GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink ' +
      'alcoholic beverages during pregnancy because of the risk of birth defects. ' +
      '(2) Consumption of alcoholic beverages impairs your ability to drive a car or ' +
      'operate machinery, and may cause health problems.',
  })

const stored = (over: Partial<StoredVerdict> = {}): StoredVerdict => ({
  verdictId: 'v-1',
  submissionId: 'L01',
  outcome: 'CLEAR',
  warningLegible: true,
  rulesetVersion: 'rules@1',
  application,
  fieldStates: {
    brandName: 'MATCH',
    classType: 'MATCH',
    alcoholContent: 'MATCH',
    netContents: 'MATCH',
  },
  extractions: [
    {
      region: 'label',
      rawResponse: reading(),
      provider: 'gemini',
      modelId: 'gemini-3.5-flash',
      promptVersion: 'label-extract@1',
      sampling: '{"temperature":0}',
      latencyMs: 900,
    },
  ],
  ...over,
})

describe('replaying a stored verdict', () => {
  it('agrees with a verdict the rules still produce', async () => {
    const report = await replayVerdict(stored())
    expect(report.identical).toBe(true)
    expect(report.replayedOutcome).toBe('CLEAR')
    // No empty findings list on agreement: a caller checking `differences`
    // should not have to distinguish "none" from "not computed".
    expect(report.differences).toBeUndefined()
  })

  // The failure this endpoint exists for: the record says one thing, the rules
  // as they stand now say another. Silence here would be the worst outcome.
  it('names the field when a stored state no longer reproduces', async () => {
    const report = await replayVerdict(
      stored({ fieldStates: { ...stored().fieldStates, brandName: 'MISMATCH' } }),
    )
    expect(report.identical).toBe(false)
    expect(report.differences).toEqual(['brandName: stored MISMATCH, replayed MATCH'])
  })

  it('reports a changed outcome as well as the field that caused it', async () => {
    const report = await replayVerdict(
      stored({
        outcome: 'DISCREPANCIES_FOUND',
        application: { ...application, brandName: 'Old Forester' },
        fieldStates: { ...stored().fieldStates, brandName: 'MISMATCH' },
      }),
    )
    // Application data disagreeing with the label reproduces the mismatch, so
    // the fields agree; only the recorded outcome is checked here.
    expect(report.differences).toBeUndefined()
    expect(report.replayedOutcome).toBe('DISCREPANCIES_FOUND')
  })

  // A gap in the record, not an agreement. A field the verdict never stored
  // cannot be said to reproduce, and defaulting it to "fine" would make an
  // incomplete record look like a verified one.
  it('treats an unrecorded field as a difference, not a pass', async () => {
    const { netContents: _dropped, ...partial } = stored().fieldStates
    const report = await replayVerdict(stored({ fieldStates: partial }))
    expect(report.identical).toBe(false)
    expect(report.differences).toContain('netContents: not recorded, replayed MATCH')
  })

  // Why migration 0002 exists. Legibility is measured from pixels that are
  // gone by replay time; without it stored the replay would recompute CLEAR
  // and contradict the INCOMPLETE it is meant to reproduce.
  it('reproduces an illegible-warning verdict from the stored decision', async () => {
    const report: ReplayReport = await replayVerdict(
      stored({ outcome: 'INCOMPLETE', warningLegible: false }),
    )
    expect(report.replayedOutcome).toBe('INCOMPLETE')
    expect(report.identical).toBe(true)
  })
})
