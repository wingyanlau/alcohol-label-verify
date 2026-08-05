/**
 * Single review — one label, checked now (UC-1, ui-design §4).
 *
 * The interactive path the design specified first and the batch path
 * overtook. An agent uploads the filed TTB F 5100.31 and gets a verdict in a
 * few seconds — the same input the batch takes, one submission at a time.
 *
 * It used to ask them to type the five application values beside the artwork.
 * They were copying those off the form in their hand, and each one was a value
 * that could be mistyped into a discrepancy nobody could explain (D48).
 *
 * ---------------------------------------------------------------------------
 * WHAT IT SHARES, AND WHY THAT IS THE POINT
 *
 * It shares everything that decides anything: the same `verifySubmission`, the
 * same comparison rules, the same warning reference, the same provider seam —
 * and now the same rasteriser and region map as well, because both paths call
 * `rasteriseSubmission`. The pixels are cropped out of the filed PDF the same
 * way here as in a batch of three hundred.
 *
 * A second verification path would be a second place for the rules to live,
 * and the two would diverge quietly: someone would fix a comparison in one and
 * not the other, and the same label would pass on one screen and fail on the
 * next. So this module does intake, orchestration and shaping — and no
 * judgement whatsoever.
 *
 * D4 still holds, and holds harder. Nothing shows either read what the other
 * found: the record region and the label region are extracted separately and
 * concurrently, no expected value exists until both have answered, and an
 * `ExtractionRequest` has nowhere to put one. Where the agent types the record
 * instead, that data goes to the comparison and never to a model call at all.
 */

import { OUTCOME_HEADLINE, OUTCOME_RECOMMENDATION } from '../domain/aggregate.js'
import type { ExtractionProvider } from '../domain/extraction.js'
import { approverFor, citationFor } from '../domain/findings.js'
import { configuredLegibilityFloor } from '../domain/legibility.js'
import { referenceIsUnverified, warningReference } from '../domain/reference.js'
import type { ApplicationData, FieldName } from '../domain/types.js'
import { FIELD_LABELS, FIELDS } from '../domain/types.js'
import type { VerifyResult } from '../domain/verify.js'
import { verifySubmission } from '../domain/verify.js'
import { ruleSetAsAt } from '../policy/archive.js'

/**
 * One submission to check, in either of the two forms an agent can supply.
 *
 * `submission` is the ordinary path and the same input the batch takes: the
 * filed TTB F 5100.31, rasterised into a label region and a record region,
 * both read blind. Nothing is typed, so nothing can be mistyped, and the
 * comparison is between two readings of the filing rather than between a
 * reading and a transcription.
 *
 * `typed` remains for a label with no filed form to hand. It is the same
 * verification with the record half supplied as data instead of pixels — which
 * is exactly what the batch does for a corpus item that declares its record.
 */
export type ReviewRequest =
  | {
      readonly kind?: 'typed'
      readonly application: ApplicationData
      readonly image: ArrayBuffer
      readonly mimeType: string
    }
  | {
      readonly kind: 'submission'
      /** The label region, as rasterised. Pixels, never a text layer (rule 5). */
      readonly image: ArrayBuffer
      readonly mimeType: string
      /** The record region, read blind — including item 5 (D25). */
      readonly record: { readonly image: ArrayBuffer; readonly mimeType: string }
    }

/**
 * Refused before any model is called.
 *
 * Client-side validation exists for responsiveness, never for correctness
 * (§4.5), so the same rules are enforced here — and the message is the one the
 * screen would have shown, so an agent who somehow reaches this sees no change
 * of voice.
 */
export class ReviewRejected extends Error {
  constructor(
    readonly field: 'brandName' | 'image',
    message: string,
  ) {
    super(message)
    this.name = 'ReviewRejected'
  }
}

/**
 * Only the brand name is required (§4.2).
 *
 * Everything else absent is a legitimate outcome — `NOT_SUPPLIED` is a
 * first-class verdict state, not a validation failure. Requiring more would
 * force an agent to invent a value, and an invented value produces a false
 * discrepancy, which is worse than a missing one.
 */
