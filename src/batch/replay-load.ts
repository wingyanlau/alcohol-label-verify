/**
 * Loading a stored verdict back out, so it can be re-derived (NFR-13).
 *
 * Separate from `replay.ts` because that module is pure and this one talks to
 * D1. The split keeps the re-derivation itself testable without a database,
 * which matters: the part worth proving is that the rules reproduce the
 * outcome, not that a SELECT works.
 *
 * Everything needed comes from the record and nothing from the artefact. The
 * application data is read back from `field_verdict.expected` — what the
 * comparison was actually given, rather than what a re-read of the PDF would
 * produce today — because a replay that re-derived its own inputs would be
 * checking the pipeline, not the verdict.
 *
 * ---------------------------------------------------------------------------
 * WHAT A REPLAY CAN AND CANNOT ESTABLISH
 *
 * It establishes that the stored reading, the stored application data and the
 * versioned rules yield the stored verdict.
 *
 * It does not establish that the reading was right — that is B-Q4, and the
 * corpus answers it. Nor does it establish that the record is unaltered: the
 * hash chain covers `audit_event`, not the extraction rows this reads from,
 * and the application data comes from `field_verdict.expected`, so a replay is
 * partly circular by construction. Editing a stored value changes the input
 * and the output together. What replay catches is the rules moving underneath
 * a record, which is the failure it was built for.
 */

import { warningReference } from '../domain/reference.js'
import type { ApplicationData, Outcome } from '../domain/types.js'
import { FIELDS } from '../domain/types.js'
import { verifySubmission } from '../domain/verify.js'
import { createReplayProvider, type RecordedExtraction } from './replay.js'
import { AGGREGATION_VERSION, POLICY_VERSION, RULESET_VERSION } from './versions.js'

/** One field exactly as the verdict recorded it. */
export interface StoredField {
  readonly state: string
  /** What the model read. Compared as well as the state — see `replayVerdict`. */
  readonly observed: string | null
}

/** One clause of the health warning as the verdict recorded it. */
export interface StoredWarningSegment {
  readonly segmentId: string
  readonly ok: boolean
  readonly observed: string | null
  readonly deviation: string | null
}

export interface StoredVerdict {
  readonly verdictId: string
  readonly submissionId: string
  readonly outcome: Outcome
  readonly warningLegible: boolean
  readonly createdAt: string
  /**
   * Whether this verdict is new enough to carry the legibility decision.
   *
   * False for anything written before migration 0002, where the column did not
   * exist and every row defaulted to legible. Such a verdict cannot be
   * re-derived — not because anything is wrong, but because the record lacks an
   * input the comparison used.
   */
  readonly legibilityRecorded: boolean
  /** The versioned identity set (§9.4.6). Checked, not merely carried. */
  readonly rulesetVersion: string
  readonly policyVersion: string
  readonly aggregationVersion: string
  readonly referenceDataVersion: number
  readonly application: ApplicationData
  readonly fields: Readonly<Record<string, StoredField>>
  readonly warningSegments: readonly StoredWarningSegment[]
  readonly extractions: readonly RecordedExtraction[]
}

/**
 * What a replay concluded.
 *
 * Four outcomes rather than a boolean, because "it did not match" conflates
 * three unrelated situations and only one of them is a defect:
 *
 *   identical        the record reproduces its verdict
 *   differs          the rules produce something else from the same inputs —
 *                    a regression, or an unversioned rule change
 *   not-comparable   the rules or reference data have moved since, so the
 *                    comparison would be between two different systems
 *   not-re-derivable the record is missing an input the verdict depended on
 *
 * Collapsing these is what makes a replay endpoint useless in practice: if
 * every historical verdict reports "differs", a real regression arrives inside
 * a pile of expected failures and nobody looks.
 */
export type ReplayStatus = 'identical' | 'differs' | 'not-comparable' | 'not-re-derivable'

export interface ReplayReport {
  readonly verdictId: string
  readonly submissionId: string
  readonly status: ReplayStatus
  readonly storedOutcome: Outcome
  readonly replayedOutcome: Outcome | null
  /** Present only when something is wrong. Empty lists are not findings. */
  readonly differences?: readonly string[]
}

export class ReplayUnavailableError extends Error {}

interface VerdictRow {
  id: string
  submission_id: string
  outcome: string
  warning_legible: number
  ruleset_version: string
  policy_version: string
  aggregation_version: string
  reference_data_version: number
  created_at: string
}

