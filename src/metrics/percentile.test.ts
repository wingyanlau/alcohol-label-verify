/**
 * The arithmetic behind the one number this system is held to.
 *
 * §16 states S1 as p95 ≤ 5 seconds. Every failure mode below produces a
 * *better-looking* figure than the truth, which is why they are worth pinning:
 * a metric that flatters is one nobody re-checks.
 */

import { describe, expect, it } from 'vitest'
import { meets, percentile, summarise } from './percentile.js'

describe('percentile', () => {
  it('returns a value that actually occurred', () => {
    // Nearest-rank, not interpolated. An interpolated p95 is a duration no
    // submission ever took, which is a strange thing to hold a system to.
    const values = [100, 200, 300, 400]
    expect(values).toContain(percentile(values, 95))
  })

  it('puts p50 at the middle and p100 at the worst', () => {
    const values = [10, 20, 30, 40, 50]
    expect(percentile(values, 50)).toBe(30)
    expect(percentile(values, 100)).toBe(50)
  })

  it('does not depend on the order it was handed', () => {
    expect(percentile([500, 100, 300, 200, 400], 95)).toBe(500)
  })

  it('takes the worst of a small sample rather than a comfortable middle', () => {
    // Four readings and a p95: the answer must be the slowest, not the third.
    // Rounding the rank down here is what would let one slow read hide.
    expect(percentile([1000, 2000, 3000, 9000], 95)).toBe(9000)
  })

  it('has no answer for an empty sample', () => {
    // Not zero. Zero is the best possible latency, and an empty column
    // reporting it would show a system passing its target having done nothing.
    expect(percentile([], 95)).toBeNull()
  })
})

describe('summarise', () => {
  it('reports the sample size alongside the figures', () => {
    // So a p95 drawn from four readings is visibly drawn from four readings.
    expect(summarise([1, 2, 3, 4])).toEqual({ count: 4, p50: 2, p95: 4, max: 4 })
  })

  it('says nothing rather than zero when there is nothing', () => {
    expect(summarise([])).toEqual({ count: 0, p50: null, p95: null, max: null })
  })
})

describe('meets the stated target', () => {
  it('judges against p95, not the average', () => {
    // An average passes while a quarter of submissions are slow, which is what
    // a percentile target exists to prevent.
    expect(meets(summarise([100, 100, 100, 100, 20_000]), 5000)).toBe(false)
  })

  it('accepts a distribution inside the target', () => {
    expect(meets(summarise([1000, 2000, 3000]), 5000)).toBe(true)
  })

  it('is undecided on an empty sample rather than passing it', () => {
    // The failure this guards: a fresh deployment showing "meets S1" before it
    // has checked a single label.
    expect(meets(summarise([]), 5000)).toBeNull()
  })

  it('treats the boundary as met', () => {
    // "≤ 5s" as written in §16, not "< 5s".
    expect(meets(summarise([5000]), 5000)).toBe(true)
  })
})
