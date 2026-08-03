import { describe, expect, it } from 'vitest'
import { gatewayBaseUrl, gatewayFrom, gatewayHeaders } from './gateway.js'

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

  // AI Gateway stores request and response bodies by default, and this
  // system's are a label image and the values read from it — content, which
  // logs must never carry (D20). Metrics are kept either way.
  it('withholds payloads from the gateway log unless explicitly allowed', () => {
    const g = gatewayFrom({ AI_GATEWAY_ID: 'g' })
    expect(g?.logPayloads).toBe(false)
    expect(gatewayHeaders(g)['cf-aig-collect-log-payload']).toBe('false')

    const debugging = gatewayFrom({ AI_GATEWAY_ID: 'g', AI_GATEWAY_LOG_PAYLOADS: 'true' })
    expect(gatewayHeaders(debugging)['cf-aig-collect-log-payload']).toBe('true')
  })

  it('adds no headers when there is no gateway', () => {
    expect(gatewayHeaders(null)).toEqual({})
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
