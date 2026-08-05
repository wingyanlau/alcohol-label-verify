/**
 * The extraction contract.
 *
 * Design reference: §8.3 (interfaces), §8.3.1 (blind extraction),
 * §8.3.2 (schema pressure), D4.
 *
 * ---------------------------------------------------------------------------
 * THE CONSTRAINT THIS FILE EXISTS TO ENFORCE
 *
 * `ExtractionRequest` carries an image and a list of field names. It carries no
 * expected values, and there is no shape in which it could — the type has no
 * slot for them.
 *
 * That is CT-10, expressed structurally rather than by convention. A model shown
 * the expected value tends to confirm it, and every such error is a false
 * *match*: a non-compliant label passing review, silently, with high confidence,
 * in the direction nobody audits. The opposite bias would be self-correcting,
 * because agents complain about false mismatches.
 * ---------------------------------------------------------------------------
 *
 * Responses are validated here, at the boundary. A malformed response is a
 * DEPENDENCY FAILURE, never a verification result (§8.3) — parsing it
 * defensively downstream would turn a broken provider into a compliance finding.
 */

import type { Extraction, FieldName, ObservedField } from './types.js'
import { FIELDS, FORM_PRODUCT_TYPES } from './types.js'

/** Which region of a submission an extraction covers. */
export type Region = 'label' | 'record'

/**
 * What a provider is asked for.
 *
 * Note what is absent: no expected values, no application data, no prior
 * extraction. The provider sees an image and the names of the fields to look
 * for — a job description, never an answer key.
 */
export interface ExtractionRequest {
  readonly region: Region
  /** Rendered page region, as bytes. */
  readonly image: ArrayBuffer
  readonly mimeType: string
  /** Field names to look for. Names only. */
  readonly fields: readonly FieldName[]
  /** Whether to also transcribe the government warning statement. */
  readonly includeWarning: boolean
  /**
   * Whether to read item 5, TYPE OF PRODUCT — the record region only.
   *
   * Never asked of the label. No label states "Distilled spirits", so asking
   * there would invite the model to infer it from the artwork — the bottle
   * choosing the body of law it is judged by, which is D25's "never from the
   * model" in its worst form.
   *
   * It is a tick among three boxes rather than a transcription, which is why it
   * can be asked for at all: the answer is a choice from a known set, and
   * anything outside that set is a bad read rather than an unusual product.
   */
  readonly includeProductType?: boolean
}

/** Provenance the provider must report back, for the audit record (§8.7.1). */
export interface ExtractionProvenance {
  readonly provider: string
  /** Fully qualified. Never a floating alias (D29). */
  readonly modelId: string
  /**
   * The version the vendor says actually served the request.
   *
   * Distinct from `modelId`, which is what was asked for. Where a vendor
   * publishes only stable names — Google retired numbered pins after 2.0 — the
   * requested identifier can move to new weights with nothing in the record
   * showing it. This is the vendor's own statement of what answered, and it is
   * the difference between citing a model and identifying one.
   *
   * Absent when the vendor does not report it.
   */
  readonly servedModelVersion?: string
  /** The vendor's handle for this call, for a support conversation later. */
  readonly vendorRequestId?: string
  readonly promptVersion: string
  readonly samplingParameters: Readonly<Record<string, unknown>>
  readonly latencyMs: number
}

export interface ExtractionResult {
  readonly extraction: Extraction
  readonly provenance: ExtractionProvenance
  /** Exactly as returned. Both the provenance record and the test fixture. */
  readonly rawResponse: string
  /**
   * Top-level keys of the vendor's envelope.
   *
   * Diagnostic only — names, never values. It exists because what a vendor
   * reports about its own response is worth reading rather than assuming.
   */
  readonly envelopeKeys?: readonly string[]
}

/** Every provider adapter satisfies this. No vendor concept appears above it. */
export interface ExtractionProvider {
  readonly name: string
  extract(request: ExtractionRequest): Promise<ExtractionResult>
}

/** Thrown when a provider returns something the contract cannot accept. */
export class ExtractionContractError extends Error {
  /**
   * What the provider actually said, when the adapter can supply it.
   *
   * Deliberately NOT in the message. The message becomes a failure cause in
   * the durable record and a line in a log, where content must never go (D20);
   * this property is read only by a diagnostic endpoint someone is looking at.
   *
   * It exists because "response was not valid JSON" is a conclusion without
   * evidence, and a conclusion without evidence is what turned an envelope bug
   * into three rounds of debugging.
   */
  readonly raw?: string

  constructor(reason: string, raw?: string) {
    super(`extraction response violates the contract: ${reason}`)
    this.name = 'ExtractionContractError'
    if (raw !== undefined) this.raw = raw
  }
}

