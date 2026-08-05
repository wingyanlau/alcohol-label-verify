/**
 * Server-side normalisation via Browser Rendering.
 *
 * Design reference: D33, batch-backend-design §4.4.
 *
 * A Worker cannot rasterise a PDF: 128 MB of memory and no native modules. A
 * headless browser can — it has a canvas, runs pdf.js unmodified, and gives
 * exact control of scale and crop. The page renders the PDF at the chosen DPI
 * and the screenshot is the crop.
 *
 * Measured cost is ~3.4 s, mostly browser launch. Amortised across a batch that
 * is tolerable; on a single interactive review it would consume more than the
 * whole extraction budget, which is why D33 puts the interactive path in the
 * client instead.
 */

import puppeteer from '@cloudflare/puppeteer'
import { toBase64 } from '../providers/base64.js'
import {
  checkPixelBudget,
  type IntakeLimits,
  type NormaliseResult,
  type Normaliser,
} from './normaliser.js'
import { buildInvocation } from './page-script.js'
import { identifyForm } from './regions.js'

/** pdf.js, pinned. A floating version would change rendering under a fixed audit trail. */
const PDFJS_VERSION = '4.10.38'
const PDFJS_URL = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.mjs`
const PDFJS_WORKER = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.mjs`

export interface BrowserNormaliserOptions {
  readonly browser: Fetcher
  readonly limits: IntakeLimits
  readonly now?: () => number
}

interface RenderedRegions {
  readonly pageCount: number
  readonly pageWidth: number
  readonly pageHeight: number
  /** The record crop's size in points — the whole page where it is not cropped. */
  readonly recordWidthPt: number
  readonly recordHeightPt: number
  readonly labelPng: string
  readonly recordPng: string
  readonly recordText: string | null
}

/**
 * Runs inside the browser. Renders page 1 at `dpi`, crops the affix region,
 * renders the record page whole, and reads the record page's text layer.
 *
 * The label crop is a raster of what is *displayed*. Its text layer is
 * deliberately never consulted — a PDF text layer can disagree with the
 * rendering, and compliance concerns what a consumer sees.
 */
export const RENDER_SCRIPT = `
async (pdfBase64, dpi, region, labelPage, recordPage, pdfjsUrl, workerUrl, recordRegion) => {
  const pdfjs = await import(pdfjsUrl)
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

  const bytes = Uint8Array.from(atob(pdfBase64), c => c.charCodeAt(0))
  const doc = await pdfjs.getDocument({ data: bytes }).promise
  const scale = dpi / 72

  const renderPage = async (n) => {
    const page = await doc.getPage(n)
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx, viewport }).promise
    return { canvas, viewport, page }
  }

  const first = await doc.getPage(1)
  const unscaled = first.getViewport({ scale: 1 })

  // PDF coordinates are bottom-left origin; canvas is top-left.
  const cut = (rendered, r) => {
    const out = document.createElement('canvas')
    out.width = Math.round((r.x1 - r.x0) * scale)
    out.height = Math.round((r.y1 - r.y0) * scale)
    out.getContext('2d').drawImage(
      rendered.canvas,
      Math.round(r.x0 * scale),
      Math.round((unscaled.height - r.y1) * scale),
      out.width,
      out.height,
      0, 0, out.width, out.height,
    )
    return out
  }

  const label = await renderPage(labelPage)
  const crop = cut(label, region)

  // Rendered once when both regions are on the same page, which is the shape
  // of a form filed on its own: the labels are affixed to page 1 and the
  // applicant's entries are above them.
  const record = recordPage === labelPage ? label : await renderPage(recordPage)
  // Cropped where the map says to. A whole page is right for a separate record
  // page and wrong for the form itself, where the rest of page 1 is the label
  // this record is about to be compared against (D4).
  const recordCanvas = recordRegion ? cut(record, recordRegion) : record.canvas
  let recordText = null
  try {
    const content = await record.page.getTextContent()
    const joined = content.items.map(i => i.str).join(' ').trim()
    recordText = joined === '' ? null : joined
  } catch { recordText = null }

  const strip = d => d.slice(d.indexOf(',') + 1)
  return {
    pageCount: doc.numPages,
    pageWidth: unscaled.width,
    pageHeight: unscaled.height,
    recordWidthPt: recordRegion ? recordRegion.x1 - recordRegion.x0 : unscaled.width,
    recordHeightPt: recordRegion ? recordRegion.y1 - recordRegion.y0 : unscaled.height,
    labelPng: strip(crop.toDataURL('image/png')),
    recordPng: strip(recordCanvas.toDataURL('image/png')),
    recordText,
  }
}
`

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out.buffer
}

export function createBrowserNormaliser(opts: BrowserNormaliserOptions): Normaliser {
  const now = opts.now ?? (() => Date.now())

  return {
    name: 'browser-rendering',

    async normalise(pdf: ArrayBuffer, dpi: number): Promise<NormaliseResult> {
      const started = now()
      const browser = await puppeteer.launch(opts.browser)
      try {
        const page = await browser.newPage()
        // A blank secure origin: pdf.js needs a document context, and about:blank
        // has no module loader.
        await page.setContent('<!doctype html><html><body></body></html>')

        // The region map is chosen AFTER the shape is known, so an unrecognised
        // form is rejected rather than cropped on assumption (B-D8). A first
        // pass reads the shape using the default map's page numbers, which are
        // safe for any document with at least two pages.
        // The invocation is built rather than passed as arguments: a string
        // first argument to `page.evaluate` is evaluated as an expression and
        // any arguments after it are ignored. See page-script.ts.
        const encoded = toBase64(pdf)
        const probe = (await page.evaluate(
          buildInvocation(RENDER_SCRIPT, [
            encoded,
            dpi,
            { x0: 0, y0: 0, x1: 1, y1: 1 },
            1,
            1,
            PDFJS_URL,
            PDFJS_WORKER,
            null,
          ]),
        )) as RenderedRegions

        const form = identifyForm({
          pageCount: probe.pageCount,
          pageWidth: probe.pageWidth,
          pageHeight: probe.pageHeight,
        })

        const widthPx = Math.round(((form.labelRegion.x1 - form.labelRegion.x0) * dpi) / 72)
        const heightPx = Math.round(((form.labelRegion.y1 - form.labelRegion.y0) * dpi) / 72)
        checkPixelBudget(widthPx, heightPx, opts.limits)

        const rendered = (await page.evaluate(
          buildInvocation(RENDER_SCRIPT, [
            encoded,
            dpi,
            form.labelRegion,
            form.labelPage,
            Math.min(form.recordPage, probe.pageCount),
            PDFJS_URL,
            PDFJS_WORKER,
            form.recordRegion,
          ]),
        )) as RenderedRegions

        return {
          form,
          label: {
            region: 'label',
            image: base64ToArrayBuffer(rendered.labelPng),
            mimeType: 'image/png',
            widthPx,
            heightPx,
            dpi,
          },
          record: {
            region: 'record',
            image: base64ToArrayBuffer(rendered.recordPng),
            mimeType: 'image/png',
            widthPx: Math.round((rendered.recordWidthPt * dpi) / 72),
            heightPx: Math.round((rendered.recordHeightPt * dpi) / 72),
            dpi,
          },
          recordTextLayer: rendered.recordText,
          elapsedMs: now() - started,
        }
      } finally {
        await browser.close()
      }
    },
  }
}
