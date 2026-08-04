/**
 * Single review — one label, checked now (UC-1, ui-design §4).
 *
 * The interactive path the design specified first and the batch path
 * overtook. An agent types what the application says, attaches the artwork,
 * and gets a verdict in a few seconds.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT SHARES, AND WHY THAT IS THE POINT
 *
 * It shares everything that decides anything: the same `verifySubmission`, the
 * same comparison rules, the same warning reference, the same provider seam.
 * The only difference is where the pixels come from — an uploaded image rather
 * than a region cropped out of a rasterised PDF.
 *
 * A second verification path would be a second place for the rules to live,
 * and the two would diverge quietly: someone would fix a comparison in one and
 * not the other, and the same label would pass on one screen and fail on the
 * next. So this module does intake, orchestration and shaping — and no
 * judgement whatsoever.
 *
 * D4 still holds. The application data goes to the comparison, never to the
 * extractor: `verifySubmission` is handed `{ applicationData }` for the record
 * region, which means no model call is made with it and there is nothing for a
 * reading to anchor to.
 */

import { OUTCOME_HEADLINE } from '../domain/aggregate.js'
import type { ExtractionProvider } from '../domain/extraction.js'
import { configuredLegibilityFloor } from '../domain/legibility.js'
import { referenceIsUnverified, warningReference } from '../domain/reference.js'
import type { ApplicationData, FieldName } from '../domain/types.js'
import { FIELD_LABELS, FIELDS } from '../domain/types.js'
import type { VerifyResult } from '../domain/verify.js'
import { verifySubmission } from '../domain/verify.js'

/** What the agent typed, before anything has been checked. */
export interface ReviewRequest {
  readonly application: ApplicationData
  readonly image: ArrayBuffer
  readonly mimeType: string
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
    sourceName: string
    env: { LEGIBILITY_FLOOR?: string }
  },
): Promise<{ view: ReviewResult; result: VerifyResult }> {
  const ref = warningReference()

  // Legibility is not measured on this path, and that is stated rather than
  // silently assumed: measuring it needs the pixels analysed, which happens in
  // the corpus generator and not in a Worker. An unmeasured warning is treated
  // as legible — the same rule the batch path applies to an upload — so a
  // missing measurement never fails a submission on its own.
  void configuredLegibilityFloor(opts.env)

  const result = await verifySubmission(
    {
      label: { image: request.image, mimeType: request.mimeType },
      record: { applicationData: request.application },
    },
    { provider: opts.provider },
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
    contentPurgedAt: null,
    timings: result.timings,
  }

  return { view, result }
}
