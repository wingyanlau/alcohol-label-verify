/**
 * Turn a verification result into durable rows.
 *
 * Design reference: §8.7 (the audit record), migrations/0001_init.sql.
 *
 * The row-building is pure and tested directly: given a `VerifyResult` and a set
 * of identifiers, the rows are fixed. Execution against D1 is a thin, separate
 * step (`persistResult`), so the mapping — the part with the compliance content
 * (FR-10) — is verified without a database.
 *
 * What is kept is the evidence, never the artwork: extracted values live in
 * `field_verdict` because an agent acted on them; the label pixels do not,
 * because the reading is what a decision is defended with, not the image
 * (schema §1). The raw model response is retained as both provenance and test
 * fixture (§8.7.1).
 */

import type { ExtractionProvenance } from '../domain/extraction.js'
import type { FieldVerdict, WarningVerdict } from '../domain/types.js'
import type { VerifyResult } from '../domain/verify.js'
import { AGGREGATION_VERSION, POLICY_VERSION, RULESET_VERSION } from './versions.js'

export interface ExtractionRow {
  readonly id: string
  readonly submissionId: string
  readonly region: 'label' | 'record'
  readonly method: 'vision' | 'text-layer'
  readonly provider: string
  readonly modelId: string
  readonly promptVersion: string
  readonly sampling: string
  readonly rasterDpi: number | null
  readonly rawResponse: string
  readonly latencyMs: number
}

export interface FieldVerdictRow {
  readonly field: string
  readonly state: string
  readonly expected: string | null
  readonly observed: string | null
  readonly rule: string
  readonly explanation: string | null
}

export interface WarningVerdictRow {
  readonly segmentId: string
  readonly ok: 0 | 1
  readonly observed: string | null
  readonly deviation: string | null
}

export interface VerdictRow {
  readonly id: string
  readonly submissionId: string
  readonly outcome: string
  readonly rulesetVersion: string
  readonly referenceDataVersion: number
  readonly policyVersion: string
  readonly aggregationVersion: string
  readonly extractionIds: string
}

export interface PersistPlan {
  readonly verdict: VerdictRow
  readonly fields: readonly FieldVerdictRow[]
  readonly warning: readonly WarningVerdictRow[]
  readonly extractions: readonly ExtractionRow[]
}

export interface PersistIds {
  readonly verdictId: string
  readonly submissionId: string
  /** Extraction row id per region. `record` is absent when only the label was read. */
  readonly labelExtractionId: string
  readonly recordExtractionId: string | null
}

function fieldRows(fields: readonly FieldVerdict[]): FieldVerdictRow[] {
  return fields.map((f) => ({
    field: f.field,
    state: f.state,
    expected: f.expected,
    observed: f.observed,
    rule: f.rule,
    explanation: f.explanation ?? null,
  }))
}

function warningRows(warning: WarningVerdict): WarningVerdictRow[] {
  return warning.segments.map((s) => ({
    segmentId: s.segmentId,
    ok: s.ok ? 1 : 0,
    observed: s.observed,
    deviation: s.deviation ?? null,
  }))
}

function extractionRow(
  id: string,
  submissionId: string,
  region: 'label' | 'record',
  provenance: ExtractionProvenance,
  rawResponse: string,
  rasterDpi: number | null,
): ExtractionRow {
  return {
    id,
    submissionId,
    region,
    // The label is always read from pixels (schema CHECK); the record is too on
    // the batch path — both extractions are blind (batch design §1.2).
    method: 'vision',
    provider: provenance.provider,
    modelId: provenance.modelId,
    promptVersion: provenance.promptVersion,
    sampling: JSON.stringify(provenance.samplingParameters),
    rasterDpi,
    rawResponse,
    latencyMs: provenance.latencyMs,
  }
}

/**
 * Map a result to the rows that record it.
 *
 * Pure: identifiers and DPI are supplied, so the same result maps to the same
 * plan every time.
 */
export function buildPersistPlan(
  result: VerifyResult,
  ids: PersistIds,
  rasterDpi: number | null,
): PersistPlan {
  const extractions: ExtractionRow[] = [
    extractionRow(
      ids.labelExtractionId,
      ids.submissionId,
      'label',
      result.provenance.label,
      result.rawResponses.label,
      rasterDpi,
    ),
  ]
  if (ids.recordExtractionId && result.provenance.record && result.rawResponses.record !== null) {
    extractions.push(
      extractionRow(
        ids.recordExtractionId,
        ids.submissionId,
        'record',
        result.provenance.record,
        result.rawResponses.record,
        rasterDpi,
      ),
    )
  }

  return {
    verdict: {
      id: ids.verdictId,
      submissionId: ids.submissionId,
      outcome: result.outcome,
      rulesetVersion: RULESET_VERSION,
      referenceDataVersion: result.warning.referenceDataVersion,
      policyVersion: POLICY_VERSION,
      aggregationVersion: AGGREGATION_VERSION,
      extractionIds: JSON.stringify(extractions.map((e) => e.id)),
    },
    fields: fieldRows(result.fields),
    warning: warningRows(result.warning),
    extractions,
  }
}

/**
 * Execute a plan against D1 in one atomic batch.
 *
 * `submission` is updated to its terminal state in the same batch, so the
 * durable record and the submission's state never disagree.
 */
export async function persistResult(
  db: D1Database,
  plan: PersistPlan,
  submissionState: 'COMPLETED' | 'FAILED',
  now: string,
): Promise<void> {
  const statements: D1PreparedStatement[] = []

  for (const e of plan.extractions) {
    statements.push(
      db
        .prepare(
          `INSERT INTO extraction
             (id, submission_id, region, method, provider, model_id, prompt_version,
              sampling, raster_dpi, raw_response, latency_ms, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          e.id,
          e.submissionId,
          e.region,
          e.method,
          e.provider,
          e.modelId,
          e.promptVersion,
          e.sampling,
          e.rasterDpi,
          e.rawResponse,
          e.latencyMs,
          now,
        ),
    )
  }

  statements.push(
    db
      .prepare(
        `INSERT INTO verdict
           (id, submission_id, outcome, ruleset_version, reference_data_version,
            policy_version, aggregation_version, extraction_ids, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        plan.verdict.id,
        plan.verdict.submissionId,
        plan.verdict.outcome,
        plan.verdict.rulesetVersion,
        plan.verdict.referenceDataVersion,
        plan.verdict.policyVersion,
        plan.verdict.aggregationVersion,
        plan.verdict.extractionIds,
        now,
      ),
  )

  for (const f of plan.fields) {
    statements.push(
      db
        .prepare(
          `INSERT INTO field_verdict
             (verdict_id, field, state, expected, observed, rule, explanation)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(plan.verdict.id, f.field, f.state, f.expected, f.observed, f.rule, f.explanation),
    )
  }

  for (const w of plan.warning) {
    statements.push(
      db
        .prepare(
          `INSERT INTO warning_verdict (verdict_id, segment_id, ok, observed, deviation)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(plan.verdict.id, w.segmentId, w.ok, w.observed, w.deviation),
    )
  }

  statements.push(
    db
      .prepare(`UPDATE submission SET state = ? WHERE id = ?`)
      .bind(submissionState, plan.verdict.submissionId),
  )

  await db.batch(statements)
}
