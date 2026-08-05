/**
 * Region maps — where on a submission each thing lives.
 *
 * Design reference: batch-backend-design §4.3, B-D8.
 *
 * The affix rectangle is a property of ONE REVISION of one form. Treating it as
 * a constant would mean cropping a fixed rectangle out of an unknown document
 * and extracting whatever landed inside — silent mis-cropping produces
 * confident nonsense, which is the worst failure class this system has.
 *
 * So an unrecognised form is REJECTED, not guessed at.
 *
 * This is policy configuration (§8.6.1): a form revision is a config change.
 */

/** A rectangle in PDF points, origin bottom-left, as the form itself reports. */
export interface Rect {
  readonly x0: number
  readonly y0: number
  readonly x1: number
  readonly y1: number
}

export interface FormRegionMap {
  readonly formId: string
  readonly description: string
  /** Page size in points, used to sanity-check that a document is this form. */
  readonly pageWidth: number
  readonly pageHeight: number
  /** Which page carries the affixed labels, 1-based. */
  readonly labelPage: number
  /** Where the labels are affixed. */
  readonly labelRegion: Rect
  /** Which page carries the application record, 1-based. */
  readonly recordPage: number
  /** `null` means the whole page. */
  readonly recordRegion: Rect | null
}

/**
 * TTB F 5100.31 (04/2023).
 *
 * Coordinates read from the form's own AcroForm field rectangles rather than
 * measured by eye — `AFFIX COMPLETE SET OF LABELS BELOW` reports exactly this.
 */
export const TTB_F5100_31_2023: FormRegionMap = {
  formId: 'ttb-f5100.31-2023-04',
  description: 'TTB F 5100.31 (04/2023) with a separate application record page — the corpus shape',
  pageWidth: 612,
  pageHeight: 1008, // Legal, 8.5 x 14 in
  labelPage: 1,
  labelRegion: { x0: 24.6, y0: 28.9, x1: 589.4, y1: 326.8 },
  recordPage: 2,
  recordRegion: null,
}

/**
 * The same form, filed on its own (D50).
 *
 * A genuinely filed TTB F 5100.31 is the published document: the labels affixed
 * to page 1, the applicant's entries above them, and instruction pages after.
 * There is no separate record page — the map above expects one because the
 * corpus supplies one, and cropping page 2 of a real filing reads the
 * instructions.
 *
 * **The paper form has no box for class/type, alcohol content or net
 * contents.** Item 15 asks for such information only where it is embossed on
 * the container and absent from the labels. Those three fields therefore have
 * no source in a real filing and come back as `NOT_SUPPLIED` — not assessed,
 * which is honest, and not a pass. What the record page *does* carry is item 5
 * (which selects the governing regulation) and item 6, the brand name.
 *
 * Nothing is defaulted in to fill the gap, and the temptation is worth naming:
 * a supplied default would be compared against the label, and a value that
 * agrees with an invented expectation is a false MATCH — the failure direction
 * the whole design exists to avoid (§8.3.1).
 */
export const TTB_F5100_31_2023_FILED: FormRegionMap = {
  formId: 'ttb-f5100.31-2023-04-filed',
  description: 'TTB F 5100.31 (04/2023) filed on its own — the record is the form itself',
  pageWidth: 612,
  pageHeight: 1008,
  labelPage: 1,
  labelRegion: { x0: 24.6, y0: 28.9, x1: 589.4, y1: 326.8 },
  // The same page as the label, and a different part of it.
  recordPage: 1,
  // The union of the 49 AcroForm field rectangles that sit above the affix
  // box (y 341.2-969.2, x 17.8-593.7), widened to take in the printed captions
  // beside them — read from the form, as the label region was, rather than
  // measured by eye.
  //
  // `y0` stops 8pt clear of the affix box, and that clearance is the D4
  // boundary rather than tidiness: a record crop reaching into the artwork
  // would take the "application" reading off the very label it is about to be
  // compared against, and every field would then match itself.
  recordRegion: { x0: 14, y0: 334, x1: 598, y1: 985 },
}

/**
 * Ordered most specific first.
 *
 * The two shapes are the same page size and are told apart by page count:
 * exactly two pages is the corpus shape — a form page and a record page —
 * and anything else is the form filed on its own. That is an assumption, and a
 * shallow one: a filing that happened to be two pages for some other reason
 * would be cropped as though page 2 were a record. It is stated here rather
 * than hidden because the shape probe knows nothing else about the document,
 * and guessing from content would be a larger claim than this needs.
 */
const KNOWN: readonly FormRegionMap[] = [TTB_F5100_31_2023, TTB_F5100_31_2023_FILED]

/** Thrown when a submission does not match a form we have a region map for. */
export class UnknownFormError extends Error {
  constructor(detail: string) {
    super(`this does not appear to be a form I recognise: ${detail}`)
    this.name = 'UnknownFormError'
  }
}

export interface DocumentShape {
  readonly pageCount: number
  readonly pageWidth: number
  readonly pageHeight: number
}

/**
 * Identify which form a document is, by shape.
 *
 * Deliberately narrow. A document that does not match is rejected with a
 * message an agent can act on, rather than cropped on the assumption that it
 * is probably the right form.
 */
export function identifyForm(shape: DocumentShape): FormRegionMap {
  const tolerance = 2 // points; rounding in the producing toolchain
  for (const form of KNOWN) {
    const sizeMatches =
      Math.abs(shape.pageWidth - form.pageWidth) <= tolerance &&
      Math.abs(shape.pageHeight - form.pageHeight) <= tolerance
    if (!sizeMatches) continue
    // Enough pages for both regions this map reads. A two-page map needs two;
    // the filed-alone map needs one, which is why it also serves a five-page
    // document and a single form page.
    if (shape.pageCount < Math.max(form.labelPage, form.recordPage)) continue
    // The corpus shape is exactly two pages. A longer document is the form
    // filed on its own, with instruction pages after it — cropping its page 2
    // would read the instructions.
    if (form.recordPage === 2 && shape.pageCount !== 2) continue
    return form
  }
  throw new UnknownFormError(
    `page size ${Math.round(shape.pageWidth)}x${Math.round(shape.pageHeight)}pt, ` +
      `${shape.pageCount} page(s). Known: ${KNOWN.map((f) => f.formId).join(', ')}`,
  )
}

/**
 * Scale a region to a raster of a given DPI.
 *
 * PDF points are 1/72 inch, so the factor is dpi/72.
 */
export function regionToPixels(region: Rect, dpi: number) {
  const k = dpi / 72
  return {
    width: Math.round((region.x1 - region.x0) * k),
    height: Math.round((region.y1 - region.y0) * k),
    /** Offset from the TOP of the page, which is what a renderer wants. */
    left: Math.round(region.x0 * k),
    top: 0, // filled by the caller, which knows the page height
  }
}
