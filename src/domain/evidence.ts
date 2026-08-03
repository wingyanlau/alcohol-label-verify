/**
 * A verdict describes itself, or it is not a verdict (FR-10, UT-V01–V03).
 *
 * Every finding names the rule that produced it and shows both values, so an
 * agent can defend it to an applicant instead of relaying a machine's opinion.
 * That much was already true. What was missing is the part `UT-V03` actually
 * asks for: that it be **unrepresentable otherwise** — "enforced by the type,
 * not by convention".
 *
 * The distinction is not pedantry. `readonly rule: string` permits `''`, and a
 * rule that holds only while everyone remembers it ends the first afternoon
 * somebody adds a verdict state in a hurry. Nothing would fail, no test would
 * go red, and a finding would reach a reviewer with no defence attached — which
 * is the one output this system is not allowed to produce.
 *
 * So a citation is *constructed*, and construction is where the requirement
 * lives.
 */

/**
 * A citation that has been through `rule()`.
 *
 * Branded so the compiler, not a reviewer, is what stops a bare string being
 * assigned to `FieldVerdict.rule`. This is the whole of `UT-V03`: adding a new
 * verdict state with `rule: 'x'` now fails to build, instead of shipping a
 * finding with no defence and no test going red.
 */
export type RuleCitation = string & { readonly __ruleCitation: unique symbol }

/** Thrown when a verdict would be produced with nothing to justify it. */
export class EvidenceMissing extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EvidenceMissing'
  }
}

/**
 * Placeholders, which are the realistic failure.
 *
 * Nobody ships `rule: ''` deliberately. What happens is that something has to
 * go in the slot while a comparison is being written, and `TODO` is never
 * revisited — so it reaches a reviewer looking like a citation and saying
 * nothing.
 */
const PLACEHOLDERS = new Set(['todo', 'tbd', 'n/a', 'na', 'none', '-', '—', '?', 'fixme', 'xxx'])

/**
 * A rule citation: text that says what was applied.
 *
 * Returns the citation so it reads as a constructor at the call site, and
 * throws rather than returning null because there is no sensible way for a
 * caller to continue. A verdict without its rule should not be issued at all.
 *
 * Deliberately not a check on *quality* — this cannot tell whether the
 * sentence is a good explanation, and pretending otherwise would be theatre.
 * It rules out the two forms that carry no information at all: nothing, and a
 * placeholder for something.
 */
export function rule(citation: string): RuleCitation {
  const trimmed = citation.trim()
  if (trimmed === '') {
    throw new EvidenceMissing(
      'A verdict must name the rule that produced it (FR-10). ' +
        'An empty citation leaves a finding with no defence.',
    )
  }
  if (PLACEHOLDERS.has(trimmed.toLowerCase())) {
    throw new EvidenceMissing(
      `"${trimmed}" is a placeholder, not a rule. A finding carrying it would ` +
        'look defended and not be.',
    )
  }
  return trimmed as RuleCitation
}
