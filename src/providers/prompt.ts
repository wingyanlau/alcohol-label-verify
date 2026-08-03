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
export const PROMPT_VERSION = 'label-extract@1'

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
 * The digest of the instruction as it actually stands.
 *
 * PROMPT_VERSION is a label someone remembers to change; this is the text. A
 * prompt edited without a version bump would leave every audit record citing a
 * version that no longer describes what was sent, and nothing would show it.
 * Taken over the label-region form, which is the one that carries the warning.
 */
export async function promptDigest(): Promise<string> {
  const text = buildPrompt({
    region: 'label',
    image: new ArrayBuffer(0),
    mimeType: 'image/png',
    fields: ['brandName', 'classType', 'alcoholContent', 'netContents'],
    includeWarning: true,
  })
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
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
  }${request.includeWarning ? ',\n  "warningStatement": "<the government warning, verbatim>"' : ''}
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
}- Return JSON only. No commentary.`
}