export function checkReviewRequest(request: {
  application: Partial<ApplicationData>
  image: ArrayBuffer | null
}): void {
  const brand = (request.application.brandName ?? '').trim()
  if (brand === '') {
    throw new ReviewRejected('brandName', 'Please enter the brand name from the application.')
  }
  if (request.image === null || request.image.byteLength === 0) {
    throw new ReviewRejected('image', 'Please add an image of the label.')
  }
}

/** The result, in the shape the results panel already renders. */
export interface ReviewResult {
  readonly submissionId: string
  readonly reference: string
  readonly state: 'COMPLETED'
  readonly outcome: string
  readonly headline: string
  /** What the system suggests. Never an approval (§18.4). */
  readonly recommendation: string
  readonly cause: null
  readonly sourceName: string
  readonly fields: ReadonlyArray<{
    field: string
    label: string
    state: string
    expected: string | null
    observed: string | null
    rule: string
    explanation: string | null
  }>
  /**
   * What the policy set says, one entry per rule applied (§18.4).
   *
   * Every entry carries its citation and the evidence it decided on, because a
   * finding an agent cannot check is one they can only defer to — and deferring
   * to it is the thing this system is built not to ask of them (FR-10).
   */
  readonly findings: ReadonlyArray<{
    ruleId: string
    requirement: string
    state: string
    severity: string
    evidence: string
    citation: string | null
    approvedBy: string | null
  }>
  /** Which rules were applied, and what they were selected on (D26). */
  readonly policy: {
    readonly policySetVersion: number
    readonly selectedRuleIds: readonly string[]
    readonly submittedOn: string
    /** What selection ran on — item 5, read from the record or typed (D25). */
    readonly productType: string | null
  }
  readonly warning: {
    readonly evaluated: boolean
    readonly ok: boolean
    readonly segments: ReadonlyArray<{
      segmentId: string
      label: string
      ok: boolean
      required: string
      observed: string | null
      deviation: string | null
    }>
    readonly advisory: ReadonlyArray<{ id: string; text: string; citation: string }>
    readonly referenceUnverified: boolean
  }
  readonly labelImageUrl: string
  /**
   * The submission as filed, when one was uploaded.
   *
   * The crop shows what the model was given; this shows what the applicant
   * sent. A verdict that disagrees with the document — or a crop that caught
   * the wrong region — is visible only by looking at both. `null` on the typed
   * path, where there is no filed document and a link to one would be a lie.
   */
  readonly sourceUrl: string | null
  readonly contentPurgedAt: null
  readonly timings: { extractMs: number; compareMs: number; totalMs: number }
}

/**
 * Run one review.
 *
 * Takes the provider rather than building one, so a test can supply a stub and
 * so this module needs no knowledge of configuration.
 */
