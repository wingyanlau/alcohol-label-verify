/**
 * Sample submissions, for somebody who has no TTB filing to hand.
 *
 * The single-review screen takes a filed TTB F 5100.31 as a PDF, which is the
 * right input and a closed door to anyone who does not have one — a reviewer
 * looking at the deployment, or anyone who wants to see what a discrepancy
 * looks like before trusting a screen that reports one.
 *
 * These are the corpus files, which is the point: they are the same documents
 * the batch runs on, with authored ground truth stating what each one should
 * produce (testdata/README). Offering a mocked-up sample instead would
 * demonstrate the interface rather than the system.
 *
 * ---------------------------------------------------------------------------
 * TWO THINGS THIS MODULE DELIBERATELY DOES NOT DO
 *
 * It does not restate the outcome. Every fact except the one-line description
 * is read from the manifest, so a sample cannot promise something the corpus
 * does not record. A hand-kept copy would drift, and the screen is the one that
 * would look authoritative when it did.
 *
 * It does not accept an arbitrary id. The id reaches an asset path, and an id
 * taken on trust is a path taken on trust.
 */

/**
 * The curated few.
 *
 * Six rather than twenty-six: a list nobody reads to the end demonstrates
 * nothing. Chosen so the set spans a clean pass, a genuine discrepancy, a
 * tolerance that must NOT fire, an unreadable field, and the adversarial case —
 * because a demonstration made only of passes says nothing about judgement, and
 * one made only of failures reads as a broken system.
 *
 * ---------------------------------------------------------------------------
 * F01 IS DELIBERATELY NOT HERE
 *
 * It was, for one revision. `F01` is the TTB form filed on its own, and it is a
 * fair test of the region map that reads such a filing (D50) — but it is a poor
 * demonstration of the system, because three of the four comparison fields have
 * no source on the paper form and come back unassessed. Shown to somebody
 * forming a first impression, that reads as a tool that could not read the
 * document.
 *
 * The complete submission is the two-page shape every sample below has: the
 * form, and the application record carrying the fields the form has no box for.
 * That is the input this system is for. `F01` stays in the corpus as a fixture
 * with authored ground truth; it is not an advertisement.
 */
export const SAMPLE_IDS: readonly string[] = ['L01', 'L04', 'L14', 'L06', 'L24', 'L13']

/**
 * What a person will see, in the words of what happens.
 *
 * Written here rather than taken from the manifest's `serves`, which is test-case
 * shorthand — "UT-W05, IT-03" tells a reviewer nothing about what to look for.
 */
const SHOWS: Readonly<Record<string, string>> = {
  L01: 'Everything agrees. The check should find nothing, and a system that invents a discrepancy here is the one nobody will trust.',
  L04: 'The record says 45% and the label says 40%. A real discrepancy, reported against the one field it belongs to.',
  L14: '75 cL on the label against 750 mL on the record — the same quantity written two ways. This must NOT be flagged.',
  L06: 'The warning reads "Government Warning:" in title case. It looks fine at a glance and is a documented rejection.',
  L24: 'One field cannot be read, and another genuinely mismatches. What could not be read outranks what was wrong with it.',
  L13: 'The label carries text telling the reader to ignore its instructions, alongside a real mismatch. The mismatch must still be reported.',
}

export interface SampleEntry {
  readonly id: string
  /** The corpus file name, for the download route. */
  readonly file: string
  readonly title: string
  /** The outcome the corpus records — authored ground truth, never restated. */
  readonly expected: string
  /** One line, in the words of what happens. */
  readonly shows: string
}

/** The shape this reads out of the corpus manifest, and nothing more. */
interface ManifestLike {
  readonly cases: ReadonlyArray<{
    readonly id: string
    readonly file: string
    readonly title: string
    readonly expected: { readonly outcome: string }
  }>
}

/**
 * The curated samples, joined against the corpus.
 *
 * A curated id the corpus no longer contains is **dropped**, not filled in: an
 * entry with an invented title and a download that 404s is worse than a shorter
 * list, and the shorter list is visibly shorter.
 */
export function sampleCatalogue(manifest: ManifestLike): readonly SampleEntry[] {
  const entries: SampleEntry[] = []
  for (const id of SAMPLE_IDS) {
    const found = manifest.cases.find((c) => c.id === id)
    if (found === undefined) continue
    entries.push({
      id,
      file: found.file,
      title: found.title,
      expected: found.expected.outcome,
      shows: SHOWS[id] ?? found.title,
    })
  }
  return entries
}

/**
 * The corpus file a sample id refers to, or null.
 *
 * Null for anything not on the curated list — which covers a mistyped id, a
 * corpus case that is not offered as a sample, and a traversal attempt, all by
 * the same rule. The value is used to build an asset path, so the check is a
 * whitelist rather than a sanitiser: sanitising asks what is dangerous, and a
 * whitelist asks what is allowed.
 */
export function sampleFileFor(id: string, manifest: ManifestLike): string | null {
  if (!SAMPLE_IDS.includes(id)) return null
  return manifest.cases.find((c) => c.id === id)?.file ?? null
}
