/**
 * The bundled demonstration corpus.
 *
 * The batch endpoint runs over the 26 authored submissions in `testdata/`,
 * shipped as static assets (see `wrangler.jsonc` → `assets`) and read at intake
 * through the `ASSETS` binding. Each is a real TTB F 5100.31 with the label set
 * affixed on page 1 and the application record on page 2, so the batch path is
 * exercised exactly as a real upload would be — nothing here is a stub reading.
 *
 * The list is explicit rather than discovered: a Worker cannot enumerate a
 * directory, and an explicit manifest is also the thing a test can assert is
 * complete.
 */

/** Where the submission PDFs live inside the assets directory. */
export const SUBMISSIONS_PREFIX = 'submissions'

/** Every bundled submission, in corpus order. */
export const SUBMISSION_FILES: readonly string[] = [
  'L01-fully-compliant.pdf',
  'L02-brand-differs-only-in-capitalisation-and-apost.pdf',
  'L03-alcohol-content-stated-with-proof-on-the-label.pdf',
  'L04-alcohol-content-genuinely-differs.pdf',
  'L05-health-warning-absent-from-the-label-set.pdf',
  'L06-health-warning-header-in-title-case.pdf',
  'L07-health-warning-altered-by-one-word.pdf',
  'L08-health-warning-body-set-in-bold.pdf',
  'L09-submission-scanned-at-an-angle-under-glare.pdf',
  'L10-out-of-focus-scan-graded-degradation.pdf',
  'L11-wrong-document-affixed-a-shipping-invoice.pdf',
  'L12-incomplete-label-set-front-label-only.pdf',
  'L13-label-bearing-injected-instruction-text.pdf',
  'L14-net-contents-differ-by-unit-only.pdf',
  'L15-net-contents-genuinely-differ.pdf',
  'L16-net-contents-missing-from-the-label.pdf',
  'L17-class-type-genuinely-differs.pdf',
  'L18-class-type-abbreviated-on-the-label.pdf',
  'L19-brand-name-is-a-substring-of-the-record-value.pdf',
  'L20-ampersand-on-the-label-and-on-the-record.pdf',
  'L21-record-leaves-class-type-blank.pdf',
  'L22-multiple-simultaneous-discrepancies.pdf',
  'L23-warning-clauses-in-the-wrong-order.pdf',
  'L24-unreadable-field-alongside-a-genuine-mismatch.pdf',
  'L25-fanciful-name-present-on-the-record-and-the-la.pdf',
  'L26-corrupt-truncated-file.pdf',
]

export interface Submission {
  /** Stable short id — the `Lnn` prefix. Unique within the corpus. */
  readonly submissionId: string
  /** The original filename, shown in the worklist. */
  readonly sourceName: string
  /** Path within the assets directory. */
  readonly assetPath: string
}

/** The `Lnn` prefix of a corpus filename, e.g. `L07-…` → `L07`. */
export function submissionIdFor(file: string): string {
  const dash = file.indexOf('-')
  return dash === -1 ? file.replace(/\.pdf$/i, '') : file.slice(0, dash)
}

/** The corpus as structured submissions, ready for intake. */
export function corpus(): readonly Submission[] {
  return SUBMISSION_FILES.map((sourceName) => ({
    submissionId: submissionIdFor(sourceName),
    sourceName,
    assetPath: `${SUBMISSIONS_PREFIX}/${sourceName}`,
  }))
}
