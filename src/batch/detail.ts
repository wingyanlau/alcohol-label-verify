/**
 * Read a stored verdict back for the results view.
 *
 * Design reference: ui-design §5–§7, FR-10.
 *
 * The worklist stream carries only a summary (batch design §7.1); the full
 * record is fetched when a row is opened. This assembles that record from D1 and
 * the reference data — the field rows with both values and the rule that decided
 * each (FR-10), the warning statement by segment, and the advisory checklist the
 * system cannot judge from an image (FR-6a).
 *
 * It reads only. The verdict was computed once, deterministically, by the item
 * worker; nothing here re-derives it.
 */

import { OUTCOME_HEADLINE } from '../domain/aggregate.js'
import { referenceIsUnverified, warningReference } from '../domain/reference.js'
import type { FieldName, Outcome } from '../domain/types.js'
import { FIELD_LABELS, FIELDS } from '../domain/types.js'
import { referenceCodeFor } from './reference-code.js'

export interface DetailField {
  readonly field: string
  readonly label: string
  readonly state: string
  readonly expected: string | null
  readonly observed: string | null
  readonly rule: string
  readonly explanation: string | null
}

export interface DetailWarningSegment {
  readonly segmentId: string
  readonly label: string
  readonly ok: boolean
  readonly required: string
  readonly observed: string | null
  readonly deviation: string | null
}

export interface SubmissionDetail {
  readonly submissionId: string
  readonly sourceName: string
  readonly state: string
  readonly outcome: Outcome | null
  readonly headline: string | null
  readonly cause: string | null
  readonly fields: readonly DetailField[]
  readonly warning: {
    readonly evaluated: boolean
    readonly ok: boolean
    readonly segments: readonly DetailWarningSegment[]
    readonly advisory: readonly { id: string; text: string; citation: string }[]
    /** The statutory text has not been confirmed against the primary source (M0). */
    readonly referenceUnverified: boolean
  }
  readonly labelImageUrl: string
  /**
   * The quotable identifier (D21). Derived from `submissionId`, so it is
   * stable and needs no storage — see `reference-code.ts`.
   */
  readonly reference: string
  /**
   * When the staged content was deleted under the retention policy, or null
   * while it is still held. The panels read this rather than discovering the
   * absence by failing to load an image — "deleted on 3 August" is a policy
   * working; a broken panel is a tool that looks broken.
   */
  readonly contentPurgedAt: string | null
}

interface SubmissionRecord {
  source_name: string
  state: string
  failure_cause: string | null
  content_purged_at: string | null
}
interface VerdictRecord {
  id: string
  outcome: string
}
interface FieldRecord {
  field: string
  state: string
  expected: string | null
  observed: string | null
  rule: string
  explanation: string | null
}
interface WarningRecord {
  segment_id: string
  ok: number
  observed: string | null
  deviation: string | null
}

/**
 * Load one submission's full result, or `null` if the submission is unknown.
 *
 * A submission with no verdict yet (queued, running, or failed before a verdict)
 * returns its state and cause with empty field/warning sections, so the caller
 * can render "still running" or a failure without a second shape.
 */
export async function loadSubmissionDetail(
  db: D1Database,
  submissionId: string,
  labelImageUrl: string,
): Promise<SubmissionDetail | null> {
  const reference = await referenceCodeFor(submissionId)
  const submission = await db
    .prepare(
      `SELECT source_name, state, failure_cause, content_purged_at FROM submission WHERE id = ?`,
    )
    .bind(submissionId)
    .first<SubmissionRecord>()
  if (submission === null) return null

  const verdict = await db
    .prepare(
      `SELECT id, outcome FROM verdict
        WHERE submission_id = ? AND superseded_by IS NULL
        ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(submissionId)
    .first<VerdictRecord>()

  const ref = warningReference()
  const advisory = ref.advisoryChecks.map((a) => ({ id: a.id, text: a.text, citation: a.citation }))
  const referenceUnverified = referenceIsUnverified(ref)

  if (verdict === null) {
    return {
      submissionId,
      sourceName: submission.source_name,
      state: submission.state,
      outcome: null,
      headline: null,
      cause: submission.failure_cause,
      fields: [],
      warning: { evaluated: false, ok: false, segments: [], advisory, referenceUnverified },
      labelImageUrl,
      reference,
      contentPurgedAt: submission.content_purged_at,
    }
  }

  const fieldRows = (
    await db
      .prepare(
        `SELECT field, state, expected, observed, rule, explanation
           FROM field_verdict WHERE verdict_id = ?`,
      )
      .bind(verdict.id)
      .all<FieldRecord>()
  ).results

  const byField = new Map(fieldRows.map((r) => [r.field, r]))
  const fields: DetailField[] = FIELDS.map((name: FieldName) => {
    const r = byField.get(name)
    return {
      field: name,
      label: FIELD_LABELS[name],
      state: r?.state ?? 'NOT_SUPPLIED',
      expected: r?.expected ?? null,
      observed: r?.observed ?? null,
      rule: r?.rule ?? '',
      explanation: r?.explanation ?? null,
    }
  })

  const warningRows = (
    await db
      .prepare(
        `SELECT segment_id, ok, observed, deviation FROM warning_verdict WHERE verdict_id = ?`,
      )
      .bind(verdict.id)
      .all<WarningRecord>()
  ).results
  const bySegment = new Map(warningRows.map((r) => [r.segment_id, r]))

  const segments: DetailWarningSegment[] = ref.segments.map((seg) => {
    const r = bySegment.get(seg.id)
    return {
      segmentId: seg.id,
      label: seg.label,
      ok: r ? r.ok === 1 : false,
      required: seg.text,
      observed: r?.observed ?? null,
      deviation: r?.deviation ?? null,
    }
  })

  return {
    submissionId,
    sourceName: submission.source_name,
    state: submission.state,
    outcome: verdict.outcome as Outcome,
    headline: OUTCOME_HEADLINE[verdict.outcome as Outcome],
    cause: null,
    fields,
    warning: {
      evaluated: true,
      ok: segments.every((s) => s.ok),
      segments,
      advisory,
      referenceUnverified,
    },
    labelImageUrl,
    reference,
    contentPurgedAt: submission.content_purged_at,
  }
}
