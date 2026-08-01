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
  description: 'TTB F 5100.31 (04/2023) — Application for Label/Bottle Approval',
  pageWidth: 612,
  pageHeight: 1008, // Legal, 8.5 x 14 in
  labelPage: 1,
  labelRegion: { x0: 24.6, y0: 28.9, x1: 589.4, y1: 326.8 },
  recordPage: 2,
  recordRegion: null,
}

const KNOWN: readonly FormRegionMap[] = [TTB_F5100_31_2023]

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
    if (sizeMatches && shape.pageCount >= form.labelPage) return form
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
