/**
 * The verification pipeline.
 *
 * Design reference: §6.1, §8.1, §8.8.2, B-D1.
 *
 * Orchestration only. It holds no rules of its own: comparison, warning
 * verification and aggregation all live elsewhere and are called here.
 *
 * ---------------------------------------------------------------------------
 * TWO EXTRACTIONS, IN PARALLEL, NEITHER AWARE OF THE OTHER
 *
 * The label and the record are read by separate calls. Merging them into one
 * call over the whole page would "save a round trip" and silently defeat blind
 * extraction (D4) — the model would see the expected values beside the label.
 *
 * They run concurrently because they are independent, so the layer costs one
 * round trip rather than two (§8.8.2).
 * ---------------------------------------------------------------------------
 */

import { aggregate, problemCount, summarise } from './aggregate.js'
import { compareFields } from './compare.js'
import type { ExtractionProvenance, ExtractionProvider } from './extraction.js'
import type { WarningReference } from './reference.js'
import type { ApplicationData, Extraction, FieldVerdict, Outcome, WarningVerdict } from './types.js'
import { FIELDS } from './types.js'
import { verifyWarning } from './warning.js'

export interface RegionImage {
  readonly image: ArrayBuffer
  readonly mimeType: string
}

export interface VerifyInput {
  /** The affixed label set. Always read from pixels. */
  readonly label: RegionImage
  /**
   * The application record. Either an image to read, or a text layer already
   * extracted — legitimate for application data, never for the label.
   */
  readonly record: RegionImage | { readonly applicationData: ApplicationData }
}

export interface StageTimings {
  readonly extractMs: number
  readonly compareMs: number
  readonly totalMs: number
}

export interface VerifyResult {
  readonly outcome: Outcome
  readonly summary: string
  readonly problemCount: number
  readonly fields: readonly FieldVerdict[]
  readonly warning: WarningVerdict
  readonly application: ApplicationData
  readonly labelExtraction: Extraction
  readonly provenance: {
    readonly label: ExtractionProvenance
    readonly record: ExtractionProvenance | null
  }
  readonly rawResponses: { readonly label: string; readonly record: string | null }
  readonly timings: StageTimings
}

export interface VerifyOptions {
  readonly provider: ExtractionProvider
  readonly warningRef?: WarningReference
  /** Injected so timings are deterministic in tests (test-plan §17). */
  readonly now?: () => number
}

/** Turn a record-region extraction into application data. */
function toApplicationData(extraction: Extraction): ApplicationData {
  const out = {} as Record<keyof ApplicationData, string | null>
  for (const field of FIELDS) out[field] = extraction.fields[field].raw
  return out
}

export async function verifySubmission(
  input: VerifyInput,
  opts: VerifyOptions,
): Promise<VerifyResult> {
  const now = opts.now ?? (() => Date.now())
  const started = now()

  const needsRecordExtraction = 'image' in input.record

  const extractStarted = now()
  // Concurrent, and separate. See the module comment.
  const [labelResult, recordResult] = await Promise.all([
    opts.provider.extract({
      region: 'label',
      image: input.label.image,
      mimeType: input.label.mimeType,
      fields: FIELDS,
      includeWarning: true,
    }),
    needsRecordExtraction
      ? opts.provider.extract({
          region: 'record',
          image: (input.record as RegionImage).image,
          mimeType: (input.record as RegionImage).mimeType,
          fields: FIELDS,
          includeWarning: false,
        })
      : Promise.resolve(null),
  ])
  const extractMs = now() - extractStarted

  const application = needsRecordExtraction
    ? toApplicationData((recordResult as NonNullable<typeof recordResult>).extraction)
    : (input.record as { applicationData: ApplicationData }).applicationData

  const compareStarted = now()
  const fields = compareFields(application, labelResult.extraction)
  const warning = verifyWarning(labelResult.extraction.warningStatement, opts.warningRef)
  const outcome = aggregate({ fields, warning })
  const compareMs = now() - compareStarted

  return {
    outcome,
    summary: summarise({ fields, warning }),
    problemCount: problemCount({ fields, warning }),
    fields,
    warning,
    application,
    labelExtraction: labelResult.extraction,
    provenance: {
      label: labelResult.provenance,
      record: recordResult?.provenance ?? null,
    },
    rawResponses: {
      label: labelResult.rawResponse,
      record: recordResult?.rawResponse ?? null,
    },
    timings: { extractMs, compareMs, totalMs: now() - started },
  }
}
