/**
 * Asking the model again, and comparing what comes back.
 *
 * Replay tests the **judgement**: it re-runs the pipeline from the reading
 * recorded at the time, so it proves the rules still produce the same verdict
 * and says nothing about whether the reading was right. A faithfully reproduced
 * misreading reports `identical`.
 *
 * This is the other half. It puts the retained artwork back to the same model,
 * at the same prompt version, and compares the new reading with the stored one.
 * It answers a question replay cannot: **does this model still read this label
 * the same way** — which is the evidence a compliance agent would actually want
 * when defending a finding, and the only thing that detects a vendor repointing
 * a stable name at new weights.
 *
 * ---------------------------------------------------------------------------
 * WHAT A DIFFERENCE MEANS, AND WHAT IT DOES NOT
 *
 * A difference is **not** proof that either reading is wrong. Perception is
 * non-deterministic; two readings of the same pixels may legitimately differ,
 * especially where the artwork is degraded. What a difference establishes is
 * that the verdict rested on a reading the model does not reproduce — which is
 * a fact worth putting in front of the person deciding, not a verdict on the
 * verdict.
 *
 * It also never changes anything. Nothing here writes a verdict, supersedes
 * one, or touches the record: it is a diagnostic a human reads.
 */

import type { Extraction, FieldName } from '../domain/types.js'
import { FIELDS } from '../domain/types.js'

export interface FieldComparison {
  readonly field: FieldName
  /**
   * `recorded` and `fresh`, not `then` and `now`.
   *
   * An object carrying a `then` property is *thenable*: hand it to `await` or
   * resolve it inside a promise chain and the runtime calls `then` instead of
   * delivering the object. The linter refused it, and it was right to.
   */
  readonly recorded: string | null
  readonly fresh: string | null
  readonly same: boolean
  /** Whether either reading declined to read it. Distinct from a difference. */
  readonly unreadable: boolean
}

export interface RereadComparison {
  readonly region: string
  readonly fields: readonly FieldComparison[]
  readonly warningStatement: { recorded: boolean; fresh: boolean; same: boolean }
  /** Every field agreed, and the warning transcribed the same way. */
  readonly identical: boolean
  /**
   * Whether the reader that answered is the one that answered originally.
   *
   * If the deployment has been reconfigured, or a prompt revised, the two
   * readings come from **different agents** and a difference says nothing about
   * stability — it says the reader changed. Reporting the comparison without
   * this would attribute a configuration change to the model (D29).
   */
  readonly sameReader: boolean
  readonly reader: {
    recordedModel: string
    freshModel: string
    recordedPrompt: string
    freshPrompt: string
  }
}

/** Compared as stored: trimmed, and absence is not the empty string. */
function sameValue(a: string | null, b: string | null): boolean {
  return (a ?? null) === (b ?? null)
}

/**
 * Compare a fresh reading against the one a verdict was built on.
 *
 * Pure, and takes both readings rather than fetching either: the fetching is
 * I/O and the comparison is the part that must be right.
 */
export function compareReadings(
  region: string,
  recorded: Extraction,
  fresh: Extraction,
  reader: RereadComparison['reader'],
): RereadComparison {
  const fields = FIELDS.map((field): FieldComparison => {
    const a = recorded.fields[field]
    const b = fresh.fields[field]
    return {
      field,
      recorded: a.raw,
      fresh: b.raw,
      same: sameValue(a.raw, b.raw),
      // Reported separately because "the model declined to read this" and "the
      // model read it differently" lead a reviewer to different places — the
      // first to the artwork, the second to the model.
      unreadable: a.unreadable || b.unreadable,
    }
  })

  const warning = {
    recorded: recorded.warningStatement !== null,
    fresh: fresh.warningStatement !== null,
    same: sameValue(recorded.warningStatement, fresh.warningStatement),
  }

  return {
    region,
    fields,
    warningStatement: warning,
    identical: fields.every((f) => f.same) && warning.same,
    sameReader:
      reader.recordedModel === reader.freshModel && reader.recordedPrompt === reader.freshPrompt,
    reader,
  }
}
