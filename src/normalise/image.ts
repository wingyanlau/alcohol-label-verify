/**
 * Intake for a label image uploaded directly (ui-design §4.3, §9.3).
 *
 * Single review takes artwork, not a submission PDF, so none of the PDF guards
 * apply: there is no page tree to count, no `%%EOF` to find, no encryption
 * dictionary. What remains is the part that matters — is this actually an
 * image, and is it within the limits the screen already stated.
 *
 * Separate from `checkIntake` rather than a mode of it. One function taking a
 * "kind" would branch on it in every check and share almost nothing, and the
 * two are validating different claims about different things.
 *
 * **No decoding happens here.** Dimensions are guarded by `checkPixelBudget`
 * where the renderer knows them (ADV-03); this runs before anything allocates,
 * which is the only point at which refusing is free.
 */

import { IntakeRejected } from './normaliser.js'

/** Magic bytes. The name a file arrives with is a claim, not evidence. */
const SIGNATURES: ReadonlyArray<readonly [string, readonly number[]]> = [
  ['PNG', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  // JPEG in all its framings: JFIF, Exif, and bare SOI.
  ['JPEG', [0xff, 0xd8, 0xff]],
]

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46] // '%PDF'

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false
  return signature.every((b, i) => bytes[i] === b)
}

export interface ImageLimits {
  readonly maxBytes: number
}

/**
 * Accept a label image, or refuse it with something a person can act on.
 *
 * Order matters: emptiness first (it has no signature to check), then size
 * (cheapest), then content. Being told the file is 12 MB is more useful than
 * being told it is not a PNG when it is both.
 */
export function checkImageIntake(bytes: ArrayBuffer, limits: ImageLimits): void {
  if (bytes.byteLength === 0) {
    throw new IntakeRejected('corrupt', 'That file is empty. Please choose the label image again.')
  }

  if (bytes.byteLength > limits.maxBytes) {
    throw new IntakeRejected(
      'too-large',
      `That image is ${(bytes.byteLength / 1_048_576).toFixed(1)} MB. ` +
        `The limit is ${(limits.maxBytes / 1_048_576).toFixed(0)} MB. ` +
        'Please upload a smaller image.',
    )
  }

  const head = new Uint8Array(bytes, 0, Math.min(16, bytes.byteLength))
  if (SIGNATURES.some(([, signature]) => startsWith(head, signature))) return

  // A PDF is by far the likeliest wrong file here, because the batch path
  // takes PDFs and the two screens sit behind one product. Saying so beats a
  // generic "unsupported format" that leaves someone guessing which of their
  // files is wrong.
  if (startsWith(head, PDF_MAGIC)) {
    throw new IntakeRejected(
      'not-a-pdf',
      'That is a PDF. This screen checks a single label image — please upload ' +
        'the artwork as JPEG or PNG, or use the batch screen for a full submission.',
    )
  }

  throw new IntakeRejected(
    'not-a-pdf',
    'That file is not a JPEG or PNG image. Please upload the label artwork as an image.',
  )
}
