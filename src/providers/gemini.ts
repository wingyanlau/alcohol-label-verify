/**
 * Gemini extraction adapter.
 *
 * Design reference: §8.3 (the contract), §8.5 (external dependency), D29.
 *
 * The second reader, and the point of having a seam at all. It uses the SAME
 * instruction as the Workers AI adapter — same text, same PROMPT_VERSION
 * lineage, same free-text JSON answer — so a corpus run under each provider
 * differs in exactly one variable: who is reading. That is what makes B-Q4
 * ("which model reads a 4.5pt warning statement best") a measurement rather
 * than an opinion.
 *
 * Gemini can enforce a response schema server-side, and that is deliberately
 * not used. A hard schema increases the pressure to fill every slot, which is
 * §8.3.2's fabrication risk — observed live, when a model with no image
 * invented "Old Forester" for a label reading "Old Tom Distillery". It would
 * also confound the comparison, since the two providers would be answering
 * under different constraints.
 *
 * Like its sibling it receives an `ExtractionRequest`, which structurally
 * cannot carry application data (CT-10): it has no expected values to leak.
 */

import {
  ExtractionContractError,
  type ExtractionRequest,
  type ExtractionResult,
  parseExtractionResponse,
} from '../domain/extraction.js'
import { toBase64 } from './base64.js'
import { extractJson } from './json.js'
import { buildPrompt, PROMPT_VERSION } from './prompt.js'
import { type FaultKind, messageOf, type Provider, type ProviderSpec } from './types.js'

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'

/** Greedy, and the same budget the sibling adapter uses (§8.7.2). */
const SAMPLING = { temperature: 0, maxOutputTokens: 1024 } as const

/**
 * Google's vocabulary, kept where Google is understood.
 *
 * The awkward part is that Gemini reports both a per-minute rate limit and an
 * exhausted daily quota as RESOURCE_EXHAUSTED / 429. They demand opposite
 * responses — one clears by waiting, the other does not clear today — so the
 * wording is the only discriminator available, and it is read conservatively:
 * only an explicitly daily or billing-shaped message abandons the job. A
 * mistaken 'rate-limited' costs a few minutes of futile waiting; a mistaken
 * 'quota-exhausted' abandons a batch that would have succeeded.
 */
export const GEMINI_SPEC: ProviderSpec = {
  name: 'gemini',

  // An external API over HTTPS: the credential is a real secret, and /health
  // will report the deployment misconfigured without it.
  requiresCredential: true,

  /**
   * D29, as strictly as Google's naming permits — and that is less strictly
   * than it permits for Cloudflare, which is worth recording rather than
   * hiding.
   *
   * The first version of this demanded a `-NNN` suffix, on the reasoning that
   * `gemini-2.5-flash` must be a moving alias. It is not one in the sense that
   * matters: Google publishes stable names as the durable identifier and
   * retired numbered pins after the 1.5/2.0 families. Requiring `-NNN` rejected
   * every current model — the service refused `gemini-2.5-flash-002` because
   * that id does not exist, which the API confirmed with a 404.
   *
   * So what is refused is what genuinely moves: `-latest`, anything marked
   * preview or experimental, and dated snapshots. A stable name is the
   * strongest pin on offer here. It is weaker than a Cloudflare model id, and
   * an audit record citing one is correspondingly weaker — a fact for the
   * record, not something a regular expression can fix.
   */
  isFloatingModelId(modelId: string): boolean {
    const id = modelId.trim().toLowerCase()
    return (
      ['latest', 'stable', 'current'].some((s) => id.endsWith(`-${s}`)) ||
      /-(?:preview|exp)\b/.test(id) ||
      /-\d{2}-\d{2}$/.test(id)
    )
  },

  classify(error: unknown): FaultKind {
    const message = messageOf(error)

    if (/\b(?:400|401|403|404)\b/.test(message) || /API_KEY|PERMISSION_DENIED/i.test(message)) {
      return 'permanent'
    }
    if (/RESOURCE_EXHAUSTED/i.test(message) || /\b429\b/.test(message)) {
      const daily = /per day|daily|quota exceeded|billing|free tier/i.test(message)
      return daily ? 'quota-exhausted' : 'rate-limited'
    }
    return 'transient'
  },
}

export interface GeminiOptions {
  /** Set with `wrangler secret put MODEL_API_KEY`. Never in configuration. */
  readonly apiKey: string
  /** Fully qualified. Validated by the caller at startup (D29). */
  readonly modelId: string
  /** Injected so tests are deterministic (test-plan §17). */
  readonly now?: () => number
  /** Injected so tests never reach the network. */
  readonly fetchImpl?: typeof fetch
}

