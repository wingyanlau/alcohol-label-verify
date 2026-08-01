/**
 * Intake and region-map tests.
 *
 * These cover the checks that must happen BEFORE anything expensive: a
 * decompression bomb must be refused before it is decoded, and an unrecognised
 * form must be rejected rather than cropped on assumption.
 *
 * Silent mis-cropping is the worst failure this module can produce — it yields
 * a confident reading of the wrong part of the page.
 */

import { describe, expect, it } from 'vitest'
import {
  checkIntake,
  checkPixelBudget,
  countPages,
  type IntakeLimits,
  IntakeRejected,
} from './normaliser.js'
import { identifyForm, regionToPixels, TTB_F5100_31_2023, UnknownFormError } from './regions.js'

const limits: IntakeLimits = {
  maxBytes: 10 * 1024 * 1024,
  maxPageCount: 8,
  maxPixels: 40_000_000,
}

const pdf = (body: string) => new TextEncoder().encode(`%PDF-1.7\n${body}`).buffer as ArrayBuffer

const twoPages = pdf('/Type /Pages /Count 2\n/Type /Page \n/Type /Page \n%%EOF')

describe('checkIntake — cheap checks, before anything expensive', () => {
  it('accepts a well-formed PDF within the limits', () => {
    expect(() => checkIntake(twoPages, limits)).not.toThrow()
  })

  it('rejects a file that is not a PDF, by content rather than extension', () => {
    const notPdf = new TextEncoder().encode('GIF89a....').buffer as ArrayBuffer
    expect(() => checkIntake(notPdf, limits)).toThrow(/not a PDF/)
  })

  it('rejects an oversized file, and states the limit', () => {
    const big = new ArrayBuffer(11 * 1024 * 1024)
    new Uint8Array(big).set(new TextEncoder().encode('%PDF-1.7'))
    try {
      checkIntake(big, limits)
      expect.unreachable('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(IntakeRejected)
      expect((e as IntakeRejected).reason).toBe('too-large')
      expect((e as Error).message).toMatch(/limit is 10 MB/)
    }
  })

  it('rejects an encrypted PDF with an actionable message', () => {
    const encrypted = pdf('/Encrypt 5 0 R\n/Type /Pages /Count 1\n/Type /Page \n')
    expect(() => checkIntake(encrypted, limits)).toThrow(/password-protected/)
  })

  it('rejects a PDF with too many pages, before a renderer sees it', () => {
    const many = pdf('/Type /Pages /Count 40\n')
    try {
      checkIntake(many, limits)
      expect.unreachable('should have thrown')
    } catch (e) {
      expect((e as IntakeRejected).reason).toBe('too-many-pages')
    }
  })

  it('rejects a PDF with no discoverable pages as corrupt', () => {
    expect(() => checkIntake(pdf('nothing useful here'), limits)).toThrow(/damaged/)
  })

  it('L26 — a truncated file is rejected at intake', () => {
    // The corpus case: structurally a PDF, unreadable as one.
    const truncated = new Uint8Array(twoPages).slice(0, 12).buffer as ArrayBuffer
    expect(() => checkIntake(truncated, limits)).toThrow(IntakeRejected)
  })
})

describe('countPages — a bound, not a fact', () => {
  it('reads the page tree count when present', () => {
    expect(countPages('/Type /Pages /Count 5')).toBe(5)
  })

  it('falls back to tallying page objects', () => {
    expect(countPages('/Type /Page \n/Type /Page \n/Type /Page \n')).toBe(3)
  })

  it('takes the larger of the two, so a compressed file is not under-counted', () => {
    expect(countPages('/Count 2\n/Type /Page \n/Type /Page \n/Type /Page \n')).toBe(3)
  })

  it('returns zero when neither signal is present', () => {
    expect(countPages('no page markers at all')).toBe(0)
  })
})

describe('checkPixelBudget', () => {
  it('permits a 300 DPI affix region', () => {
    expect(() => checkPixelBudget(2353, 1241, limits)).not.toThrow()
  })

  it('refuses a render that would exceed the budget', () => {
    try {
      checkPixelBudget(20000, 20000, limits)
      expect.unreachable('should have thrown')
    } catch (e) {
      expect((e as IntakeRejected).reason).toBe('too-many-pixels')
      expect((e as Error).message).toMatch(/lower resolution/)
    }
  })
})

describe('identifyForm — reject rather than guess (B-D8)', () => {
  it('recognises TTB F 5100.31 by page shape', () => {
    const form = identifyForm({ pageCount: 2, pageWidth: 612, pageHeight: 1008 })
    expect(form.formId).toBe(TTB_F5100_31_2023.formId)
  })

  it('tolerates sub-point rounding from the producing toolchain', () => {
    expect(() => identifyForm({ pageCount: 2, pageWidth: 611.5, pageHeight: 1008.4 })).not.toThrow()
  })

  it('rejects a document of the wrong page size', () => {
    // Letter rather than Legal. Cropping the affix rectangle out of this would
    // extract whatever happened to be there — confident nonsense.
    expect(() => identifyForm({ pageCount: 2, pageWidth: 612, pageHeight: 792 })).toThrow(
      UnknownFormError,
    )
  })

  it('rejects a document with too few pages', () => {
    expect(() => identifyForm({ pageCount: 0, pageWidth: 612, pageHeight: 1008 })).toThrow(
      UnknownFormError,
    )
  })

  it('names what it saw and what it knows, so the message is actionable', () => {
    try {
      identifyForm({ pageCount: 1, pageWidth: 595, pageHeight: 842 })
      expect.unreachable('should have thrown')
    } catch (e) {
      expect((e as Error).message).toMatch(/595x842pt/)
      expect((e as Error).message).toMatch(/ttb-f5100\.31/)
    }
  })
})

describe('regionToPixels', () => {
  it('scales the affix region to 300 DPI', () => {
    const px = regionToPixels(TTB_F5100_31_2023.labelRegion, 300)
    // 564.8pt wide is 7.844in; at 300 DPI that is 2353px.
    expect(px.width).toBe(2353)
    expect(px.height).toBe(1241)
  })

  it('scales linearly with DPI', () => {
    const at150 = regionToPixels(TTB_F5100_31_2023.labelRegion, 150)
    const at300 = regionToPixels(TTB_F5100_31_2023.labelRegion, 300)
    // Within a pixel: each is rounded independently, so doubling the smaller
    // need not equal the larger exactly.
    expect(Math.abs(at300.width - at150.width * 2)).toBeLessThanOrEqual(1)
  })
})
