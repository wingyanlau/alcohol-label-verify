/**
 * Re-deriving a verdict from the record (NFR-13).
 *
 * The audit record names what produced a verdict. This shows the verdict can
 * be produced again from it — without the model, without the artwork, without
 * a network call. Until it existed the claim was a design assertion.
 *
 * The mechanism is deliberately not a second implementation. A replay-specific
 * comparison would be free to agree with a stored verdict that the live path
 * would no longer produce, which is the one thing a replay must not do. So
 * replay supplies a *provider* that returns recorded readings, and runs the
 * ordinary `verifySubmission`. A change to a comparison rule therefore changes
 * live verdicts and replays together, and a disagreement between them means
 * what it appears to mean.
 *
 * What it proves: the stored reading, the stored application data and the
 * versioned rules yield the stored verdict. What it cannot prove: that the
 * reading was right. That is B-Q4's question, and the corpus answers it.
 */

import {
  ExtractionContractError,
  type ExtractionProvider,
  type ExtractionRequest,
  type ExtractionResult,
  parseExtractionResponse,
} from '../domain/extraction.js'
import { extractJson } from '../providers/json.js'

/** One extraction as it was persisted. */
export interface RecordedExtraction {
  readonly region: 'label' | 'record'
  /** Verbatim. Simultaneously the provenance record and the fixture. */
  readonly rawResponse: string
  readonly provider: string | null
  readonly modelId: string | null
  readonly promptVersion: string | null
  readonly sampling: string | null
  readonly latencyMs: number
}

/**
 * A provider that reads from the record instead of a model.
 *
 * It reports the provenance that was stored rather than describing itself. A
 * replayed verdict must carry the identity of the reader that originally
 * produced it — saying "replay" here would lose the only thing the audit
 * record was keeping.
 */
export function createReplayProvider(recorded: readonly RecordedExtraction[]): ExtractionProvider {
  return {
    name: 'replay',

    async extract(request: ExtractionRequest): Promise<ExtractionResult> {
      const row = recorded.find((r) => r.region === request.region)
      if (row === undefined) {
        // Never fabricated. A replay missing its reading is a gap in the
        // record, and answering anyway would conceal exactly the thing the
        // record exists to expose.
        throw new ExtractionContractError(
          `no recorded extraction for region "${request.region}" — the verdict cannot be re-derived`,
        )
      }

      return {
        extraction: parseExtractionResponse(extractJson(row.rawResponse), {
          fields: request.fields,
          includeWarning: request.includeWarning,
        }),
        rawResponse: row.rawResponse,
        provenance: {
          provider: row.provider ?? 'unrecorded',
          modelId: row.modelId ?? 'unrecorded',
          promptVersion: row.promptVersion ?? 'unrecorded',
          samplingParameters: parseSampling(row.sampling),
          // The original call's latency, not this one's. A replay takes
          // microseconds and reporting that would overwrite a measurement.
          latencyMs: row.latencyMs,
        },
      }
    },
  }
}

function parseSampling(raw: string | null): Readonly<Record<string, unknown>> {
  if (raw === null) return {}
  try {
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}
