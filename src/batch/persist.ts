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
import { approverFor, citationFor, regulationSourceFor } from '../domain/findings.js'
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
  /**
   * Whether the warning was legible enough to verify.
   *
   * Stored because the verdict depends on it and it cannot be recomputed: the
   * measurement is taken from pixels that are transient, so a replay reading
   * only the record would default to legible and reach a different verdict
   * than the one it is supposed to reproduce (NFR-13).
   */
  readonly warningLegible: boolean
  /**
   * The rule-set binding (D26). Null when no policy set governed the check.
   *
   * `policySetVersion` is deliberately not folded into `policyVersion` above,
   * which means the region maps and intake policy — an unrelated thing with a
   * confusingly similar name (§18.3). Overloading it would make two independent
   * things move together and leave neither traceable.
   */
  readonly policySetVersion: number | null
  /** JSON array of rule ids, in the order applied. */
  readonly selectedRuleIds: string | null
  /** JSON object of the record values selection ran on. */
  readonly selectionInputs: string | null
  readonly submittedOn: string | null
  /** The two dates that rebuild the rule set (D41, D42). Always written. */
  readonly validOn: string
  readonly asOf: string
}

export interface PolicyFindingRow {
  readonly ruleId: string
  readonly requirement: string
  readonly state: string
  readonly severity: string
  readonly evidence: string
  /**
   * The rule as applied, frozen onto the finding (D44).
   *
   * The citation used to be resolved against *today's* archive when somebody
   * read the verdict, so a rule since retired yielded nothing and a rule whose
   * regulation moved yielded the wrong section. The parameters that decided the
   * outcome were stored nowhere at all — two rules with identical prose and
   * different permitted values were indistinguishable in the record.
   *
   * Null for `POLICY-SELECTION`, which cites no rule because none was reached.
   */
  readonly regulationId: string | null
  readonly citation: string | null
  readonly quote: string | null
  readonly checkParams: string | null
  readonly approvedBy: string | null
  /**
   * Which regulation text this finding rests on, and from which issue.
   *
   * Carried because `quote` is null for every enacted rule — they hold no
   * provenance — and a digest identifies the source exactly where a fragment
   * would only describe it.
   */
  readonly regulationDigest: string | null
  readonly regulationIssued: string | null
}

export interface PersistPlan {
  readonly verdict: VerdictRow
  readonly fields: readonly FieldVerdictRow[]
  readonly warning: readonly WarningVerdictRow[]
  readonly findings: readonly PolicyFindingRow[]
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

  // No rules applied is recorded as no binding, not as version 0. A verdict
  // that names a policy set is claiming rules were applied.
  const applied = result.policy.selectedRuleIds.length > 0

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
      warningLegible: result.warning.legible,
      policySetVersion: applied ? result.policy.policySetVersion : null,
      selectedRuleIds: applied ? JSON.stringify(result.policy.selectedRuleIds) : null,
      selectionInputs: applied ? JSON.stringify(result.policy.selectionInputs) : null,
      submittedOn: applied ? result.policy.submittedOn : null,
      // Always written, unlike the binding above: the dates are true of the
      // judgement whether or not any rule was selected, and a replay needs them
      // precisely when nothing was applied — to establish that nothing SHOULD
      // have been.
      validOn: result.policy.validOn,
      asOf: result.policy.asOf,
    },
    fields: fieldRows(result.fields),
    warning: warningRows(result.warning),
    findings: result.findings.map((f) => {
      // The rule this finding came from, as it was applied — not as the archive
      // holds it now.
      const applied = result.appliedRules.find((r) => r.id === f.ruleId)
      const source = applied === undefined ? null : regulationSourceFor(applied.id)
      return {
        ruleId: f.ruleId,
        requirement: f.requirement,
        state: f.state,
        severity: f.severity,
        evidence: f.evidence,
        regulationId: applied?.regulation ?? null,
        citation: applied === undefined ? null : citationFor(applied.id),
        quote: applied?.provenance?.quote ?? null,
        checkParams: applied === undefined ? null : JSON.stringify(applied.check),
        // The rule's own approver, or the set's — the enacted rules carry none
        // of their own and are covered one level up (D27).
        approvedBy: applied === undefined ? null : approverFor(applied.id),
        regulationDigest: source?.digest ?? null,
        regulationIssued: source?.issued ?? null,
      }
    }),
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
            policy_version, aggregation_version, extraction_ids, created_at,
            warning_legible, policy_set_version, selected_rule_ids,
            selection_inputs, submitted_on, valid_on, as_of)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        plan.verdict.warningLegible ? 1 : 0,
        plan.verdict.policySetVersion,
        plan.verdict.selectedRuleIds,
        plan.verdict.selectionInputs,
        plan.verdict.submittedOn,
        plan.verdict.validOn,
        plan.verdict.asOf,
      ),
  )

  for (const f of plan.findings) {
    statements.push(
      db
        .prepare(
          `INSERT INTO policy_finding
             (verdict_id, rule_id, requirement, state, severity, evidence,
              regulation_id, citation, quote, check_params, approved_by,
              regulation_digest, regulation_issued)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          plan.verdict.id,
          f.ruleId,
          f.requirement,
          f.state,
          f.severity,
          f.evidence,
          f.regulationId,
          f.citation,
          f.quote,
          f.checkParams,
          f.approvedBy,
          f.regulationDigest,
          f.regulationIssued,
        ),
    )
  }

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
