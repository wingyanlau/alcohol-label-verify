/**
 * Reading token usage off a vendor envelope.
 *
 * The whole point of these counts is that somebody can say what an allowance
 * was spent on. That makes a *wrong* count worse than no count: a cost report
 * with a plausible number in it does not get checked, and a bill that
 * disagrees with it gets blamed on the vendor.
 *
 * So absence travels as absence here, and anything unintelligible is treated as
 * absence rather than coerced into a figure.
 */

import { describe, expect, it } from 'vitest'
import { usageFrom } from './usage.js'

describe('token usage, as vendors report it', () => {
  it('reads the OpenAI shape Workers AI follows', () => {
    expect(
      usageFrom({ usage: { prompt_tokens: 1200, completion_tokens: 64, total_tokens: 1264 } }),
    ).toEqual({ promptTokens: 1200, completionTokens: 64, totalTokens: 1264 })
  })

  it('finds it inside the result envelope too', () => {
    // Workers AI wraps its answer in `result`; whether the caller has unwrapped
    // it by the time this is asked is an adapter detail, not a vendor one.
    expect(
      usageFrom({
        result: { usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } },
      }),
    ).toEqual({ promptTokens: 10, completionTokens: 2, totalTokens: 12 })
  })

  it("reads Gemini's shape, where the output count has another name", () => {
    expect(
      usageFrom({
        usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 40, totalTokenCount: 990 },
      }),
    ).toEqual({ promptTokens: 900, completionTokens: 40, totalTokens: 990 })
  })

  it("keeps the vendor's own total even when it exceeds the parts", () => {
    // Gemini counts thinking tokens separately, so the total is not always the
    // sum. The total is the number a bill is drawn from; recomputing it here
    // would produce a tidier figure that nobody is charged.
    expect(
      usageFrom({
        usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 40, totalTokenCount: 1500 },
      })?.totalTokens,
    ).toBe(1500)
  })

  it('derives a total only from two counts it was actually given', () => {
    expect(usageFrom({ usage: { prompt_tokens: 100, completion_tokens: 20 } })?.totalTokens).toBe(
      120,
    )
    // One count is not a total. Reporting 100 here would describe a read whose
    // output was never counted as if it had been measured in full.
    expect(usageFrom({ usage: { prompt_tokens: 100 } })?.totalTokens).toBeNull()
  })

  it('reports nothing when the vendor reported nothing', () => {
    // Null, never zero. A zero is a claim that the read was free, and a column
    // of invented zeroes sums to a number that looks like a measurement.
    expect(usageFrom({ choices: [] })).toBeNull()
    expect(usageFrom({ usage: {} })).toBeNull()
    expect(usageFrom({ usageMetadata: {} })).toBeNull()
    expect(usageFrom(null)).toBeNull()
    expect(usageFrom('usage: lots')).toBeNull()
  })

  it('refuses a count it cannot interpret rather than coercing it', () => {
    // A string, a negative, a NaN: each is the vendor saying something this
    // does not understand, and a wrong number in a cost report is worse than a
    // gap in one.
    const bad = usageFrom({
      usage: { prompt_tokens: '1200', completion_tokens: -4, total_tokens: Number.NaN },
    })
    expect(bad).toBeNull()
  })

  it('keeps the counts it understands when one of them is malformed', () => {
    // Partial is still evidence. Dropping the whole reading because one field
    // is odd loses the two that were fine.
    expect(usageFrom({ usage: { prompt_tokens: 1200, completion_tokens: 'many' } })).toEqual({
      promptTokens: 1200,
      completionTokens: null,
      totalTokens: null,
    })
  })
})
