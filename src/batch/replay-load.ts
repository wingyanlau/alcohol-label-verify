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
 */

import type { ApplicationData, Outcome } from '../domain/types.js'
import { FIELDS } from '../domain/types.js'
import { verifySubmission } from '../domain/verify.js'
import { createReplayProvider, type RecordedExtraction } from './replay.js'

export interface StoredVerdict {
  readonly verdictId: string
  readonly submissionId: string
  readonly outcome: Outcome
  readonly warningLegible: boolean
  readonly rulesetVersion: string
  readonly application: ApplicationData
  /** The per-field states as stored. A matching outcome over differing fields
   *  is agreement by coincidence, and would hide a rule that had moved. */
  readonly fieldStates: Readonly<Record<string, string>>
  readonly extractions: readonly RecordedExtraction[]
}

export interface ReplayReport {
  readonly verdictId: string
  readonly submissionId: string
  readonly storedOutcome: Outcome
  readonly replayedOutcome: Outcome
  readonly identical: boolean
  /** Present only when they differ. Empty results are not reported as findings. */
  readonly differences?: readonly string[]
}

export class ReplayUnavailableError extends Error {}

/** Read back everything the verdict was computed from. */
export async function loadStoredVerdict(
  db: D1Database,
  submissionId: string,
): Promise<StoredVerdict> {
  const verdict = await db
    .prepare(
      `SELECT id, submission_id, outcome, warning_legible, ruleset_version
         FROM verdict
        WHERE submission_id = ?1 AND superseded_by IS NULL
        ORDER BY created_at DESC
        LIMIT 1`,
    )
    .bind(submissionId)
    .first<{
      id: string
      submission_id: string
      outcome: string
      warning_legible: number
      ruleset_version: string
    }>()

  if (verdict === null) {
    throw new ReplayUnavailableError(`no verdict stored for submission ${submissionId}`)
  }

  const [fieldRows, extractionRows] = await Promise.all([
    db
      .prepare(`SELECT field, state, expected FROM field_verdict WHERE verdict_id = ?1`)
      .bind(verdict.id)
      .all<{ field: string; state: string; expected: string | null }>(),
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
  ])

  const expected = new Map(fieldRows.results.map((r) => [r.field, r.expected]))
  const application = {} as Record<string, string | null>
  for (const field of FIELDS) application[field] = expected.get(field) ?? null

  return {
    verdictId: verdict.id,
    submissionId: verdict.submission_id,
    outcome: verdict.outcome as Outcome,
    warningLegible: verdict.warning_legible === 1,
    rulesetVersion: verdict.ruleset_version,
    application: application as unknown as ApplicationData,
    fieldStates: Object.fromEntries(fieldRows.results.map((r) => [r.field, r.state])),
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

/**
 * Re-derive, and say whether it matches.
 *
 * Reports the difference rather than asserting sameness. A replay that
 * disagrees is a finding — either the rules moved without a version bump, or
 * the record is incomplete — and both are things someone needs to see, not
 * things to throw away as an error.
 */
export async function replayVerdict(stored: StoredVerdict): Promise<ReplayReport> {
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
    const was = stored.fieldStates[field.field]
    // An unrecorded field is a gap in the record, reported as such rather than
    // passed over — silence is the failure mode this endpoint exists to catch.
    if (was === undefined) {
      differences.push(`${field.field}: not recorded, replayed ${field.state}`)
    } else if (was !== field.state) {
      differences.push(`${field.field}: stored ${was}, replayed ${field.state}`)
    }
  }

  const identical = differences.length === 0
  return {
    verdictId: stored.verdictId,
    submissionId: stored.submissionId,
    storedOutcome: stored.outcome,
    replayedOutcome: result.outcome,
    identical,
    ...(identical ? {} : { differences }),
  }
}
