import { describe, expect, it } from 'vitest'
import { MAX_ATTEMPTS, retryDelaySeconds } from './backoff.js'

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