/**
 * When migration 0002 was applied, from D1's own migration log.
 *
 * Read rather than hard-coded: the timestamp differs per environment, and a
 * constant would silently misclassify verdicts in any deployment migrated on a
 * different day. Null when the row cannot be read, which is treated as "cannot
 * tell" and leaves the verdict re-derivable rather than condemning it.
 *
 * NOTE the format. D1 writes `2026-08-03 19:15:02`, with a space; `created_at`
 * is ISO with a `T` and a `Z`. Compared as strings they never order correctly —
 * `'T' > ' '` — so the migration stamp is normalised here rather than in a
 * WHERE clause, where the same mistake once made a retention query silently
 * match nothing.
 */
async function legibilityRecordedSince(db: D1Database): Promise<string | null> {
  try {
    const row = await db
      .prepare(`SELECT applied_at FROM d1_migrations WHERE name LIKE '0002%' LIMIT 1`)
      .first<{ applied_at: string }>()
    if (!row?.applied_at) return null
    return `${row.applied_at.replace(' ', 'T')}Z`
  } catch {
    return null
  }
}

/** Read back everything the verdict was computed from. */
export async function loadStoredVerdict(
  db: D1Database,
  submissionId: string,
): Promise<StoredVerdict> {
  const verdict = await db
    .prepare(
      `SELECT id, submission_id, outcome, warning_legible, ruleset_version, policy_version,
              aggregation_version, reference_data_version, created_at
         FROM verdict
        WHERE submission_id = ?1 AND superseded_by IS NULL
        ORDER BY created_at DESC
        LIMIT 1`,
    )
    .bind(submissionId)
    .first<VerdictRow>()

  if (verdict === null) {
    throw new ReplayUnavailableError(`no verdict stored for submission ${submissionId}`)
  }

  const [fieldRows, warningRows, extractionRows, since] = await Promise.all([
    db
      .prepare(`SELECT field, state, expected, observed FROM field_verdict WHERE verdict_id = ?1`)
      .bind(verdict.id)
      .all<{ field: string; state: string; expected: string | null; observed: string | null }>(),
    db
      .prepare(
        `SELECT segment_id, ok, observed, deviation FROM warning_verdict WHERE verdict_id = ?1`,
      )
      .bind(verdict.id)
      .all<{ segment_id: string; ok: number; observed: string | null; deviation: string | null }>(),
    db
      .prepare(
        `SELECT region, raw_response, provider, model_id, prompt_version, sampling, latency_ms
           FROM extraction
          WHERE submission_id = ?1
          ORDER BY created_at ASC`,
      )
      .bind(submissionId)
      .all<{
        region: string
        raw_response: string
        provider: string | null
        model_id: string | null
        prompt_version: string | null
        sampling: string | null
        latency_ms: number
      }>(),
    legibilityRecordedSince(db),
  ])

  const expected = new Map(fieldRows.results.map((r) => [r.field, r.expected]))
  const application = {} as Record<string, string | null>
  for (const field of FIELDS) application[field] = expected.get(field) ?? null

  return {
    verdictId: verdict.id,
    submissionId: verdict.submission_id,
    outcome: verdict.outcome as Outcome,
    warningLegible: verdict.warning_legible === 1,
    createdAt: verdict.created_at,
    legibilityRecorded: since === null || verdict.created_at >= since,
    rulesetVersion: verdict.ruleset_version,
    policyVersion: verdict.policy_version,
    aggregationVersion: verdict.aggregation_version,
    referenceDataVersion: verdict.reference_data_version,
    application: application as unknown as ApplicationData,
    fields: Object.fromEntries(
      fieldRows.results.map((r) => [r.field, { state: r.state, observed: r.observed }]),
    ),
    warningSegments: warningRows.results.map((r) => ({
      segmentId: r.segment_id,
      ok: r.ok === 1,
      observed: r.observed,
      deviation: r.deviation,
    })),
    extractions: extractionRows.results.map((r) => ({
      region: r.region as 'label' | 'record',
      rawResponse: r.raw_response,
      provider: r.provider,
      modelId: r.model_id,
      promptVersion: r.prompt_version,
      sampling: r.sampling,
      latencyMs: r.latency_ms,
    })),
  }
}

