/**
 * Content digests, for the things the chain has to commit to.
 *
 * One implementation rather than one per caller: two digests of the same bytes
 * must agree, and the moment there are two functions producing them there is a
 * day where they disagree and the difference is read as tampering.
 */

/** `sha256(input)`, hex. Strings are hashed as UTF-8. */
export async function sha256Hex(input: ArrayBuffer | string): Promise<string> {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
