/**
 * Document normalisation — PDF to pixels.
 *
 * Design reference: batch-backend-design §4, D33, B-D1.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS AT ALL
 *
 * A submission page carries BOTH the application values and the label. Sending
 * that page to the extractor would put the expected values in front of the
 * model, which is what D4 forbids: a model shown the expected value tends to
 * confirm it, and every such error is a false MATCH.
 *
 * So the page is split before extraction. The artefact colocates what the
 * architecture requires be separated, and this module does the separating.
 * ---------------------------------------------------------------------------
 *
 * The label region is ALWAYS rasterised, even when the PDF has a text layer.
 * A PDF's text layer can disagree with what the page visually displays —
 * invisible text, mismatched glyphs — and compliance concerns what a consumer
 * sees on a bottle. Reading the label from pixels is a security property, not a
 * performance trade-off.
 */

import type { FormRegionMap } from './regions.js'

export interface NormalisedRegion {
  readonly region: 'label' | 'record'
  readonly image: ArrayBuffer
  readonly mimeType: string
  readonly widthPx: number
  readonly heightPx: number
  readonly dpi: number
}

export interface NormaliseResult {
  readonly form: FormRegionMap
  readonly label: NormalisedRegion
  readonly record: NormalisedRegion
  /**
   * Text layer of the RECORD page only, when the PDF carries one.
   *
   * Legitimate for application data: it is the applicant's declared data, and
   * reading it costs nothing and is exact. NEVER populated for the label —
   * see the module comment.
   */
  readonly recordTextLayer: string | null
  readonly elapsedMs: number
}

/**
 * The seam.
 *
 * Two implementations: a browser-side one for interactive review, and a
 * Browser Rendering one for batch (D33). The container port replaces both with
 * a library call, and nothing above this interface changes.
 */
export interface Normaliser {
  readonly name: string
  normalise(pdf: ArrayBuffer, dpi: number): Promise<NormaliseResult>
}

/** Limits enforced before any rendering happens (§9.3). */
export interface IntakeLimits {
  readonly maxBytes: number
  readonly maxPageCount: number
  readonly maxPixels: number
}

export class IntakeRejected extends Error {
  constructor(
    readonly reason:
      | 'too-large'
      | 'too-many-pages'
      | 'too-many-pixels'
      | 'not-a-pdf'
      | 'encrypted'
      | 'corrupt',
    message: string,
  ) {
    super(message)
    this.name = 'IntakeRejected'
  }
}

const PDF_MAGIC = '%PDF-'

/**
 * Cheap structural checks, before anything expensive.
 *
 * Deliberately performed on bytes rather than on a parsed document: a
 * decompression bomb must be refused before it is decoded, and page count must
 * be bounded before a renderer is handed the file.
 */
export function checkIntake(bytes: ArrayBuffer, limits: IntakeLimits): void {
  if (bytes.byteLength > limits.maxBytes) {
    throw new IntakeRejected(
      'too-large',
      `That file is ${(bytes.byteLength / 1_048_576).toFixed(1)} MB. ` +
        `The limit is ${(limits.maxBytes / 1_048_576).toFixed(0)} MB. ` +
        'Please upload a smaller file.',
    )
  }

  const head = new TextDecoder('latin1').decode(
    new Uint8Array(bytes, 0, Math.min(1024, bytes.byteLength)),
  )
  if (!head.startsWith(PDF_MAGIC)) {
    throw new IntakeRejected(
      'not-a-pdf',
      'That file is not a PDF. Please upload the submission as a PDF.',
    )
  }

  // Content-sniffed, not extension-trusted. An encrypted PDF cannot be
  // rendered, and saying so is more useful than a decode failure later.
  const whole = new TextDecoder('latin1').decode(new Uint8Array(bytes))
  if (/\/Encrypt\b/.test(whole)) {
    throw new IntakeRejected(
      'encrypted',
      'This PDF is password-protected and cannot be opened. Please supply an unprotected copy.',
    )
  }

  const pageCount = countPages(whole)
  if (pageCount === 0) {
    throw new IntakeRejected(
      'corrupt',
      'This PDF could not be opened. It may be damaged — try exporting it again.',
    )
  }
  if (pageCount > limits.maxPageCount) {
    throw new IntakeRejected(
      'too-many-pages',
      `This PDF has ${pageCount} pages. The limit is ${limits.maxPageCount}.`,
    )
  }
}

/**
 * Count pages without a full parse.
 *
 * `/Count n` in the page tree is the fast path; the `/Type /Page` tally is the
 * fallback for files that compress their object streams. Neither is a complete
 * PDF parser, and neither needs to be — this is a bound, not a fact.
 */
export function countPages(text: string): number {
  const counts = [...text.matchAll(/\/Count\s+(\d+)/g)].map((m) => Number(m[1]))
  const fromTree = counts.length > 0 ? Math.max(...counts) : 0
  const tallied = (text.match(/\/Type\s*\/Page[^s]/g) ?? []).length
  return Math.max(fromTree, tallied)
}

/** Guard the pixel budget before a renderer allocates it. */
export function checkPixelBudget(widthPx: number, heightPx: number, limits: IntakeLimits): void {
  const pixels = widthPx * heightPx
  if (pixels > limits.maxPixels) {
    throw new IntakeRejected(
      'too-many-pixels',
      `Rendering this region would need ${pixels.toLocaleString()} pixels, ` +
        `above the limit of ${limits.maxPixels.toLocaleString()}. Try a lower resolution.`,
    )
  }
}
