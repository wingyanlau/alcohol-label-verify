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

import { aggregate, judgementCount, problemCount, summarise } from './aggregate.js'
import { compareFields } from './compare.js'
import type { PolicyFinding } from './evaluate.js'
import type { ExtractionProvenance, ExtractionProvider } from './extraction.js'
import type { PolicyBinding } from './findings.js'
import { assessPolicy } from './findings.js'
import type { PolicySet } from './policy.js'
import type { WarningReference } from './reference.js'
import type { ApplicationData, Extraction, FieldVerdict, Outcome, WarningVerdict } from './types.js'
import { FIELDS } from './types.js'
import { verifyWarning } from './warning.js'

export interface RegionImage {
  readonly image: ArrayBuffer
  readonly mimeType: string
  /**
   * Edge energy over the region carrying the health warning, and the floor it
   * is judged against.
   *
   * Supplied by whoever produced the pixels, because that is the only place
   * the pixels exist. Absent means unmeasured, which is treated as legible —
   * a missing measurement must not silently fail every submission.
   *
   * The two travel together on purpose. The floor is configuration (it decides
   * how degraded a warning may be before a transcription of it stops meaning
   * anything, which is a scanner-quality and strictness question, not a fact
   * about this code), and a measurement recorded without the threshold it was
   * judged against cannot be interpreted later. Pairing them means "measured
   * against nothing" is not a state that can be expressed.
   */
  readonly warningLegibility?: { readonly measured: number; readonly floor: number }
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
  /** Rules awaiting the agent's judgement — counted apart from problems (D40). */
  readonly judgementCount: number
  readonly fields: readonly FieldVerdict[]
  readonly warning: WarningVerdict
  /** What the policy set says about this submission (§18.4). */
  readonly findings: readonly PolicyFinding[]
  /** Which rules were applied, and what they were selected on (D26). */
  readonly policy: PolicyBinding
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
  /**
   * The clock. **Required**, and that is the point.
   *
   * M1's exit criterion is that no file in `src/domain` reads a clock, and it
   * is verified by grep. An optional parameter with a wall-clock fallback
   * satisfied the spirit and failed the letter: the call still lived in the
   * domain, so the property held only while nobody added a second one.
   * Requiring the clock moves it outside the pure core where it belongs, and
   * the compiler keeps it there — a caller cannot forget.
   */
  readonly now: () => number
  /**
   * The legibility decision, already made.
   *
   * Exists for replay (NFR-13). Legibility is measured from pixels, and by the
   * time a verdict is re-derived the pixels are gone — what survives is the
   * conclusion drawn from them, stored on the verdict row. Supplying the
   * measurement here instead would mean inventing an edge-energy number that
   * was never observed, so the decision is passed as the decision.
   *
   * Live callers leave this unset and supply `label.warningLegibility`.
   */
  readonly warningLegible?: boolean
  /**
   * The date the application was filed, as `YYYY-MM-DD`. **Required**, for the
   * same reason `now` is.
   *
   * Not today's date, and the distinction is the whole reason the archive
   * carries effective dates: standards of fill changed in January 2025, so a
   * 2024 filing judged by today's list is judged by a rule that did not govern
   * it — invisibly, because the verdict looks perfectly ordinary.
   *
   * It was briefly optional, defaulting to a date derived from `now`. That is
   * wrong twice over. `now` is the *timing* clock — it measures stage
   * durations, and a caller is entitled to hand in a monotonic one, which
   * yields 1970-01-01 and silently drops every rule with an `effectiveFrom`;
   * the suite was doing exactly that, selecting seven rules where it read as
   * eight. And a default meant a caller replaying an old verdict could forget
   * to supply the date it was filed and get today's rules without noticing.
   * Requiring it makes both impossible at compile time.
   */
  readonly submittedOn: string
  /** Defaults to the loaded archive; injectable so tests can pin a set. */
  readonly policySet?: PolicySet
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
  const now = opts.now
  const started = now()

  const needsRecordExtraction = 'image' in input.record

  // Whether the warning was legible enough for a transcription to mean
  // anything. Not a question the extractor can answer about a statute it knows
  // by heart: shown an illegible warning it returns the canonical text and
  // reports success. Measured from pixels, or assumed legible when unmeasured.
  const warningLegible =
    opts.warningLegible ??
    (input.label.warningLegibility === undefined ||
      input.label.warningLegibility.measured >= input.label.warningLegibility.floor)

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
  const warning = verifyWarning(
    labelResult.extraction.warningStatement,
    opts.warningRef,
    warningLegible,
  )
  // Selection reads the record; evaluation reads the label. See findings.ts.
  const assessment = assessPolicy({
    application,
    extraction: labelResult.extraction,
    warning,
    submittedOn: opts.submittedOn,
    policySet: opts.policySet,
  })
  const findings = assessment.findings
  const outcome = aggregate({ fields, warning, findings })
  const compareMs = now() - compareStarted

  return {
    outcome,
    summary: summarise({ fields, warning, findings }),
    problemCount: problemCount({ fields, warning, findings }),
    judgementCount: judgementCount({ fields, warning, findings }),
    fields,
    warning,
    findings,
    policy: assessment.binding,
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
