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
import { AGGREGATION_VERSION, POLICY_VERSION, RULESET_VERSION } from './versions.js'

const application: ApplicationData = {
  brandName: 'Old Tom Distillery',
  classType: 'Kentucky Straight Bourbon Whiskey',
  alcoholContent: '45% Alc./Vol.',
  netContents: '750 mL',
}

const WARNING =
  'GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink ' +
  'alcoholic beverages during pregnancy because of the risk of birth defects. ' +
  '(2) Consumption of alcoholic beverages impairs your ability to drive a car or ' +
  'operate machinery, and may cause health problems.'

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
    warningStatement: over.warningStatement ?? WARNING,
  })

/** The three clauses as the reference data segments them, all matching. */
const okSegments = [
  { segmentId: 'header', ok: true, observed: null, deviation: null },
  { segmentId: 'clause_1', ok: true, observed: null, deviation: null },
  { segmentId: 'clause_2', ok: true, observed: null, deviation: null },
]

const stored = (over: Partial<StoredVerdict> = {}): StoredVerdict => ({
  verdictId: 'v-1',
  submissionId: 'L01',
  outcome: 'CLEAR',
  warningLegible: true,
  createdAt: '2026-08-03T20:00:00.000Z',
  legibilityRecorded: true,
  rulesetVersion: RULESET_VERSION,
  policyVersion: POLICY_VERSION,
  aggregationVersion: AGGREGATION_VERSION,
  referenceDataVersion: 1,
  application,
  fields: {
    brandName: { state: 'MATCH', observed: 'Old Tom Distillery' },
    classType: { state: 'MATCH', observed: 'KENTUCKY STRAIGHT BOURBON WHISKEY' },
    alcoholContent: { state: 'MATCH', observed: '45% Alc./Vol.' },
    netContents: { state: 'MATCH', observed: '750 mL' },
  },
  warningSegments: okSegments,
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
    expect(report.status).toBe('identical')
    expect(report.replayedOutcome).toBe('CLEAR')
    // No empty findings list on agreement: a caller checking `differences`
    // should not have to distinguish "none" from "not computed".
    expect(report.differences).toBeUndefined()
  })

  // The failure this endpoint exists for: the record says one thing, the rules
  // as they stand now say another. Silence here would be the worst outcome.
  it('names the field when a stored state no longer reproduces', async () => {
    const s = stored()
    const report = await replayVerdict({
      ...s,
      fields: { ...s.fields, brandName: { state: 'MISMATCH', observed: 'Old Tom Distillery' } },
    })
    expect(report.status).toBe('differs')
    expect(report.differences).toContain('brandName: state stored MISMATCH, replayed MATCH')
  })

  // A state is not the whole verdict. Two readings can both be MATCH while
  // showing a reviewer different text, and the values are what FR-10 puts on
  // screen — so a changed reading that keeps its state must not pass.
  it('notices a changed value even when the state is unchanged', async () => {
    const s = stored()
    const report = await replayVerdict({
      ...s,
      fields: { ...s.fields, brandName: { state: 'MATCH', observed: 'OLD TOM DISTILLERY' } },
    })
    expect(report.status).toBe('differs')
    expect(report.differences?.join(' ')).toMatch(/brandName: observed stored "OLD TOM DISTILLERY"/)
  })

  // Half the verdict lives here, and it is the half FR-5 and FR-6 turn on.
  // A warning rule that changed a segment without flipping the outcome would
  // otherwise replay as identical.
  it('compares the warning statement segment by segment', async () => {
    const s = stored()
    const report = await replayVerdict({
      ...s,
      warningSegments: [
        {
          segmentId: 'header',
          ok: false,
          observed: 'Government Warning:',
          deviation: 'not capitals',
        },
        ...okSegments.slice(1),
      ],
    })
    expect(report.status).toBe('differs')
    expect(report.differences?.join(' ')).toMatch(/header/)
  })

  it('reports a warning segment the record never stored', async () => {
    const report = await replayVerdict(stored({ warningSegments: okSegments.slice(1) }))
    expect(report.status).toBe('differs')
    expect(report.differences?.join(' ')).toMatch(/header: not recorded/)
  })

  // A gap in the record, not an agreement. A field the verdict never stored
  // cannot be said to reproduce, and defaulting it to "fine" would make an
  // incomplete record look like a verified one.
  it('treats an unrecorded field as a difference, not a pass', async () => {
    const s = stored()
    const { netContents: _dropped, ...partial } = s.fields
    const report = await replayVerdict({ ...s, fields: partial })
    expect(report.status).toBe('differs')
    expect(report.differences?.join(' ')).toMatch(/netContents: not recorded/)
  })

  // Why migration 0002 exists. Legibility is measured from pixels that are
  // gone by replay time; without it stored the replay would recompute CLEAR
  // and contradict the INCOMPLETE it is meant to reproduce.
  it('reproduces an illegible-warning verdict from the stored decision', async () => {
    const report: ReplayReport = await replayVerdict(
      stored({
        outcome: 'INCOMPLETE',
        warningLegible: false,
        // An illegible warning still produces segment rows; the outcome is what
        // the legibility decision changes.
      }),
    )
    expect(report.replayedOutcome).toBe('INCOMPLETE')
    expect(report.status).toBe('identical')
  })
})

