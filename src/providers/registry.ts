/**
 * Choosing a reader.
 *
 * The single place that maps `MODEL_PROVIDER` to an implementation. Before
 * this, `pipeline.ts` constructed the Workers AI adapter by name, so the
 * "swappable provider" the design describes was swappable only by editing the
 * item worker.
 *
 * Specs are separated from instances deliberately: configuration validation
 * runs at the first request, before any binding or credential is known to be
 * present, and it needs to know whether a credential is *required* precisely
 * when one may be missing.
 */

import { gatewayBaseUrl, gatewayFrom, gatewayHeaders } from './gateway.js'
import { createGeminiProvider, GEMINI_SPEC } from './gemini.js'
import type { Provider, ProviderSpec } from './types.js'
import { createWorkersAiProvider, WORKERS_AI_SPEC } from './workers-ai.js'

/** Everything the deployment can be pointed at. */
export const PROVIDER_SPECS: readonly ProviderSpec[] = [WORKERS_AI_SPEC, GEMINI_SPEC]

export function specFor(name: string): ProviderSpec | null {
  const wanted = name.trim().toLowerCase()
  return PROVIDER_SPECS.find((s) => s.name === wanted) ?? null
}

/** The names a deployment may choose between, for an error message worth reading. */
export function knownProviderNames(): string {
  return PROVIDER_SPECS.map((s) => s.name).join(', ')
}

export interface ProviderEnv {
  readonly MODEL_PROVIDER: string
  readonly MODEL_ID: string
  readonly MODEL_API_KEY?: string
  readonly AI?: Ai
  /** AI Gateway, when configured. Absent means talk to the vendor directly. */
  readonly AI_GATEWAY_ID?: string
  readonly AI_GATEWAY_ACCOUNT?: string
  readonly AI_GATEWAY_CACHE_TTL?: string
}

/**
 * Build the configured provider.
 *
 * Throws rather than falling back to a default. A deployment that names a
 * provider it cannot construct is misconfigured, and quietly reading labels
 * with a different model than the one the audit record will cite is worse than
 * not reading them at all (D29).
 */
export function createProvider(env: ProviderEnv, fetchImpl?: typeof fetch): Provider {
  const name = (env.MODEL_PROVIDER ?? '').trim().toLowerCase()
  const gateway = gatewayFrom(env)

  switch (name) {
    case WORKERS_AI_SPEC.name: {
      if (!env.AI) throw new Error('MODEL_PROVIDER is "workers-ai" but no AI binding is attached')
      return createWorkersAiProvider(
        gateway
          ? { ai: env.AI, modelId: env.MODEL_ID, gateway }
          : { ai: env.AI, modelId: env.MODEL_ID },
      )
    }
    case GEMINI_SPEC.name: {
      const apiKey = env.MODEL_API_KEY ?? ''
      if (apiKey === '') {
        throw new Error(
          'MODEL_PROVIDER is "gemini" but MODEL_API_KEY is not set — ' +
            'set it with `wrangler secret put MODEL_API_KEY`',
        )
      }
      // Google AI Studio keeps its own request and response schema behind the
      // gateway, so only the destination changes.
      const baseUrl = gatewayBaseUrl(gateway, 'google-ai-studio')
      const extraHeaders = gatewayHeaders(gateway)
      return createGeminiProvider({
        apiKey,
        modelId: env.MODEL_ID,
        ...(baseUrl ? { baseUrl, extraHeaders } : {}),
        ...(fetchImpl ? { fetchImpl } : {}),
      })
    }
    default:
      throw new Error(`unknown MODEL_PROVIDER "${name}" — known providers: ${knownProviderNames()}`)
  }
}