/** The response shape a provider is instructed to produce. */
export interface RawField {
  readonly value?: unknown
  readonly present?: unknown
  readonly unreadable?: unknown
  readonly confidence?: unknown
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Interpret one field from a provider response.
 *
 * §8.3.2 — schema pressure. Presented with a slot, a model is disinclined to
 * leave it empty; an unfilled field reads as task failure. So "not present" and
 * "could not read" are explicit, equally-weighted answers here rather than the
 * absence of an answer, and a blank value is treated as absence rather than as
 * an empty string that might later compare equal to something.
 */
/**
 * A value that is the prompt's own template, returned instead of a reading.
 *
 * Observed live: the image was not reaching the model, so it answered from the
 * prompt alone and echoed the schema — `<text exactly as printed>` — in every
 * field. The response was well-formed, so nothing downstream objected, and a
 * placeholder was recorded as the observed value of a compliance verdict.
 *
 * Anchored at both ends deliberately. A value that *is* a placeholder is an
 * echo; a value that merely contains angle brackets is text, and rejecting
 * `Smith <&> Sons` would fail a submission that reads perfectly.
 */
const TEMPLATE_ECHO = /^<[^<>]*>$/

function rejectTemplateEcho(where: string, value: string): void {
  if (TEMPLATE_ECHO.test(value.trim())) {
    throw new ExtractionContractError(
      `${where} returned the prompt's own placeholder ("${value.trim()}") — ` +
        'the model answered without reading the image',
    )
  }
}

function readField(name: string, raw: unknown): ObservedField {
  if (!isRecord(raw)) {
    throw new ExtractionContractError(`field "${name}" is not an object`)
  }

  const unreadable = raw.unreadable === true
  const present = raw.present !== false

  let value: string | null = null
  if (typeof raw.value === 'string') {
    rejectTemplateEcho(`field "${name}"`, raw.value)
    const trimmed = raw.value.trim()
    value = trimmed === '' ? null : trimmed
  } else if (raw.value !== undefined && raw.value !== null) {
    throw new ExtractionContractError(`field "${name}" has a non-string value`)
  }

  let confidence = 1
  if (raw.confidence !== undefined) {
    if (typeof raw.confidence !== 'number' || Number.isNaN(raw.confidence)) {
      throw new ExtractionContractError(`field "${name}" has a non-numeric confidence`)
    }
    if (raw.confidence < 0 || raw.confidence > 1) {
      throw new ExtractionContractError(`field "${name}" confidence is outside 0..1`)
    }
    confidence = raw.confidence
  }

  return {
    raw: unreadable || !present ? null : value,
    confidence,
    unreadable,
  }
}

/**
 * Validate a provider response against the contract.
 *
 * Throws `ExtractionContractError` on anything it cannot accept. The caller
 * treats that as a dependency failure — the item fails, no verdict is issued,
 * and a bounded retry may follow in batch (§9.2).
 */
export function parseExtractionResponse(
  value: unknown,
  opts: {
    readonly fields?: readonly FieldName[]
    readonly includeWarning?: boolean
    readonly includeProductType?: boolean
  } = {},
): Extraction {
  const wanted = opts.fields ?? FIELDS
  if (!isRecord(value)) throw new ExtractionContractError('response is not an object')

  const rawFields = value.fields
  if (!isRecord(rawFields)) throw new ExtractionContractError('response has no "fields" object')

  const fields = {} as Record<FieldName, ObservedField>
  for (const name of wanted) {
    const raw = rawFields[name]
    if (raw === undefined) {
      throw new ExtractionContractError(`response is missing required field "${name}"`)
    }
    fields[name] = readField(name, raw)
  }
  // Fields not asked for are ignored rather than rejected: a provider adding a
  // key is not a reason to fail an otherwise usable reading.

  let warningStatement: string | null = null
  if (opts.includeWarning !== false) {
    const w = value.warningStatement
    if (typeof w === 'string') {
      rejectTemplateEcho('warningStatement', w)
      warningStatement = w.trim() === '' ? null : w
    } else if (w !== undefined && w !== null) {
      throw new ExtractionContractError('warningStatement must be a string or null')
    }
  }

  if (opts.includeProductType !== true) return { fields, warningStatement }
  return { fields, warningStatement, productType: readProductType(value.productType) }
}

/**
 * Item 5 as a classification, failing closed at every step.
 *
 * The model is asked which of three boxes is ticked, and this decides whether
 * its answer is one of them. `null` — none ticked, two ticked, illegible, or a
 * word that is not on the form — is a first-class answer, and selection then
 * reports that nothing could be checked.
 *
 * The nearest match is deliberately not taken. "Beer" is very nearly "Malt
 * beverages", and the difference between them is a body of regulation.
 */
function readProductType(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null
  if (typeof raw !== 'string') {
    throw new ExtractionContractError('productType must be a string or null')
  }
  rejectTemplateEcho('productType', raw)
  const folded = raw.trim().toLowerCase()
  // Canonicalised to the form's own spelling: the value is compared against a
  // rule's `appliesWhen.productType` as a plain string, so the casing the model
  // happened to use must not decide whether a rule fires.
  return FORM_PRODUCT_TYPES.find((t) => t.toLowerCase() === folded) ?? null
}
