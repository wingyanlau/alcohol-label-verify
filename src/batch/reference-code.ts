/**
 * The reference code a person can quote (D21, ui-design §10).
 *
 * A correlation identifier existed from the start — the submission UUID — and
 * it satisfied the requirement in the way that matters least. D21's purpose is
 * that an agent who reports a wrong result gives an operator something that
 * finds it, and the trip between them is spoken, handwritten, or typed into a
 * ticket. A UUID does not survive that; `7K2M-4QX9` does.
 *
 * DERIVED, NOT ALLOCATED. The code is a function of the submission id, so it
 * needs no generation step, no uniqueness check at intake, and no backfill
 * decision for records written before it existed — every submission that has
 * ever been processed already has its code, and always had it. A random code
 * would have been equally readable and would have made the history unreachable.
 *
 * WHAT IT IS NOT. Not a secret and not an access control. It is a label for a
 * record, and the record is reachable by whoever can reach the endpoint. Its
 * only job is to be repeatable by a human without error.
 */

/**
 * Crockford's base32 alphabet: no I, L, O or U.
 *
 * The exclusions are the entire point. I/1, L/1, O/0 are the pairs a person
 * confuses when reading a code aloud or writing it down, and U is dropped so
 * the alphabet cannot spell an obscenity by accident. A code that is
 * transcribed wrongly one time in twenty is worse than no code, because the
 * failure lands on the operator as "that reference doesn't exist".
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** Two groups of four. The hyphen is a reading aid, not part of the value. */
const GROUP = 4
const GROUPS = 2
const CHARS = GROUP * GROUPS

const PATTERN = new RegExp(`^[${ALPHABET}]{${GROUP}}-[${ALPHABET}]{${GROUP}}$`)

/**
 * `sha256(submissionId)` rendered in the alphabet above.
 *
 * Hashed rather than sliced from the id, so codes differ in every position
 * rather than only where the ids happen to. Forty bits — a little over a
 * million million codes — which is far past what a prototype can collide and
 * short enough to dictate in one breath.
 */
export async function referenceCodeFor(submissionId: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(submissionId))
  const bytes = new Uint8Array(digest)

  let out = ''
  for (let i = 0; i < CHARS; i++) {
    // One byte per character, reduced into the alphabet. Unbiased: 256 is
    // exactly eight times 32, so every symbol has the same number of preimages.
    out += ALPHABET[(bytes[i] as number) % ALPHABET.length]
  }

  return `${out.slice(0, GROUP)}-${out.slice(GROUP)}`
}

/** Whether a string is shaped like a code. Rejects typos before a lookup. */
export function isReferenceCode(value: string): boolean {
  return PATTERN.test(value.toUpperCase())
}

/** Normalise what a person typed: case and surrounding space are forgiven. */
export function normaliseReferenceCode(value: string): string {
  return value.trim().toUpperCase()
}
