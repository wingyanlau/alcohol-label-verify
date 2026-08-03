/**
 * Salvaging a JSON answer.
 *
 * Shared, because every vendor's model wraps or fences its JSON sooner or
 * later, and a second copy would drift from this one's single deliberate
 * salvage attempt.
 */

import { ExtractionContractError } from '../domain/extraction.js'

/** Pull a JSON object out of a model response that may be fenced or prefixed. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fenced?.[1]?.trim() ?? trimmed

  try {
    return JSON.parse(candidate)
  } catch {
    // A model may wrap the object in prose. One salvage attempt, then fail —
    // parsing defensively past this point would turn a broken response into a
    // compliance finding (§8.3).
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1))
      } catch {
        /* fall through */
      }
    }
    throw new ExtractionContractError('response was not valid JSON', text)
  }
}
