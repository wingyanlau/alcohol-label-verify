import { describe, expect, it } from 'vitest'
import { gatewayBaseUrl, gatewayFrom } from './gateway.js'

describe('gateway configuration', () => {
  it('is absent unless an id is set, so nothing changes by default', () => {
    expect(gatewayFrom({})).toBeNull()
    expect(gatewayFrom({ AI_GATEWAY_ID: '   ' })).toBeNull()
  })

  // Caching would make a repeated corpus run nearly free, which is precisely
  // why it is opt-in: a run served from cache measures the cache, not the
  // model, and B-Q4 asks which model reads a 4.5pt warning best.
  it('does not cache unless asked', () => {
    expect(gatewayFrom({ AI_GATEWAY_ID: 'g' })?.cacheTtlSeconds).toBe(0)
    expect(
      gatewayFrom({ AI_GATEWAY_ID: 'g', AI_GATEWAY_CACHE_TTL: 'nonsense' })?.cacheTtlSeconds,
    ).toBe(0)
    expect(gatewayFrom({ AI_GATEWAY_ID: 'g', AI_GATEWAY_CACHE_TTL: '-5' })?.cacheTtlSeconds).toBe(0)
    expect(gatewayFrom({ AI_GATEWAY_ID: 'g', AI_GATEWAY_CACHE_TTL: '3600' })?.cacheTtlSeconds).toBe(
      3600,
    )
  })

  it('addresses a provider through the account and gateway', () => {
    const g = gatewayFrom({ AI_GATEWAY_ID: 'label-verify', AI_GATEWAY_ACCOUNT: 'acct123' })
    expect(gatewayBaseUrl(g, 'google-ai-studio')).toBe(
      'https://gateway.ai.cloudflare.com/v1/acct123/label-verify/google-ai-studio',
    )
  })

  // A URL missing the account would 404 every request. Falling back to the
  // vendor directly keeps a half-configured gateway from taking the service
  // down, which is the opposite of what an observability layer is for.
  it('declines to build a URL it cannot address', () => {
    expect(gatewayBaseUrl(gatewayFrom({ AI_GATEWAY_ID: 'g' }), 'google-ai-studio')).toBeNull()
    expect(gatewayBaseUrl(null, 'google-ai-studio')).toBeNull()
  })
})
