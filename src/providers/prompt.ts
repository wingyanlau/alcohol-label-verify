/**
 * The instruction, shared by every adapter.
 *
 * Deliberately one text rather than one per vendor. Two providers reading the
 * same corpus under the same instruction differ in exactly one variable — who
 * is reading — which is what turns B-Q4 ("which model reads a 4.5pt warning
 * statement best") into a measurement. A prompt tuned per vendor would confound
 * every comparison between them, and the audit record could no longer claim two
 * verdicts were produced under the same conditions.
 */

import type { ExtractionRequest } from '../domain/extraction.js'
import { FIELD_LABELS } from '../domain/types.js'

/**
 * Bumped whenever the instruction below changes.
 *
 * Recorded per extraction (§8.7.1): a verdict is only re-derivable if the
 * prompt that produced its reading is identifiable.
 */
export const PROMPT_VERSION = 'label-extract@3'

/**
 * The instruction.
 *
 * Three things it does deliberately:
 *
 *  1. Names the fields to find, and nothing about what they should contain.
 *  2. Makes "not present" and "cannot read" explicit, equally-weighted answers.
 *     Presented with a slot, a model is disinclined to leave it empty (§8.3.2),
 *     so refusing must be as easy as answering.
 *  3. Asks for the warning statement VERBATIM, including capitalisation, since
 *     FR-6 turns on whether the header is in capitals.
 */
/**
 * Every instruction this deployment can send, as one text.
 *
 * **Both regions, deliberately.** This was taken over the label form alone,
 * and the record form could then be rewritten with the digest unmoved — which
 * is exactly what happened when the record prompt learned to read item 5. A
 * digest that covers half the instruction certifies the wrong half silently,
 * which is worse than not having one.
 */
export function digestedPromptText(): string {
  const base = {
    image: new ArrayBuffer(0),
    mimeType: 'image/png',
    fields: ['brandName', 'classType', 'alcoholContent', 'netContents'],
  } as const
  return [
    buildPrompt({ ...base, region: 'label', includeWarning: true, includeGeometry: true }),
    buildPrompt({
      ...base,
      region: 'record',
      includeWarning: false,
      includeProductType: true,
      includeReduction: true,
    }),
  ].join('\n--- record ---\n')
}

/**
 * The digest of the instruction as it actually stands.
 *
 * PROMPT_VERSION is a label someone remembers to change; this is the text. A
 * prompt edited without a version bump would leave every audit record citing a
 * version that no longer describes what was sent, and nothing would show it.
 */
export async function promptDigest(): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(digestedPromptText()))
  return [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16)
}

export function buildPrompt(request: ExtractionRequest): string {
  const fieldList = request.fields.map((f) => `  "${f}"  — ${FIELD_LABELS[f]}`).join('\n')

  const subject =
    request.region === 'label'
      ? 'This image shows alcohol beverage label artwork.'
      : 'This image shows an application record for an alcohol label.'

  return `${subject}

Read what is printed. Report only what you can actually see.

Fields to look for:
${fieldList}

Return JSON of exactly this shape:

{
  "fields": {
    "<field>": { "value": "<text exactly as printed>", "confidence": 0.0-1.0 }
  }${request.includeWarning ? ',\n  "warningStatement": "<the government warning, verbatim>"' : ''}${
    request.includeProductType
      ? ',\n  "productType": "<Wine | Distilled spirits | Malt beverages, or null>"'
      : ''
  }${
    request.includeReduction
      ? ',\n  "labelReduction": "<item 19 reduction, exactly as printed, or null>"'
      : ''
  }${
    request.includeGeometry
      ? `,
  "warningGeometry": {
    "capHeightPx": <height of one capital letter, in pixels, or null>,
    "longestLineCharacters": <characters on the longest warning line, or null>,
    "longestLineWidthPx": <width of that line, in pixels, or null>
  }`
      : ''
  }
}

Rules:
- If a field is NOT PRINTED anywhere, return { "present": false } for it.
- If a field is printed but you CANNOT READ it — blurred, obscured, too small —
  return { "unreadable": true }. Do not guess. Reporting that you could not read
  something is a correct and expected answer.
- Copy text exactly as printed, including capitalisation and punctuation.
${
  request.includeWarning
    ? '- Transcribe the government warning VERBATIM, preserving capitalisation exactly.\n  If there is no warning statement, use null.\n'
    : ''
}${
  request.includeProductType
    ? `- TYPE OF PRODUCT. The record states this either as one ticked box at
  item 5 — WINE, DISTILLED SPIRITS, MALT BEVERAGES — or as a printed
  value on a record page. Report the ONE it states, spelled exactly as
  "Wine", "Distilled spirits" or "Malt beverages".
  If it states none of them, or more than one, or you cannot tell which,
  return null. Do not infer it from the brand, the class, the alcohol
  content or anything else — a guess here selects the wrong body of
  regulation, and every check that follows would look correct.\n`
    : ''
}${
  request.includeReduction
    ? `- LABEL REDUCTION. Item 19 states whether the labels were reduced to fit,
  and by what percentage. Copy it exactly as printed. If item 19 is blank or
  says nothing about reduction, return null — do not write "none" or "0".
  Report the printed words; do not convert them to a number.\n`
    : ''
}${
  request.includeGeometry
    ? `- WARNING GEOMETRY. Measure, in the pixels of THIS image:
  the height of one capital letter in the government warning, the number of
  characters on its longest line, and the width that line occupies.
  Report pixels only. Do not convert to millimetres, points or inches, and do
  not state whether any size is adequate — you do not know what this image was
  rendered at, so any such figure would be invented.
  Return null for any of the three you cannot measure. A null is expected and
  correct; an estimate is not.\n`
    : ''
}- Return JSON only. No commentary.`
}
