/**
 * Government health warning verification.
 *
 * Design reference: FR-5, FR-6, FR-6a, §3.6, §8.4.3.
 *
 * A SEPARATE MODULE BY DESIGN. The statutory text is exact by law, and G3
 * outranks G5 (§2.1): the tolerant rules that let `STONE'S THROW` match
 * `Stone's Throw` must not be reachable from here. Keeping this out of
 * `compare.ts` makes that a structural guarantee rather than a remembered one.
 *
 * `normalizeText` is deliberately NOT imported. The only variance permitted is
 * whitespace, line breaks and typographic characters — each an artefact of
 * reading text off a photograph rather than a difference in the words
 * themselves. UT-W12 asserts that a meaning-preserving paraphrase still fails.
 */

import { collapseWhitespace, normalizeTypography } from './normalize.js'
import { type WarningReference, warningReference } from './reference.js'
import type { WarningSegmentVerdict, WarningVerdict } from './types.js'

/** Permitted variance only: typography and layout. Never case, never wording. */
function normalizeForComparison(input: string): string {
  return collapseWhitespace(normalizeTypography(input))
}

/**
 * Describe the first difference between required and observed wording.
 *
 * An agent needs to see the discrepancy to act on it — "the warning is wrong"
 * is not actionable (ui-design §7).
 */
function describeDeviation(required: string, observed: string): string {
  const requiredWords = required.split(' ')
  const observedWords = observed.split(' ')

  for (let i = 0; i < Math.max(requiredWords.length, observedWords.length); i++) {
    const req = requiredWords[i]
    const obs = observedWords[i]
    if (req === obs) continue
    if (req === undefined) return `Extra text on the label: "${observedWords.slice(i).join(' ')}"`
    if (obs === undefined) return `Missing from the label: "${requiredWords.slice(i).join(' ')}"`
    return `Required "${req}", label has "${obs}"`
  }
  return 'Wording differs from the required text'
}

/** Locate the region of the observed text a numbered clause should occupy. */
function clauseRegion(observed: string, marker: string, nextMarker: string | null): string | null {
  const start = observed.indexOf(marker)
  if (start === -1) return null
  const rest = observed.slice(start)
  if (nextMarker === null) return rest.trim()
  const end = rest.indexOf(nextMarker, marker.length)
  return (end === -1 ? rest : rest.slice(0, end)).trim()
}

function verifyHeader(segment: WarningSegment, observed: string): WarningSegmentVerdict {
  const base = { segmentId: segment.id, label: segment.label, required: segment.text }

  if (observed.includes(segment.text)) {
    return { ...base, ok: true, observed: segment.text }
  }

  // Present but wrongly cased is a distinct — and common — failure. Jenny
  // rejected exactly this last month (SRC-5), so it must be named, not merely
  // reported as absent.
  const lowerIndex = observed.toLowerCase().indexOf(segment.text.toLowerCase())
  if (lowerIndex !== -1) {
    const asFound = observed.slice(lowerIndex, lowerIndex + segment.text.length)
    return {
      ...base,
      ok: false,
      observed: asFound,
      deviation: `Appears as "${asFound}" — it must be in capital letters.`,
    }
  }

  const withoutColon = segment.text.replace(/:$/, '')
  if (observed.includes(withoutColon)) {
    return {
      ...base,
      ok: false,
      observed: withoutColon,
      deviation: 'The colon after "GOVERNMENT WARNING" is missing.',
    }
  }

  return { ...base, ok: false, observed: null, deviation: 'Not found on the label.' }
}

type WarningSegment = WarningReference['segments'][number]

function verifyClause(
  segment: WarningSegment,
  observed: string,
  nextMarker: string | null,
): WarningSegmentVerdict {
  const base = { segmentId: segment.id, label: segment.label, required: segment.text }

  if (observed.toLowerCase().includes(segment.text.toLowerCase())) {
    return { ...base, ok: true, observed: segment.text }
  }

  const marker = segment.text.slice(0, segment.text.indexOf(' '))
  const region = clauseRegion(observed, marker, nextMarker)

  if (region === null || region === '') {
    return { ...base, ok: false, observed: null, deviation: 'Not found on the label.' }
  }

  return {
    ...base,
    ok: false,
    observed: region,
    deviation: describeDeviation(segment.text, region),
  }
}

/** True when the numbered clauses appear in the order the regulation specifies. */
function clausesInOrder(ref: WarningReference, observed: string): boolean {
  const positions = ref.segments
    .filter((s) => !s.caseSensitive)
    .map((s) => observed.indexOf(s.text.slice(0, s.text.indexOf(' '))))
    .filter((p) => p !== -1)

  return positions.every((p, i) => i === 0 || p > (positions[i - 1] ?? -1))
}

/**
 * Verify the warning statement as read from a label.
 *
 * @param observedText the statement exactly as it appears, or `null` if absent
 * @param ref reference data; injected so tests can supply their own
 */
export function verifyWarning(
  observedText: string | null,
  ref: WarningReference = warningReference(),
  /**
   * Whether the artwork was legible enough for a transcription to mean
   * anything. Measured from pixels by the caller — never claimed by the
   * extractor, which will happily return this statute from memory.
   *
   * A verdict is still computed when false, because what the model produced is
   * worth recording; aggregation refuses to conclude from it (D5).
   */
  legible = true,
): WarningVerdict {
  const advisory = ref.advisoryChecks.map(({ id, text, citation }) => ({ id, text, citation }))

  if (observedText === null || observedText.trim() === '') {
    return {
      legible,
      present: false,
      ok: false,
      segments: ref.segments.map((s) => ({
        segmentId: s.id,
        label: s.label,
        ok: false,
        required: s.text,
        observed: null,
        deviation: 'The warning statement was not found on this label.',
      })),
      advisory,
      referenceDataVersion: ref.configVersion,
    }
  }

  const observed = normalizeForComparison(observedText)

  const segments = ref.segments.map((segment, index) => {
    if (segment.caseSensitive) return verifyHeader(segment, observed)
    const next = ref.segments[index + 1]
    const nextMarker =
      next !== undefined && !next.caseSensitive ? next.text.slice(0, next.text.indexOf(' ')) : null
    return verifyClause(segment, observed, nextMarker)
  })

  // Clauses present but transposed: each matches in isolation, so order is
  // checked explicitly (UT-W10).
  const ordered = clausesInOrder(ref, observed)
  const allOk = segments.every((s) => s.ok)

  return {
    legible,
    present: true,
    ok: allOk && ordered,
    segments:
      allOk && !ordered
        ? segments.map((s, i) =>
            i === segments.length - 1
              ? { ...s, ok: false, deviation: 'The clauses appear in the wrong order.' }
              : s,
          )
        : segments,
    advisory,
    referenceDataVersion: ref.configVersion,
  }
}
