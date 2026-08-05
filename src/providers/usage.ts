/**
 * What a read cost, taken from whatever the vendor volunteered.
 *
 * The gateway module records why this exists, in the words of the day it was
 * learned: *"a day's inference allowance was spent without anyone being able to
 * say on what, because usage was visible only as 'it worked' or '429'."* The
 * counts were in every response all along and the adapters discarded them.
 *
 * ---------------------------------------------------------------------------
 * TWO SHAPES, AND NEITHER IS PROMISED
 *
 * Workers AI reports OpenAI-style `usage` with snake_case counts; Gemini
 * reports `usageMetadata` with camelCase ones and a different name for the
 * output count. Both are read here rather than in the adapters, so a third
 * vendor is one branch in one file rather than a field quietly missing from a
 * cost report nobody is checking.
 *
 * **Absent is a first-class answer.** A vendor that reports nothing, a model
 * that omits it, a cached response — all give `null`, and null must travel as
 * null. A zero would be a claim that a read was free, which would quietly
 * understate a bill; and summing a column of invented zeroes gives a number
 * that looks like a measurement.
 */

export interface TokenUsage {
  /** What was sent — the prompt and the image. */
  readonly promptTokens: number | null
  /** What came back. */
  readonly completionTokens: number | null
  /** As the vendor totals it, which is not always the sum of the other two. */
  readonly totalTokens: number | null
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * A count, or null.
 *
 * Rejects anything that is not a finite, non-negative number. A vendor
 * returning `"1234"` or `-1` or `NaN` is reporting something this cannot
 * interpret, and recording it would put a wrong number in a cost report — worse
 * than recording that the vendor said nothing intelligible.
 */
function count(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
  return value
}

/**
 * Read token usage from a vendor's response envelope.
 *
 * Given the whole parsed envelope, not a pre-selected branch: which branch
 * holds the counts is exactly the vendor difference this exists to absorb.
 */
export function usageFrom(envelope: unknown): TokenUsage | null {
  if (!isRecord(envelope)) return null

  // OpenAI-shaped, which Workers AI follows. It appears at the top level or
  // inside `result`, depending on whether the caller unwrapped the envelope.
  const openai = isRecord(envelope.usage)
    ? envelope.usage
    : isRecord(envelope.result) && isRecord(envelope.result.usage)
      ? envelope.result.usage
      : null
  if (openai !== null) {
    const usage: TokenUsage = {
      promptTokens: count(openai.prompt_tokens),
      completionTokens: count(openai.completion_tokens),
      totalTokens: count(openai.total_tokens),
    }
    return anyReported(usage) ? withDerivedTotal(usage) : null
  }

  // Gemini. `candidatesTokenCount` is the output count; the name differs
  // because a response may hold several candidates, though this system asks
  // for one.
  const gemini = isRecord(envelope.usageMetadata) ? envelope.usageMetadata : null
  if (gemini !== null) {
    const usage: TokenUsage = {
      promptTokens: count(gemini.promptTokenCount),
      completionTokens: count(gemini.candidatesTokenCount),
      totalTokens: count(gemini.totalTokenCount),
    }
    return anyReported(usage) ? withDerivedTotal(usage) : null
  }

  return null
}

function anyReported(usage: TokenUsage): boolean {
  return (
    usage.promptTokens !== null || usage.completionTokens !== null || usage.totalTokens !== null
  )
}

/**
 * A total, where the vendor gave the parts but not the sum.
 *
 * Derived only from two numbers it actually reported. Never from one — a
 * "total" equal to the prompt count alone would read as a complete measurement
 * of a read whose output was never counted.
 *
 * Gemini's own total can exceed prompt + candidates, because thinking tokens
 * are counted separately. Where the vendor states a total, that is the one
 * kept: it is the number the bill is drawn from.
 */
function withDerivedTotal(usage: TokenUsage): TokenUsage {
  if (usage.totalTokens !== null) return usage
  if (usage.promptTokens === null || usage.completionTokens === null) return usage
  return { ...usage, totalTokens: usage.promptTokens + usage.completionTokens }
}
