/**
 * Parsers for quantities that appear on labels in varied formats.
 *
 * Design reference: §8.4.3.
 *
 * Deliberately conservative: unparseable input returns `null` rather than a
 * guess. A guess here becomes a false match downstream, which is the error
 * direction that lets a non-compliant label pass (§8.3.1).
 */

import { normalizeTypography } from './normalize.js'

/** How an alcohol-content value was derived, so a verdict can explain itself. */
export type AbvSource = 'percent' | 'proof' | 'bare-number'

export interface ParsedAbv {
  /** Alcohol by volume, as a percentage. */
  readonly value: number
  readonly source: AbvSource
}

/**
 * Parse alcohol by volume from label or application text.
 *
 * Handles `45% Alc./Vol. (90 Proof)`, `45% ALC/VOL`, `ALCOHOL 45% BY VOLUME`,
 * `90 Proof`, and a bare `45`.
 *
 * Percentage wins over proof when both appear: the percentage is the primary
 * statement and the proof is derived from it.
 *
 * Returns `null` for text with no numeral (`forty-five percent`), which the
 * caller surfaces as unreadable rather than as a mismatch (UT-A10).
 */
export function parseAbv(input: string): ParsedAbv | null {
  const text = normalizeTypography(input).trim()
  if (text === '') return null

  const percent = text.match(/(\d+(?:\.\d+)?)\s*%/)
  if (percent?.[1] !== undefined) {
    return { value: Number(percent[1]), source: 'percent' }
  }

  const bare = text.match(/^(\d+(?:\.\d+)?)$/)
  if (bare?.[1] !== undefined) {
    return { value: Number(bare[1]), source: 'bare-number' }
  }

  const proof = text.match(/(\d+(?:\.\d+)?)\s*proof/i)
  if (proof?.[1] !== undefined) {
    return { value: Number(proof[1]) / 2, source: 'proof' }
  }

  return null
}

/** Proof stated on a label, when present. For the internal-consistency check (Q8). */
export function parseProof(input: string): number | null {
  const proof = normalizeTypography(input).match(/(\d+(?:\.\d+)?)\s*proof/i)
  return proof?.[1] === undefined ? null : Number(proof[1])
}

/** Volume units recognised on labels, expressed in millilitres. */
const VOLUME_UNITS: ReadonlyArray<readonly [RegExp, number, string]> = [
  [/^(?:ml|milliliters?|millilitres?)$/i, 1, 'mL'],
  [/^(?:cl|centiliters?|centilitres?)$/i, 10, 'cL'],
  [/^(?:dl|deciliters?|decilitres?)$/i, 100, 'dL'],
  [/^(?:l|liters?|litres?)$/i, 1000, 'L'],
  [/^(?:fl\.?\s*oz\.?|fluid\s+ounces?)$/i, 29.5735295625, 'fl oz'],
]

export interface ParsedQuantity {
  /** Normalised to millilitres. */
  readonly milliliters: number
  /** Canonical unit as recognised, or `null` when none was stated. */
  readonly unit: string | null
  /** True when no unit was present and millilitres were assumed. */
  readonly unitAssumed: boolean
}

/**
 * Tolerance permitted **only** when a unit conversion took place.
 *
 * `750 mL` and `25.4 fl oz` describe the same container: 25.4 fl oz is
 * 751.2 mL, and the 0.16% difference is an artefact of rounding a converted
 * figure to one decimal place on the label. Requiring exactness would report a
 * genuine equivalence as a discrepancy.
 *
 * This is NOT the regulatory tolerance question settled in Q7. That concerned
 * actual contents against a printed claim, and the answer was that none applies
 * to label-versus-application. This tolerance exists because *the conversion*
 * introduces imprecision, and it is never applied when the units already agree.
 */
export const CONVERSION_TOLERANCE = 0.005 // 0.5%

/**
 * Parse a net-contents quantity, normalising to millilitres.
 *
 * A bare number (`750`) is accepted with millilitres assumed, flagged via
 * `unitAssumed` so the caller can lower confidence rather than assert a match
 * it cannot justify (UT-Q06).
 */
export function parseQuantity(input: string): ParsedQuantity | null {
  const text = normalizeTypography(input).trim()
  if (text === '') return null

  const withUnit = text.match(/(\d+(?:\.\d+)?)\s*([A-Za-z.\s]+)$/)
  if (withUnit?.[1] !== undefined && withUnit[2] !== undefined) {
    const amount = Number(withUnit[1])
    const rawUnit = withUnit[2].trim()
    for (const [pattern, factor, canonical] of VOLUME_UNITS) {
      if (pattern.test(rawUnit)) {
        return { milliliters: amount * factor, unit: canonical, unitAssumed: false }
      }
    }
    return null // a unit was stated but not recognised — do not guess
  }

  const bare = text.match(/^(\d+(?:\.\d+)?)$/)
  if (bare?.[1] !== undefined) {
    return { milliliters: Number(bare[1]), unit: null, unitAssumed: true }
  }

  return null
}
