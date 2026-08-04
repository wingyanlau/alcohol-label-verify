/**
 * Resolving a printed designation to its class (27 CFR 5.141, 5.143).
 *
 * A label states a *designation* — "Kentucky Straight Bourbon Whiskey". Rules
 * that depend on the *class* need "Whisky". Nothing in this system could get
 * from one to the other, which blocked the minimum-bottling-strength rule and
 * any use of the COLA Class/Type Code.
 *
 * ---------------------------------------------------------------------------
 * THE RESOLUTION RULE, AND WHERE IT COMES FROM
 *
 * 5.141(a) divides distilled spirits into classes, further divided into types.
 * 5.141(d) requires all words in a designation to appear together. 5.143(b)
 * permits a place to appear as part of the designation — "New York Bourbon
 * Whisky". Taken together: a designation belongs to a class when the class
 * name, in any spelling the regulation permits, appears as a **whole word**
 * within it.
 *
 * Whole word matters more than it looks. "Ginger" contains "gin"; without the
 * boundary a ginger liqueur becomes a gin and inherits gin's 40% floor, which
 * is a confident false finding on a lawful label.
 *
 * AMBIGUITY IS REPORTED, NEVER BROKEN. 5.141(b)(2) allows a product to conform
 * to more than one class and be labelled with any one of them. "Brandy
 * Liqueur" genuinely matches two. Picking the first would silently decide which
 * rules apply to a submission, and nothing downstream would show that a choice
 * had been made at all.
 *
 * WHAT THIS IS NOT. It is not a claim that the designation is *correct* — that
 * a product labelled bourbon meets bourbon's standard of identity is a question
 * about the liquid, which no label can answer. It resolves what the label
 * *says* to the class whose rules then apply.
 */

import taxonomy from '../../config/class-type-taxonomy.json' with { type: 'json' }

export interface SpiritClass {
  readonly id: string
  readonly name: string
  readonly citation: string
  readonly spellings: readonly string[]
  /** Class-level floor, or null where the regulation states none. */
  readonly minimumBottlingAbv: number | null
}

export interface Resolution {
  /** The single class this designation belongs to, or null. */
  readonly class: SpiritClass | null
  /** Every class matched. More than one is an ambiguity, not a shortlist. */
  readonly candidates: readonly SpiritClass[]
  readonly reason: string
}

const CLASSES = taxonomy.classes as unknown as readonly SpiritClass[]

/** Whole-word, case-insensitive. See the note on "ginger". */
function mentions(designation: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^\\p{L}])${escaped}([^\\p{L}]|$)`, 'iu').test(designation)
}

export function resolveDesignation(designation: string): Resolution {
  const text = designation.trim()
  if (text === '') {
    return { class: null, candidates: [], reason: 'no designation was printed' }
  }

  const matched = CLASSES.filter(
    (c) => c.spellings.some((s) => mentions(text, s)) || mentions(text, c.name),
  )

  if (matched.length === 1) {
    return {
      class: matched[0] as SpiritClass,
      candidates: matched,
      reason: `"${text}" names the class ${(matched[0] as SpiritClass).name}`,
    }
  }

  if (matched.length > 1) {
    return {
      class: null,
      candidates: matched,
      reason:
        `"${text}" matches more than one class (${matched.map((c) => c.name).join(', ')}). ` +
        '27 CFR 5.141(b)(2) permits a product conforming to several classes to be ' +
        'labelled with any one of them, so this is an ambiguity for a person to ' +
        'settle — resolving it here would silently choose which rules apply.',
    }
  }

  return {
    class: null,
    candidates: [],
    reason:
      `"${text}" matches no class in the taxonomy. The taxonomy is class-level and ` +
      'incomplete, so this is ignorance rather than a breach.',
  }
}
