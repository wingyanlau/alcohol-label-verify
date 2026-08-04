/**
 * Intake for a directly-uploaded label image (ui-design §4.3).
 *
 * Single review accepts artwork, not a submission PDF — so none of the PDF
 * guards apply and the checks have to exist in their own right. The rule from
 * §9.3 still holds: every constraint stated on screen is re-enforced here,
 * because client-side validation exists for responsiveness and never for
 * correctness.
 */

import { describe, expect, it } from 'vitest'
import { checkImageIntake } from './image.js'
import { IntakeRejected } from './normaliser.js'

const limits = { maxBytes: 10_485_760, maxPageCount: 8, maxPixels: 40_000_000 }

const bytes = (...head: number[]) => {
  const buf = new Uint8Array(2048)
  buf.set(head)
  return buf.buffer as ArrayBuffer
}

const PNG = () => bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
const JPEG = () => bytes(0xff, 0xd8, 0xff, 0xe0)

describe('an uploaded label image', () => {
  it('accepts PNG and JPEG', () => {
    expect(() => checkImageIntake(PNG(), limits)).not.toThrow()
    expect(() => checkImageIntake(JPEG(), limits)).not.toThrow()
  })

  // Sniffed, never trusted from the name (ADV-05). A `.png` holding something
  // else is the case the extension cannot see.
  it('judges by content, not by what the file claims to be', () => {
    const notAnImage = new TextEncoder().encode('%PDF-1.7\nthis is a PDF').buffer as ArrayBuffer
    expect(() => checkImageIntake(notAnImage, limits)).toThrow(IntakeRejected)
  })

  it('tells someone who uploaded a PDF what to do about it', () => {
    // The likeliest wrong file by far, because the batch path takes PDFs. A
    // generic "unsupported format" would leave them guessing.
    const pdf = new TextEncoder().encode('%PDF-1.7\n').buffer as ArrayBuffer
    try {
      checkImageIntake(pdf, limits)
      throw new Error('expected a rejection')
    } catch (error) {
      const message = (error as IntakeRejected).message
      expect(message).toMatch(/PDF/i)
      expect(message).toMatch(/JPEG|PNG/i)
      expect(message).not.toMatch(/invalid|failed|error code/i)
    }
  })

  it('rejects an oversized image and states the limit', () => {
    const big = new Uint8Array(limits.maxBytes + 1)
    big.set([0x89, 0x50, 0x4e, 0x47])
    try {
      checkImageIntake(big.buffer as ArrayBuffer, limits)
      throw new Error('expected a rejection')
    } catch (error) {
      expect((error as IntakeRejected).message).toContain('10')
    }
  })

  it('rejects an empty upload rather than sending nothing to a model', () => {
    expect(() => checkImageIntake(new ArrayBuffer(0), limits)).toThrow(IntakeRejected)
  })
})
