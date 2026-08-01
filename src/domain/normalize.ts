/**
 * Text normalisation for tolerant-text fields.
 *
 * Design reference: §8.4.3.
 *
 * Every transformation here removes a difference that is *typographic* — an
 * artefact of how text was set or read — and none removes a difference that is
 * *semantic*. That boundary is the whole point: `STONE'S THROW` and
 * `Stone's Throw` are the same brand set differently (UT-N02), while
 * `Old Tom & Sons` and `Old Tom and Sons` differ in wording and must not be
 * silently reconciled (UT-N09).
 *
 * Tolerance in the wrong direction produces false matches, and a false match is
 * a non-compliant label passing review (§8.3.1). When in doubt, do not normalise.
 *
 * MUST NOT be applied to the statutory warning statement, which is exact by law
 * (G3 outranks G5). The warning verifier lives in a separate module so that
 * constraint is structural rather than remembered.
 */

/** Typographic characters mapped to their ASCII equivalents. */
const TYPOGRAPHIC: ReadonlyArray<readonly [RegExp, string]> = [
  [/[‘’‚‛′]/g, "'"], // single quotes, prime
  [/[“”„‟″]/g, '"'], // double quotes
  [/[‐-―−]/g, '-'], // hyphens, dashes, minus
  [/…/g, '...'], // ellipsis
  [/ /g, ' '], // non-breaking space
]

/** Normalise typographic variants without altering wording. The warning verifier uses this too. */
export function normalizeTypography(input: string): string {
  let out = input.normalize('NFKC')
  for (const [pattern, replacement] of TYPOGRAPHIC) {
    out = out.replace(pattern, replacement)
  }
  return out
}

/** Collapse runs of whitespace — including line breaks — to single spaces, and trim. */
export function collapseWhitespace(input: string): string {
  return input.replace(/\s+/g, ' ').trim()
}

/**
 * Full normalisation for tolerant-text comparison.
 *
 * Case-folds, normalises typography, treats hyphens and slashes as separators,
 * drops remaining punctuation, and collapses whitespace.
 *
 * Note on `&`: it is dropped rather than expanded to "and". Expanding it would
 * be a semantic substitution, and UT-N09 asserts that `Old Tom & Sons` does not
 * match `Old Tom and Sons` — such a case escalates (§8.4.4) rather than being
 * absorbed here.
 */
export function normalizeText(input: string): string {
  let out = normalizeTypography(input).toLowerCase()
  out = out.replace(/[-/]/g, ' ') // structural separators
  out = out.replace(/[^\p{L}\p{N}\s]/gu, '') // drop remaining punctuation
  return collapseWhitespace(out)
}

/** True when two strings are equal after tolerant-text normalisation. */
export function textEquivalent(a: string, b: string): boolean {
  return normalizeText(a) === normalizeText(b)
}
