import { describe, expect, it } from 'vitest'
import { isQuotaExhausted, isRateLimited, MAX_ATTEMPTS, retryDelaySeconds } from './backoff.js'

describe('rate-limit backoff', () => {
  // 5s, then 10s, then 15s — each attempt waits longer than the last, so a
  // ceiling measured over time is eventually cleared rather than hammered.
  it('escalates linearly with the attempt number', () => {
    expect(retryDelaySeconds(1)).toBe(5)
    expect(retryDelaySeconds(2)).toBe(10)
    expect(retryDelaySeconds(3)).toBe(15)
    expect(retryDelaySeconds(4)).toBe(20)
  })

  // Browser Rendering admits one new browser every 20 seconds on this account,
  // so the schedule has to reach past 20 to be able to succeed at all.
  it('reaches the observed 20 second ceiling within the attempt budget', () => {
    expect(retryDelaySeconds(MAX_ATTEMPTS)).toBeGreaterThanOrEqual(20)
  })

  it('never returns a delay below the first step', () => {
    expect(retryDelaySeconds(0)).toBe(5)
    expect(retryDelaySeconds(-1)).toBe(5)
  })
})

describe('recognising an exhausted allowance', () => {
  // Workers AI reports 4006 when the day's neuron allocation is spent. Unlike
  // a rate limit it does not clear by waiting: nothing the batch can do will
  // restore it before tomorrow, so continuing costs 25 more failures and
  // teaches a reviewer that the tool is broken rather than out of budget.
  it('recognises the exhaustion the account actually reported', () => {
    const real = new Error(
      '4006: you have used up your daily free allocation of 10,000 neurons, please upgrade ' +
        "to Cloudflare's Workers Paid plan if you would like to continue usage.",
    )
    expect(isQuotaExhausted(real)).toBe(true)
  })

  it('recognises the code and the wording independently', () => {
    expect(isQuotaExhausted(new Error('error 4006'))).toBe(true)
    expect(isQuotaExhausted(new Error('used up your daily free allocation'))).toBe(true)
    expect(isQuotaExhausted(new Error('neurons exhausted for today'))).toBe(true)
  })

  // A rate limit clears; an allowance does not. Confusing them would either
  // abandon a batch that only needed to wait, or spend the whole queue
  // discovering the same dead end 26 times.
  it('is not a rate limit, and a rate limit is not it', () => {
    const rate = new Error('Unable to create new browser: code: 429: message: Rate limit exceeded')
    expect(isQuotaExhausted(rate)).toBe(false)
    expect(isRateLimited(rate)).toBe(true)

    const quota = new Error('4006: daily free allocation of 10,000 neurons')
    expect(isRateLimited(quota)).toBe(false)
  })

  it('does not fire on an unrelated fault', () => {
    expect(isQuotaExhausted(new Error('provider returned an empty response'))).toBe(false)
    expect(isQuotaExhausted(null)).toBe(false)
  })
})

describe('recognising a rate limit', () => {
  // The provider reports it as a 429 inside the launch failure message, which
  // is the only place it appears — there is no typed error to match on.
  it('recognises the launch failure the corpus actually produced', () => {
    const real = new Error('Unable to create new browser: code: 429: message: Rate limit exceeded')
    expect(isRateLimited(real)).toBe(true)
  })

  it('recognises a bare 429 and a worded rate limit', () => {
    expect(isRateLimited(new Error('429 Too Many Requests'))).toBe(true)
    expect(isRateLimited(new Error('rate limit exceeded'))).toBe(true)
  })

  // A backoff applied to the wrong failure wastes the attempt budget on
  // something that will never succeed.
  it('does not mistake an unrelated fault for a rate limit', () => {
    expect(isRateLimited(new Error('provider returned an empty response'))).toBe(false)
    expect(isRateLimited(new Error('this does not appear to be a form I recognise'))).toBe(false)
  })

  it('tolerates a non-Error being thrown', () => {
    expect(isRateLimited('429 Rate limit exceeded')).toBe(true)
    expect(isRateLimited(null)).toBe(false)
  })
})
