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
}

/** Settings from the environment, or null when the gateway is not configured. */
export function gatewayFrom(env: {
  AI_GATEWAY_ID?: string
  AI_GATEWAY_ACCOUNT?: string
  AI_GATEWAY_CACHE_TTL?: string
}): GatewaySettings | null {
  const id = (env.AI_GATEWAY_ID ?? '').trim()
  if (id === '') return null

  const ttl = Number(env.AI_GATEWAY_CACHE_TTL ?? '0')
  return {
    id,
    accountId: (env.AI_GATEWAY_ACCOUNT ?? '').trim(),
    cacheTtlSeconds: Number.isFinite(ttl) && ttl > 0 ? Math.floor(ttl) : 0,
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