export async function reviewOne(
  request: ReviewRequest,
  opts: {
    provider: ExtractionProvider
    submissionId: string
    reference: string
    labelImageUrl: string
    /** Where the uploaded PDF can be fetched, when the caller kept one. */
    sourceUrl?: string | undefined
    sourceName: string
    env: { LEGIBILITY_FLOOR?: string }
    /**
     * The archive, when one is reachable. Absent means fall back to the
     * reviewed file — which is what a test does, and what this path did before
     * the rows existed.
     */
    db?: D1Database | undefined
  },
): Promise<{ view: ReviewResult; result: VerifyResult }> {
  const ref = warningReference()

  // Legibility is not measured on this path, and that is stated rather than
  // silently assumed: measuring it needs the pixels analysed, which happens in
  // the corpus generator and not in a Worker. An unmeasured warning is treated
  // as legible — the same rule the batch path applies to an upload — so a
  // missing measurement never fails a submission on its own.
  void configuredLegibilityFloor(opts.env)

  // Both dates, taken once. This path IS the filing — an agent is checking a
  // label in front of them — so the filing date is today's without assumption.
  const filedOn = new Date().toISOString().slice(0, 10)
  const judgedAt = new Date().toISOString()
  const rules = opts.db === undefined ? null : await ruleSetAsAt(opts.db, filedOn, judgedAt)

  const result = await verifySubmission(
    {
      label: { image: request.image, mimeType: request.mimeType },
      // The record half. Read from pixels when the form was filed as a PDF,
      // taken as data when the agent typed it — the same seam the batch path
      // uses for a corpus item that declares its record, so neither branch is
      // a second way of verifying anything.
      record:
        request.kind === 'submission'
          ? { image: request.record.image, mimeType: request.record.mimeType }
          : { applicationData: request.application },
    },
    // The clock comes from the edge; the domain reads none (M1). The filing
    // date is today's because this path IS the filing — an agent is checking a
    // label in front of them, not working a backlog.
    {
      provider: opts.provider,
      now: () => Date.now(),
      submittedOn: filedOn,
      asOf: judgedAt,
      // From the archive when one is reachable, so the verdict binds rules that
      // can be rebuilt later. Without a database this falls back to the
      // reviewed file, which is the path a test takes.
      ...(rules === null ? {} : { rules }),
    },
  )

  const byField = new Map(result.fields.map((f) => [f.field, f]))
  const bySegment = new Map(result.warning.segments.map((s) => [s.segmentId, s]))

  // The raw result travels back alongside the view, because the caller has to
  // persist it. Shaping and storing are different jobs and the shaped form has
  // already thrown away what the record needs — the provenance, the raw
  // responses, the version set.
  const view: ReviewResult = {
    submissionId: opts.submissionId,
    reference: opts.reference,
    state: 'COMPLETED',
    outcome: result.outcome,
    headline: OUTCOME_HEADLINE[result.outcome],
    recommendation: OUTCOME_RECOMMENDATION[result.outcome],
    cause: null,
    sourceName: opts.sourceName,
    fields: FIELDS.map((name: FieldName) => {
      const f = byField.get(name)
      return {
        field: name,
        label: FIELD_LABELS[name],
        state: f?.state ?? 'NOT_SUPPLIED',
        expected: f?.expected ?? null,
        observed: f?.observed ?? null,
        rule: f?.rule ?? '',
        explanation: f?.explanation ?? null,
      }
    }),
    findings: result.findings.map((f) => ({
      ruleId: f.ruleId,
      requirement: f.requirement,
      state: f.state,
      severity: f.severity,
      evidence: f.evidence,
      citation: citationFor(f.ruleId),
      // Who is answerable for the rule. The enacted rules name no approver of
      // their own and inherit the set's (D27).
      approvedBy: approverFor(f.ruleId),
    })),
    policy: {
      policySetVersion: result.policy.policySetVersion,
      selectedRuleIds: result.policy.selectedRuleIds,
      submittedOn: result.policy.submittedOn,
      // Item 5, as read or as typed. On screen because "no rule applied" and
      // "no rule could be selected" look identical without it, and one of them
      // means the label was never examined against any regulation at all.
      productType: result.application.productType ?? null,
    },
    warning: {
      evaluated: true,
      ok: result.warning.ok,
      segments: ref.segments.map((seg) => {
        const s = bySegment.get(seg.id)
        return {
          segmentId: seg.id,
          label: seg.label,
          ok: s?.ok ?? false,
          required: seg.text,
          observed: s?.observed ?? null,
          deviation: s?.deviation ?? null,
        }
      }),
      advisory: ref.advisoryChecks.map((a) => ({ id: a.id, text: a.text, citation: a.citation })),
      referenceUnverified: referenceIsUnverified(ref),
    },
    labelImageUrl: opts.labelImageUrl,
    sourceUrl: opts.sourceUrl ?? null,
    contentPurgedAt: null,
    timings: result.timings,
  }

  return { view, result }
}