/**
 * The answer, or an explanation of why there is not one.
 *
 * Gemini returns no text for several distinct reasons, and collapsing them into
 * "empty response" is precisely the mistake that cost three rounds of debugging
 * against Workers AI: an inference reported as an observation. A safety block, a
 * truncated completion and a genuinely empty candidate each say so here.
 */
function answerText(envelope: unknown): string {
  if (typeof envelope !== 'object' || envelope === null) {
    throw new ExtractionContractError('provider returned no response body')
  }
  const record = envelope as Record<string, unknown>

  const feedback = record.promptFeedback
  if (typeof feedback === 'object' && feedback !== null) {
    const blockReason = (feedback as Record<string, unknown>).blockReason
    if (typeof blockReason === 'string' && blockReason !== '') {
      throw new ExtractionContractError(`the prompt was blocked (${blockReason})`)
    }
  }

  const candidates = record.candidates
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new ExtractionContractError('provider returned no candidates')
  }

  const candidate = candidates[0] as Record<string, unknown>
  const finishReason = typeof candidate.finishReason === 'string' ? candidate.finishReason : ''
  if (finishReason === 'SAFETY' || finishReason === 'PROHIBITED_CONTENT') {
    throw new ExtractionContractError(`the answer was withheld (${finishReason})`)
  }

  const content = candidate.content
  const parts =
    typeof content === 'object' && content !== null
      ? (content as Record<string, unknown>).parts
      : undefined

  const text = Array.isArray(parts)
    ? parts
        .map((part) =>
          typeof part === 'object' && part !== null
            ? (part as Record<string, unknown>).text
            : undefined,
        )
        .filter((t): t is string => typeof t === 'string')
        .join('')
    : ''

  if (text.trim() === '') {
    // MAX_TOKENS with no text is a budget problem, not a model failure, and
    // saying which saves someone hunting the wrong thing.
    if (finishReason === 'MAX_TOKENS') {
      throw new ExtractionContractError('the answer was truncated before any text was produced')
    }
    throw new ExtractionContractError('provider returned an empty response')
  }

  return text
}

export function createGeminiProvider(opts: GeminiOptions): Provider {
  const now = opts.now ?? (() => Date.now())
  const doFetch = opts.fetchImpl ?? fetch

  return {
    name: GEMINI_SPEC.name,
    spec: GEMINI_SPEC,

    async ping(): Promise<void> {
      const response = await doFetch(
        `${ENDPOINT}/${encodeURIComponent(opts.modelId)}:generateContent`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': opts.apiKey },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: 'Reply with the single word: ready' }] }],
            generationConfig: { temperature: 0, maxOutputTokens: 8 },
          }),
        },
      )
      if (!response.ok) {
        const detail = (await response.text().catch(() => '')).slice(0, 300)
        throw new Error(`provider returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`)
      }
      answerText(await response.json())
    },

    async extract(request: ExtractionRequest): Promise<ExtractionResult> {
      const started = now()

      const response = await doFetch(
        `${ENDPOINT}/${encodeURIComponent(opts.modelId)}:generateContent`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            // Header rather than a query parameter, so the credential cannot
            // be captured by anything that logs a URL (§9.3, D20).
            'x-goog-api-key': opts.apiKey,
          },
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [
                  { text: buildPrompt(request) },
                  { inline_data: { mime_type: request.mimeType, data: toBase64(request.image) } },
                ],
              },
            ],
            generationConfig: SAMPLING,
          }),
        },
      )

      if (!response.ok) {
        // The status is carried in the message because it is what `classify`
        // reads: a 429 waits, a 403 never will.
        const detail = (await response.text().catch(() => '')).slice(0, 300)
        throw new ExtractionContractError(
          `provider returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
        )
      }

      const raw = answerText(await response.json())
      const latencyMs = now() - started

      const extraction = parseExtractionResponse(extractJson(raw), {
        fields: request.fields,
        includeWarning: request.includeWarning,
      })

      return {
        extraction,
        rawResponse: raw,
        provenance: {
          provider: GEMINI_SPEC.name,
          modelId: opts.modelId,
          promptVersion: PROMPT_VERSION,
          samplingParameters: { ...SAMPLING },
          latencyMs,
        },
      }
    },
  }
}
