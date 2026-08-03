/**
 * The application record, taken as data rather than read from a page.
 *
 * `verifySubmission` has always accepted either an image or structured values
 * for the record — the union is in `VerifyInput` — and the pipeline always sent
 * an image, so every submission spent a second vision call reading a page whose
 * text is exact and machine-readable.
 *
 * Three things follow from stopping that, and only one of them is about cost:
 *
 *   1. It halves inference. A corpus run goes from 52 calls to 26.
 *   2. It removes a fabrication that was observed rather than feared. For the
 *      fully-compliant control, the record extraction returned "Old Forester"
 *      and "50% Alc. by Vol." for a submission declaring "Old Tom Distillery"
 *      and "45%" — confident, well-formed, invented (§8.3.2).
 *   3. It is closer to production, not further from it. The paper form has no
 *      field for class/type, alcohol content or net contents; page 2 models the
 *      COLAs Online electronic record precisely because those values live in a
 *      system, and a real integration would receive them as data.
 *
 * The label is untouched and still read from pixels. Rule 5 concerns what a
 * consumer sees on the artwork; the record is the applicant's own declaration,
 * and reading it exactly is not a shortcut but the point.
 */

import type { ApplicationData, FieldName } from '../domain/types.js'
import { FIELDS } from '../domain/types.js'

/**
 * Map a declared record onto the fields under comparison.
 *
 * Deliberately a whitelist. The source for the bundled corpus is the same
 * manifest that carries authored *expected outcomes*, and those must never
 * reach a comparison: a check fed its own answer key proves nothing (D4).
 * Taking only `FIELDS` means no expected verdict can travel this path even if
 * the caller hands over the whole record.
 */
export function applicationDataFrom(declared: Record<string, unknown>): ApplicationData {
  const data = {} as Record<FieldName, string | null>

  for (const field of FIELDS) {
    const value = declared[field]
    if (typeof value !== 'string') {
      // A non-string is not coerced. A number silently stringified into a
      // comparison would be a finding about a value nobody declared.
      data[field] = null
      continue
    }
    const trimmed = value.trim()
    // Blank means the applicant did not state it — L21's case. An empty string
    // would be a value, and could later compare equal to something.
    data[field] = trimmed === '' ? null : trimmed
  }

  return data
}