describe('rules that have moved since the verdict was recorded', () => {
  // The most misleading possible "identical": re-deriving against today's
  // statutory text a verdict that was produced against yesterday's. FR-5 is
  // word-for-word, so this is exactly where agreement means least.
  it('refuses to call a verdict re-derived when the reference data has changed', async () => {
    const report = await replayVerdict(stored({ referenceDataVersion: 99 }))
    expect(report.status).toBe('not-comparable')
    expect(report.differences?.join(' ')).toMatch(/reference data.*99.*1|referenceData/i)
  })

  it('refuses when the comparison rules have changed', async () => {
    const report = await replayVerdict(stored({ rulesetVersion: 'compare@0' }))
    expect(report.status).toBe('not-comparable')
    expect(report.differences?.join(' ')).toMatch(/compare@0/)
  })

  it('refuses when aggregation has changed', async () => {
    const report = await replayVerdict(stored({ aggregationVersion: 'aggregate@0' }))
    expect(report.status).toBe('not-comparable')
  })

  // Reported before the comparison runs, not after — and no outcome is offered
  // at all. Re-deriving under different rules would produce a verdict that
  // looks comparable and is not, and someone would compare it. Withholding it
  // is the point: there is no number here that would mean anything.
  it('offers no outcome to compare', async () => {
    const report = await replayVerdict(stored({ rulesetVersion: 'compare@0' }))
    expect(report.replayedOutcome).toBeNull()
    expect(report.status).toBe('not-comparable')
  })
})

describe('verdicts older than the record they would need', () => {
  // Every verdict written before migration 0002 lacks the legibility decision,
  // so none of them can be re-derived. Reported as its own status rather than
  // as a disagreement: if they all read as "differs", a genuine regression
  // arrives inside a pile of expected failures and nobody sees it.
  it('is distinguishable from a rule that moved', async () => {
    const report = await replayVerdict(stored({ legibilityRecorded: false }))
    expect(report.status).toBe('not-re-derivable')
    expect(report.differences?.join(' ')).toMatch(/legibility/i)
  })

  it('offers no outcome to compare', async () => {
    // It would re-derive to the same answer for most labels, because most are
    // legible and the missing value defaults that way. That is luck, not
    // evidence — so no outcome is produced for anyone to mistake for one.
    const report = await replayVerdict(stored({ legibilityRecorded: false }))
    expect(report.replayedOutcome).toBeNull()
    expect(report.status).toBe('not-re-derivable')
  })
})
