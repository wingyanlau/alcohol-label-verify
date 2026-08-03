/**
 * Workers AI extraction adapter.
 *
 * Design reference: §8.3 (the contract), §8.5 (external dependency), D29.
 *
 * One of two places in the system that knows Cloudflare exists — the other
 * being the bindings themselves. Nothing above this file names a model, a
 * request shape, or an error code, which is what makes the on-premise
 * substitution in §15.2 an adapter swap rather than a redesign.
 *
 * It receives an `ExtractionRequest`, which structurally cannot carry
 * application data (CT-10). This adapter therefore cannot leak expected values
 * into a prompt even by accident: it has none to leak.
 */

import {
  ExtractionContractError,
  type ExtractionRequest,
  type ExtractionResult,
  parseExtractionResponse,
} from '../domain/extraction.js'
import { toBase64 } from './base64.js'
import type { GatewaySettings } from './gateway.js'
import { extractJson } from './json.js'
import { buildPrompt, PROMPT_VERSION } from './prompt.js'
import { type FaultKind, messageOf, type Provider, type ProviderSpec } from './types.js'

/** Greedy. Narrows variance without pretending to achieve determinism (§8.7.2). */
const SAMPLING = { temperature: 0, max_tokens: 1024 } as const

/**
 * Cloudflare's vocabulary, kept where Cloudflare is understood.
 *
 * 4006 is an exhausted daily neuron allocation, and it is deliberately
 * exclusive with a rate limit: one clears by waiting, the other does not clear
 * before tomorrow. Confusing them either abandons a batch that only needed to
 * wait, or spends the whole queue rediscovering the same dead end — both of
 * which happened before this distinction existed.
 */
export const WORKERS_AI_SPEC: ProviderSpec = {
  name: 'workers-ai',

  // The binding carries authentication, so no credential is configured — which
  // is why /health does not report this deployment as broken for lacking one.
  requiresCredential: false,

  isFloatingModelId(modelId: string): boolean {
    const id = modelId.trim().toLowerCase()
    return ['latest', 'preview', 'stable', 'current'].some((s) => id.endsWith(`-${s}`))
  },

  classify(error: unknown): FaultKind {
    const message = messageOf(error)
    if (
      /\b4006\b/.test(message) ||
      /daily free allocation/i.test(message) ||
      /neurons?\b[^.]*\bexhaust/i.test(message)
    ) {
      return 'quota-exhausted'
    }
    if (/\b429\b/.test(message) || /rate limit/i.test(message)) return 'rate-limited'
    return 'transient'
  },
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

export interface WorkersAiOptions {
  readonly ai: Ai
  /** Fully qualified. Validated by the caller at startup (D29). */
  readonly modelId: string
  /** Routes through AI Gateway when configured. Absent means talk directly. */
  readonly gateway?: GatewaySettings
  /** Injected so tests are deterministic (test-plan §17). */
  readonly now?: () => number
}

export function createWorkersAiProvider(opts: WorkersAiOptions): Provider {
  const now = opts.now ?? (() => Date.now())

  // Undefined rather than an empty object when unconfigured: the binding
  // treats a present `gateway` as a routing instruction.
  const routing = opts.gateway
    ? {
        gateway: {
          id: opts.gateway.id,
          skipCache: opts.gateway.cacheTtlSeconds === 0,
          cacheTtl: opts.gateway.cacheTtlSeconds,
        },
      }
    : undefined

  return {
    name: WORKERS_AI_SPEC.name,
    spec: WORKERS_AI_SPEC,

    async ping(): Promise<void> {
      const out = (await opts.ai.run(
        opts.modelId as keyof AiModels,
        {
          messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
          max_tokens: 8,
        } as never,
      )) as unknown
      if (answerText(out).trim() === '') {
        throw new Error('the model returned nothing to a trivial prompt')
      }
    },

    async extract(request: ExtractionRequest): Promise<ExtractionResult> {
      const started = now()

      // The image travels inside the message, as a content part.
      //
      // A sibling `image` property — the documented shape for Llama 3.2 Vision
      // — is accepted and silently ignored by this model. It does not error:
      // it answers from the prompt alone, which under a required JSON schema
      // means it invents a value.
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
        routing as never,
      )) as unknown

      const latencyMs = now() - started
      const served =
        typeof response === 'object' && response !== null
          ? (response as Record<string, unknown>).model
          : undefined
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
          provider: WORKERS_AI_SPEC.name,
          modelId: opts.modelId,
          ...(typeof served === 'string' ? { servedModelVersion: served } : {}),
          promptVersion: PROMPT_VERSION,
          samplingParameters: { ...SAMPLING },
          latencyMs,
        },
      }
    },
  }
}

// Re-exported so existing callers and tests keep one import site while the
// prompt itself lives where both adapters can share it.
export { buildPrompt, PROMPT_VERSION } from './prompt.js'
