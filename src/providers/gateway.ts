/**
 * AI Gateway.
 *
 * A proxy in front of whichever provider is configured, giving per-request
 * analytics, caching and rate-limit control across vendors. It exists here for
 * a reason discovered the hard way: a day's inference allowance was spent
 * without anyone being able to say on what, because usage was visible only as
 * "it worked" or "429".
 *
 * Configuration, not code. Absent settings mean the providers talk to their
 * vendors directly, exactly as before, so this cannot break a deployment that
 * has not opted in.
 */

export interface GatewaySettings {
  /** The gateway's name in the Cloudflare account. */
  readonly id: string
  /** Needed only to build a URL for an external provider. */
  readonly accountId: string
  /**
   * Seconds to cache an identical request, or 0 to disable.
   *
   * Zero by default, deliberately. Caching would make a repeated corpus run
   * nearly free, which is exactly why it must be opted into: a run served from
   * cache measures the cache, not the model, and B-Q4 asks which model reads a
   * 4.5pt warning best. Turn it on for a demonstration; leave it off for a
   * measurement.
   */
  readonly cacheTtlSeconds: number

  /**
   * Whether the gateway may store request and response bodies.
   *
   * False by default, and that is a policy decision rather than a preference.
   * AI Gateway stores payloads by default, and this system's payloads are a
   * base64 label image on the way out and the values read from it on the way
   * back — content, which logs must never carry (D20, §9.3). Metrics, token
   * counts, latency and errors are all retained either way; only the artwork
   * and the readings are withheld.
   *
   * Worth enabling against the synthetic corpus when debugging an adapter,
   * because nothing there belongs to an applicant. Never against real
   * submissions.
   */
  readonly logPayloads: boolean

  /**
   * Token for an authenticated gateway, when one is required.
   *
   * A gateway with authentication turned on refuses an unauthenticated request
   * with its own 401 — `AiGatewayError`, code 2009 — which is distinguishable
   * from the vendor's errors because the envelope is Cloudflare's rather than
   * Google's. Empty means the gateway is open.
   */
  readonly token: string
}

/** Settings from the environment, or null when the gateway is not configured. */
export function gatewayFrom(env: {
  AI_GATEWAY_ID?: string
  AI_GATEWAY_ACCOUNT?: string
  AI_GATEWAY_CACHE_TTL?: string
  AI_GATEWAY_LOG_PAYLOADS?: string
  AI_GATEWAY_TOKEN?: string
}): GatewaySettings | null {
  const id = (env.AI_GATEWAY_ID ?? '').trim()
  if (id === '') return null

  const ttl = Number(env.AI_GATEWAY_CACHE_TTL ?? '0')
  return {
    id,
    accountId: (env.AI_GATEWAY_ACCOUNT ?? '').trim(),
    cacheTtlSeconds: Number.isFinite(ttl) && ttl > 0 ? Math.floor(ttl) : 0,
    logPayloads: (env.AI_GATEWAY_LOG_PAYLOADS ?? '').trim().toLowerCase() === 'true',
    token: (env.AI_GATEWAY_TOKEN ?? '').trim(),
  }
}

/**
 * Headers that tell the gateway how to treat a request.
 *
 * Empty when the gateway is not configured, so an adapter can spread them
 * unconditionally.
 */
export function gatewayHeaders(gateway: GatewaySettings | null): Record<string, string> {
  if (gateway === null) return {}
  return {
    // Explicit in both directions: the default is to store payloads, so
    // silence here would mean label content persisted to a third-party log.
    'cf-aig-collect-log-payload': gateway.logPayloads ? 'true' : 'false',
    ...(gateway.token === '' ? {} : { 'cf-aig-authorization': `Bearer ${gateway.token}` }),
  }
}

/**
 * The base URL an external provider should call instead of its own.
 *
 * Null when the gateway cannot be addressed — no account id — so a
 * half-configured gateway falls back to talking directly rather than
 * constructing a URL that would 404 every request.
 */
export function gatewayBaseUrl(gateway: GatewaySettings | null, provider: string): string | null {
  if (gateway === null || gateway.accountId === '') return null
  return `https://gateway.ai.cloudflare.com/v1/${gateway.accountId}/${gateway.id}/${provider}`
}
