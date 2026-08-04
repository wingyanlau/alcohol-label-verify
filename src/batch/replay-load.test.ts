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
import { POLICY_SET } from '../domain/findings.js'
import type { ApplicationData } from '../domain/types.js'
import { sha256Hex } from './digest.js'
import type { RecordedExtraction } from './replay.js'
import {
  applicationFrom,
  type ReplayReport,
  replayVerdict,
  type StoredVerdict,
} from './replay-load.js'
import { AGGREGATION_VERSION, POLICY_VERSION, RULESET_VERSION } from './versions.js'

const application: ApplicationData = {
  brandName: 'Old Tom Distillery',
  classType: 'Kentucky Straight Bourbon Whiskey',
  alcoholContent: '45% Alc./Vol.',
  netContents: '750 mL',
  // Stated on the application, and the input rule selection runs on (D25).
  productType: 'Distilled spirits',
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
  policySetVersion: POLICY_SET.policySetVersion,
  submittedOn: '2026-08-01',
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

/**
 * Rebuilding the application record the verdict was computed from.
 *
 * This was a genuine break, not a hypothetical. The record was rebuilt from
 * `FIELDS` alone, and product type is not one of them — no label states
 * "Distilled spirits", so nothing compares it and no `field_verdict` row keeps
 * it. Every replay therefore selected no rules, produced the "nothing could be
 * checked" finding, and re-derived `CLEAR_CONFIRM_POLICY` where the verdict
 * said `CLEAR`. Reported as a regression in the comparison rules, on every
 * submission that had ever been checked.
 *
 * It survived a green suite because the fixture above supplies a product type
 * the database could not. So the reconstruction is now tested where it lives,
 * against the columns it actually reads.
 */
describe('the application record, rebuilt from the row', () => {
  const expected = new Map([
    ['brandName', 'Old Tom Distillery'],
    ['classType', 'Kentucky Straight Bourbon Whiskey'],
    ['alcoholContent', '45% Alc./Vol.'],
    ['netContents', '750 mL'],
  ])

  it('takes the compared fields from what the verdict recorded', () => {
    const record = applicationFrom(expected, null)
    expect(record.brandName).toBe('Old Tom Distillery')
    expect(record.netContents).toBe('750 mL')
  })

  it('recovers the product type from the selection inputs bound to the verdict', () => {
    // The reason D26 binds the inputs and not only the policy-set version.
    const record = applicationFrom(expected, '{"productType":"Distilled spirits"}')
    expect(record.productType).toBe('Distilled spirits')
  })

  it('reports no product type when the verdict bound none', () => {
    expect(applicationFrom(expected, null).productType).toBeNull()
    expect(applicationFrom(expected, '{}').productType).toBeNull()
  })

  it('reports no product type rather than throwing on a binding it cannot read', () => {
    // A replay is a diagnostic. It should say what it could not reproduce, not
    // fail on the way in.
    for (const broken of ['not json', 'null', '[]', '{"productType":42}']) {
      expect(applicationFrom(expected, broken).productType, broken).toBeNull()
    }
  })

  it('reproduces the stored outcome once the product type is recovered', async () => {
    // End to end, through the path that was broken: a record rebuilt the way
    // production rebuilds it must re-derive the verdict it came from.
    const rebuilt = applicationFrom(expected, '{"productType":"Distilled spirits"}')
    const report = await replayVerdict(stored({ application: rebuilt }))
    expect(report.status).toBe('identical')
    expect(report.replayedOutcome).toBe('CLEAR')
  })
})

describe('the filing date a replay judges by', () => {
  it('uses the date the application was filed, not today', async () => {
    // Standards of fill changed in January 2025. Re-deriving a 2024 filing
    // against today's list applies a rule that never governed it — and the
    // disagreement would be reported as a regression in this system.
    const report = await replayVerdict(
      stored({ submittedOn: '2024-06-01', policySetVersion: POLICY_SET.policySetVersion }),
    )
    expect(report.status).toBe('identical')
  })

  it('falls back to the day the verdict was written when none was bound', async () => {
    const report = await replayVerdict(stored({ submittedOn: null, policySetVersion: null }))
    expect(report.status).toBe('identical')
  })
})

describe('rules that have moved since the verdict was recorded', () => {
  it('refuses when the rule set has moved (§18.3)', async () => {
    // The rule set joins the versioned identity set. A verdict reached under an
    // earlier policy must not be silently re-derived under today's rules and
    // reported as agreeing.
    const report = await replayVerdict(stored({ policySetVersion: 99 }))
    expect(report.status).toBe('not-comparable')
    expect(report.differences?.join(' ')).toMatch(/policy set.*99/)
  })

  it('does not refuse a verdict that bound no rule set at all', async () => {
    // Null means no rule was applied — a verdict from before the policy layer,
    // or one whose product type was never stated. Replay applies none either,
    // so nothing has moved. Treating these as not-comparable would retire the
    // endpoint for every record already written.
    const report = await replayVerdict(stored({ policySetVersion: null, submittedOn: null }))
    expect(report.status).not.toBe('not-comparable')
  })

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

/** The same record with its stored reading edited — what tampering looks like. */
const tampered = (s: StoredVerdict): RecordedExtraction => ({
  ...(s.extractions[0] as RecordedExtraction),
  rawResponse: reading({ brandName: 'Old Forester' }),
})

describe('the reading the verdict was computed from', () => {
  // The gap this closes. The hash chain covers `audit_event`; the readings live
  // in `extraction`, which nothing hashed. Recording the digest of each reading
  // in a chained event makes the reading itself tamper-evident, because
  // altering it now requires forging the chain.
  it('is verified against the digest recorded in the chain', async () => {
    const s = stored()
    const report = await replayVerdict({
      ...s,
      recordedDigests: { label: await sha256Hex(reading()) },
    })
    expect(report.integrity).toBe('verified')
    expect(report.status).toBe('identical')
  })

  // What single-table tampering looks like once the digest exists: not "the
  // rules moved" — which is what an altered reading looked like before, and
  // would have sent someone hunting through the comparison code — but the
  // record itself failing to match what was committed.
  it('is reported as altered, not as a rule change, when it no longer matches', async () => {
    const s = stored()
    const report = await replayVerdict({
      ...s,
      extractions: [tampered(s)],
      recordedDigests: { label: await sha256Hex(reading()) },
    })
    expect(report.status).toBe('record-altered')
    expect(report.integrity).toBe('altered')
    expect(report.differences?.join(' ')).toMatch(/label reading/i)
  })

  // Checked before anything else: if the inputs are not the recorded inputs,
  // every downstream comparison is being made against the wrong thing, and a
  // verdict derived from them would be reported as though it meant something.
  it('is checked before the rules are, so tampering is not mistaken for drift', async () => {
    const s = stored()
    const report = await replayVerdict({
      ...s,
      rulesetVersion: 'compare@0',
      extractions: [tampered(s)],
      recordedDigests: { label: await sha256Hex(reading()) },
    })
    expect(report.status).toBe('record-altered')
  })

  it('produces no outcome when the record cannot be trusted', async () => {
    const s = stored()
    const report = await replayVerdict({
      ...s,
      extractions: [tampered(s)],
      recordedDigests: { label: await sha256Hex(reading()) },
    })
    expect(report.replayedOutcome).toBeNull()
  })

  // Verdicts recorded before the digest existed. Their readings cannot be
  // checked, and saying so is different from saying they are fine — but it is
  // also not a failure, so the replay proceeds and reports the limit.
  it('says so plainly when no digest was recorded', async () => {
    const report = await replayVerdict(stored())
    expect(report.integrity).toBe('not-recorded')
    expect(report.status).toBe('identical')
  })
})