/** Rules that have moved since the verdict was recorded, named. */
function versionDrift(stored: StoredVerdict): string[] {
  const current = warningReference()
  const drift: string[] = []
  const check = (what: string, was: string | number, now: string | number) => {
    if (String(was) !== String(now)) drift.push(`${what}: recorded under ${was}, now ${now}`)
  }
  check('ruleset', stored.rulesetVersion, RULESET_VERSION)
  check('policy', stored.policyVersion, POLICY_VERSION)
  check('aggregation', stored.aggregationVersion, AGGREGATION_VERSION)
  // The one that matters most: FR-5 is word-for-word, so a verdict produced
  // against one statutory text tells you nothing about today's.
  check('reference data', stored.referenceDataVersion, current.configVersion)
  return drift
}

/**
 * Re-derive, and say whether it matches.
 *
 * Reports the difference rather than asserting sameness. A replay that
 * disagrees is a finding — either the rules moved without a version bump, or
 * the record is incomplete — and both are things someone needs to see, not
 * things to throw away as an error.
 *
 * Order matters. The versioned identity set is checked BEFORE the comparison
 * runs, because re-deriving under different rules and finding the same answer
 * is coincidence, and reporting it as verification would be the single most
 * misleading thing this endpoint could do.
 */
export async function replayVerdict(stored: StoredVerdict): Promise<ReplayReport> {
  const base = {
    verdictId: stored.verdictId,
    submissionId: stored.submissionId,
    storedOutcome: stored.outcome,
  }

  const drift = versionDrift(stored)
  if (drift.length > 0) {
    return {
      ...base,
      status: 'not-comparable',
      // Deliberately not re-derived. Producing an outcome here would invite
      // someone to compare it, which is the mistake this branch prevents.
      replayedOutcome: null,
      differences: drift,
    }
  }

  if (!stored.legibilityRecorded) {
    return {
      ...base,
      status: 'not-re-derivable',
      replayedOutcome: null,
      differences: [
        'warning legibility was not recorded on this verdict (predates migration 0002), ' +
          'and the comparison used it — the record is missing an input, not wrong',
      ],
    }
  }

  const result = await verifySubmission(
    {
      label: { image: new ArrayBuffer(0), mimeType: 'image/png' },
      record: { applicationData: stored.application },
    },
    {
      provider: createReplayProvider(stored.extractions),
      warningLegible: stored.warningLegible,
    },
  )

  const differences: string[] = []
  if (result.outcome !== stored.outcome) {
    differences.push(`outcome: stored ${stored.outcome}, replayed ${result.outcome}`)
  }

  for (const field of result.fields) {
    const was = stored.fields[field.field]
    // An unrecorded field is a gap in the record, reported as such rather than
    // passed over — silence is the failure mode this endpoint exists to catch.
    if (was === undefined) {
      differences.push(`${field.field}: not recorded, replayed ${field.state}`)
      continue
    }
    if (was.state !== field.state) {
      differences.push(`${field.field}: state stored ${was.state}, replayed ${field.state}`)
    }
    // The value as well as the state. Two readings can both be MATCH while
    // showing a reviewer different text, and the text is what FR-10 puts on
    // screen — so a changed reading that keeps its state is still a change.
    if ((was.observed ?? null) !== (field.observed ?? null)) {
      differences.push(
        `${field.field}: observed stored "${was.observed}", replayed "${field.observed}"`,
      )
    }
  }

  // The warning is half the verdict, and the half FR-5 and FR-6 turn on.
  const bySegment = new Map(stored.warningSegments.map((s) => [s.segmentId, s]))
  for (const seg of result.warning.segments) {
    const was = bySegment.get(seg.segmentId)
    if (was === undefined) {
      differences.push(`warning ${seg.segmentId}: not recorded, replayed ok=${seg.ok}`)
      continue
    }
    if (was.ok !== seg.ok) {
      differences.push(`warning ${seg.segmentId}: stored ok=${was.ok}, replayed ok=${seg.ok}`)
    }
    if ((was.deviation ?? null) !== (seg.deviation ?? null)) {
      differences.push(
        `warning ${seg.segmentId}: deviation stored "${was.deviation}", replayed "${seg.deviation}"`,
      )
    }
  }

  return {
    ...base,
    status: differences.length === 0 ? 'identical' : 'differs',
    replayedOutcome: result.outcome,
    ...(differences.length === 0 ? {} : { differences }),
  }
}
