/**
 * Workers AI extraction adapter.
 *
 * Design reference: §8.3 (the contract), §8.5 (external dependency), D29.
 *
 * The only place in the system that knows a vendor exists. Nothing above this
 * file names a model, a prompt, or a response shape — which is what makes the
 * on-premise substitution in §15.2 an adapter swap rather than a redesign.
 *
 * It receives an `ExtractionRequest`, which structurally cannot carry
 * application data (CT-10). This adapter therefore cannot leak expected values
 * into a prompt even by accident: it has none to leak.
 */

import {
  ExtractionContractError,
  type ExtractionProvider,
  type ExtractionRequest,
  type ExtractionResult,
  parseExtractionResponse,
} from '../domain/extraction.js'
import { FIELD_LABELS } from '../domain/types.js'

/**
 * Bumped whenever the instruction below changes.
 *
 * Recorded per extraction (§8.7.1): a verdict is only re-derivable if the
 * prompt that produced its reading is identifiable.
 */
export const PROMPT_VERSION = 'label-extract@1'

/** Greedy. Narrows variance without pretending to achieve determinism (§8.7.2). */
const SAMPLING = { temperature: 0, max_tokens: 1024 } as const

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

/**
 * The model's answer, wherever the envelope puts it.
 *
 * Workers AI returns an OpenAI-shaped completion, and `response` is not always
 * a string: when the answer is well-formed JSON it arrives already parsed.
 * Reading only strings discarded a perfect extraction and reported it as an
 * empty response — so the better the model read the label, the more reliably
 * its answer was thrown away.
 *
 * Order matters. `response` is the provider's own summary of the completion and
 * is preferred; `choices[0].message.content` is the underlying field and serves
 * as the fallback. An envelope carrying neither is genuinely empty and is
 * reported as such, rather than being papered over.
 */
function answerText(envelope: unknown): string {
  if (typeof envelope !== 'object' || envelope === null) return ''
  const record = envelope as Record<string, unknown>

  const response = record.response
  if (typeof response === 'string') return response
  // Already parsed. Re-serialised so it runs through the same salvage and
  // contract path as every other answer, rather than a second parallel one.
  if (typeof response === 'object' && response !== null) return JSON.stringify(response)

  const choices = record.choices
  if (Array.isArray(choices)) {
    const first = choices[0]
    if (typeof first === 'object' && first !== null) {
      const message = (first as Record<string, unknown>).message
      if (typeof message === 'object' && message !== null) {
        const content = (message as Record<string, unknown>).content
        if (typeof content === 'string') return content
      }
    }
  }

  return ''
}

/** Pull a JSON object out of a model response that may be fenced or prefixed. */
function extractJson(text: string): unknown {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fenced?.[1]?.trim() ?? trimmed

  try {
    return JSON.parse(candidate)
  } catch {
    // A model may wrap the object in prose. One salvage attempt, then fail —
    // parsing defensively past this point would turn a broken response into a
    // compliance finding (§8.3).
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1))
      } catch {
        /* fall through */
      }
    }
    throw new ExtractionContractError('response was not valid JSON')
  }
}

export interface WorkersAiOptions {
  readonly ai: Ai
  /** Fully qualified. Validated by the caller at startup (D29). */
  readonly modelId: string
  /** Injected so tests are deterministic (test-plan §17). */
  readonly now?: () => number
}

/** Base64 in chunks, so a 300 DPI crop cannot overflow the call stack. */
function toBase64(buffer: ArrayBuffer): string {
  const view = new Uint8Array(buffer)
  const CHUNK = 0x8000
  let binary = ''
  for (let i = 0; i < view.length; i += CHUNK) {
    binary += String.fromCharCode(...view.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

export function createWorkersAiProvider(opts: WorkersAiOptions): ExtractionProvider {
  const now = opts.now ?? (() => Date.now())

  return {
    name: 'workers-ai',

    async extract(request: ExtractionRequest): Promise<ExtractionResult> {
      const started = now()

      // The image travels inside the message, as a content part.
      //
      // A sibling `image` property — the documented shape for Llama 3.2 Vision
      // — is accepted and silently ignored by this model. It does not error:
      // it answers from the prompt alone, which under a required JSON schema
      // means it invents a value. /health/vision measures all three shapes
      // against a crop whose brand name is known, and only this one can read it.
      const dataUri = `data:${request.mimeType};base64,${toBase64(request.image)}`
      const response = (await opts.ai.run(
        opts.modelId as keyof AiModels,
        {
          ...SAMPLING,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: buildPrompt(request) },
                { type: 'image_url', image_url: { url: dataUri } },
              ],
            },
          ],
        } as never,
      )) as unknown

      const latencyMs = now() - started
      const raw = answerText(response)
      if (raw.trim() === '') {
        throw new ExtractionContractError('provider returned an empty response')
      }

      const extraction = parseExtractionResponse(extractJson(raw), {
        fields: request.fields,
        includeWarning: request.includeWarning,
      })

      return {
        extraction,
        rawResponse: raw,
        provenance: {
          provider: 'workers-ai',
          modelId: opts.modelId,
          promptVersion: PROMPT_VERSION,
          samplingParameters: { ...SAMPLING },
          latencyMs,
        },
      }
    },
  }
}
