/**
 * Identifying the reader, before it reads anything.
 *
 * The audit record needs to say which model produced a verdict, and asking the
 * model is not a way to find out. `modelId` is what was requested — a stable
 * name that a vendor may repoint to new weights — and the version a vendor
 * *reports* is a claim it may not make at all: Gemini returned neither
 * `modelVersion` nor `responseId` here.
 *
 * So the reader is characterised by what it does, once per job, before the
 * work starts: a fixed image and a fixed question, and the digest of the
 * answer. That is evidence this system produced rather than a statement it was
 * given, and it is recorded against the job so every verdict in the job
 * inherits it.
 *
 * WHAT IT PROVES, AND WHAT IT DOES NOT. A changed fingerprint proves the
 * reader changed — different weights, different serving configuration, a
 * silently repointed alias. An unchanged fingerprint is consistent with
 * sameness and does not establish it: a model can change in ways one question
 * does not reveal. This is a tripwire, not an identity, and it is worth having
 * because the failure it catches — weights moving under a stable name — is
 * otherwise undetectable after the fact.
 */

/**
 * The question. Fixed forever, because two fingerprints taken with different
 * questions are not comparable, and comparability is the entire point.
 *
 * Deliberately about the artwork rather than about the model: "what brand name
 * is printed here" has one right answer that the image determines, so a reader
 * that has genuinely changed is likely to phrase it differently, while a reader
 * that has not is likely to repeat itself.
 */
export const PROBE_PROMPT = 'What brand name is printed on this label? Reply with only the name.'

/** The corpus image the probe is taken against. Shipped, fixed, and legible. */
export const PROBE_IMAGE = 'rasters/L01-label.png'

/**
 * Reduce a reply to its claim.
 *
 * Casing, spacing and the pleasantries a model wraps an answer in drift between
 * runs without anything meaningful changing. A fingerprint that moved on those
 * would raise an alarm every time and be ignored by the third.
 */
export function normaliseReply(reply: string): string {
  return reply
    .toLowerCase()
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.,:;!-]+|[\s.,:;!-]+$/g, '')
    .trim()
}

/** `sha256(normalised reply)`, hex. The reply itself is never recorded. */
export async function fingerprintOf(reply: string): Promise<string> {
  const bytes = new TextEncoder().encode(normaliseReply(reply))
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
