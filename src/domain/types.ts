import type { RuleCitation } from './evidence.js'
/**
 * Domain types.
 *
 * Design reference: §8.2 (data model), §8.4.1 (verdict states).
 *
 * Nothing in `src/domain` performs I/O, reads a clock, or touches a platform
 * API. Every type here describes a value the deterministic comparison layer
 * produces or consumes, which is what lets the whole suite run offline at zero
 * cost — and what makes the container port cheap (deployment-path §3).
 */

/** Fields under comparison, in the order of the agent's paper checklist (P4). */
export const FIELDS = ['brandName', 'classType', 'alcoholContent', 'netContents'] as const

export type FieldName = (typeof FIELDS)[number]

export const FIELD_LABELS: Record<FieldName, string> = {
  brandName: 'Brand name',
  classType: 'Class / type',
  alcoholContent: 'Alcohol content',
  netContents: 'Net contents',
}

/**
 * Outcome of comparing one field.
 *
 * `UNREADABLE` and `MISMATCH` are distinct by requirement (FR-11), not by
 * presentation preference: "I could not read this" and "I read this and it is
 * wrong" lead an agent to different actions — request better artwork, versus
 * raise a discrepancy with the applicant.
 */
export type FieldVerdictState =
  /** Agrees within a stated rule. */
  | 'MATCH'
  /** Read successfully; disagrees. */
  | 'MISMATCH'
  /** The application supplied a value; the label does not carry it. */
  | 'MISSING_ON_LABEL'
  /** The application supplied nothing to compare against. Not assessed. */
  | 'NOT_SUPPLIED'
  /** Could not be determined from the image. Blocks a clear result (§8.4.2). */
  | 'UNREADABLE'
  /** Read and compared, but flagged for human confirmation. */
  | 'LOW_CONFIDENCE'

/**
 * A single field's verdict, carrying its own evidence.
 *
 * FR-10 requires the expected value, the value read, and the rule applied to be
 * visible to the agent. Because all three live on the verdict, the results view
 * needs no access to the extractor or the comparator — the verdict is
 * self-describing.
 */
export interface FieldVerdict {
  readonly field: FieldName
  readonly state: FieldVerdictState
  /** As supplied on the application. `null` when nothing was supplied. */
  readonly expected: string | null
  /** As read from the label. `null` when absent or unreadable. */
  readonly observed: string | null
  /**
   * The rule applied, named so a finding can be defended (FR-10).
   *
   * `RuleCitation`, not `string`: it can only be produced by `rule()`, so a
   * verdict with an empty or placeholder citation does not compile (UT-V03).
   */
  readonly rule: RuleCitation
  /**
   * Present only when a rule was actually *exercised* — a tolerance applied, a
   * unit converted, a reading refused. An exact match carries no explanation,
   * which is what keeps a clean result uncluttered (ui-design §6.3).
   */
  readonly explanation?: string
}

/** Outcome of comparing one segment of the statutory warning statement. */
export interface WarningSegmentVerdict {
  readonly segmentId: string
  readonly label: string
  readonly ok: boolean
  readonly required: string
  /** As read from the label, or `null` if the segment was not found. */
  readonly observed: string | null
  /** The specific difference, when there is one. "The warning is wrong" is not actionable. */
  readonly deviation?: string
}

/** A formatting rule the system cannot verify from an image (FR-6a, N4). */
export interface AdvisoryCheck {
  readonly id: string
  readonly text: string
  readonly citation: string
}

export interface WarningVerdict {
  readonly present: boolean
  readonly ok: boolean
  /**
   * Whether the artwork could actually be read well enough to verify.
   *
   * Measured from the pixels, never asserted by the extractor. The statutory
   * warning is a fixed string every model knows by heart, so a model shown an
   * illegible warning can return it perfectly without having read a character
   * — and will, silently. Two renderings of the same submission at the same
   * blur, differing only in that one said "birth defect" where the statute
   * says "birth defects", produced identical canonical transcriptions.
   *
   * `false` blocks a conclusion (D5): not present-and-wrong, not absent, but
   * "a human must look at this".
   */
  readonly legible: boolean
  readonly segments: readonly WarningSegmentVerdict[]
  /** Rules the agent must confirm by eye. Never auto-failed. */
  readonly advisory: readonly AdvisoryCheck[]
  readonly referenceDataVersion: number
}

/**
 * Overall outcome, derived by rule from field verdicts (§8.4.2). Never from a model.
 *
 * The two `CONFIRM` states are distinct on purpose (D40). `_FLAGGED` asks the
 * agent to confirm a **reading**; `_POLICY` asks them to make a **compliance
 * judgement** the artwork cannot settle. Merging them would put two different
 * requests under one headline.
 */
export type Outcome =
  | 'CLEAR'
  | 'CLEAR_CONFIRM_FLAGGED'
  | 'CLEAR_CONFIRM_POLICY'
  | 'DISCREPANCIES_FOUND'
  | 'INCOMPLETE'

/**
 * Values as supplied on the application. Absent fields are `null`, never
 * `undefined`.
 *
 * `productType` sits outside `FIELDS` deliberately, and the distinction is
 * load-bearing. `FIELDS` are *compared* against the label; product type is
 * not, because no label states "Distilled spirits" — it is the **selection
 * input** that decides which rules govern the submission (27 CFR 5.141, and
 * item 5 on TTB F 5100.31, the only place the real form records it).
 *
 * Adding it to `FIELDS` would have made the comparison layer look for it on
 * the artwork and report a discrepancy against every compliant label.
 */
export type ApplicationData = Readonly<Record<FieldName, string | null>> & {
  readonly productType?: string | null
}

/**
 * The three boxes at item 5 of TTB F 5100.31, spelled as this system spells them.
 *
 * A fact about the **form**, not about the rule set. `GOVERNED_PRODUCT_TYPES`
 * (findings.ts) is the narrower list of types some active rule covers, and the
 * two must not be conflated: a form may legitimately declare `Wine` while no
 * wine rule has yet been approved. Reading it as `Wine` and then reporting that
 * no rule governs it is correct; refusing to read it because no rule governs it
 * would hide a filing the system cannot check.
 */
export const FORM_PRODUCT_TYPES: readonly string[] = ['Wine', 'Distilled spirits', 'Malt beverages']

/** One field as read from the label by the extraction layer. */
export interface ObservedField {
  /** Raw text exactly as it appears, or `null` if not found. */
  readonly raw: string | null
  /** Extractor confidence, 0..1. */
  readonly confidence: number
  /** The extractor could not determine this field from the image. */
  readonly unreadable: boolean
}

/**
 * What the extraction layer produces.
 *
 * Deliberately free of any application data (D4). The extractor is never shown
 * the expected values: a model that can see them tends to confirm them, and
 * every such error is a false *match* — a non-compliant label passing review.
 */
export interface Extraction {
  readonly fields: Readonly<Record<FieldName, ObservedField>>
  /** The warning statement exactly as it appears, or `null` if not found. */
  readonly warningStatement: string | null
  /**
   * Item 5, TYPE OF PRODUCT, as read from the application record.
   *
   * Not a `FIELDS` member and never compared against the label: no label states
   * "Distilled spirits". It is the **selection input** — which body of
   * regulation governs this submission (D25) — and it is read from the record
   * region only.
   *
   * `null` where it was not asked for, could not be read, or was not a single
   * unambiguous choice. Null is load-bearing: selection then reports that
   * nothing could be checked, rather than guessing a rule set. A wrong product
   * type is the most dangerous single misread in this system, because every
   * finding downstream would look perfectly ordinary.
   */
  readonly productType?: string | null
}
