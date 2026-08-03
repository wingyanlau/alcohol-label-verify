import { describe, expect, it } from 'vitest'
import { withRateLimitRetry } from './retry.js'

const rateLimit = () =>
  new Error('Unable to create new browser: code: 429: message: Rate limit exceeded')

/** Records what was waited for instead of actually waiting. */
function recorder() {
  const waited: number[] = []
  return { waited, sleep: async (ms: number) => void waited.push(ms) }
}

describe('holding an item through a rate limit', () => {
  it('does not wait when the first attempt succeeds', async () => {
    const { waited, sleep } = recorder()
    const result = await withRateLimitRetry(async () => 'normalised', { sleep })
    expect(result).toBe('normalised')
    expect(waited).toEqual([])
  })

  // The point of the change: the item keeps the slot. It waits and tries
  // again itself rather than returning to the queue, where the next item
  // would take its turn.
  it('waits and retries the same call until it succeeds', async () => {
    const { waited, sleep } = recorder()
    let calls = 0
    const result = await withRateLimitRetry(
      async () => {
        calls++
        if (calls < 3) throw rateLimit()
        return 'normalised'
      },
      { sleep },
    )
    expect(result).toBe('normalised')
    expect(calls).toBe(3)
    expect(waited).toEqual([5_000, 10_000])
  })

  it('waits longer after each refusal', async () => {
    const { waited, sleep } = recorder()
    await expect(
      withRateLimitRetry(
        async () => {
          throw rateLimit()
        },
        { sleep, maxAttempts: 4 },
      ),
    ).rejects.toThrow(/429/)
    expect(waited).toEqual([5_000, 10_000, 15_000])
  })

  it('gives up after the attempt budget and reports the provider is refusing', async () => {
    const { sleep } = recorder()
    let calls = 0
    await expect(
      withRateLimitRetry(
        async () => {
          calls++
          throw rateLimit()
        },
        { sleep, maxAttempts: 3 },
      ),
    ).rejects.toThrow(/429/)
    expect(calls).toBe(3)
  })

  // Waiting out a fault that is not a rate limit spends the budget on
  // something that will not clear, and delays an honest failure.
  it('does not wait for a failure that is not a rate limit', async () => {
    const { waited, sleep } = recorder()
    await expect(
      withRateLimitRetry(
        async () => {
          throw new Error('this does not appear to be a form I recognise')
        },
        { sleep },
      ),
    ).rejects.toThrow(/form I recognise/)
    expect(waited).toEqual([])
  })
})
