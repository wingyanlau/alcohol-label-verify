import { describe, expect, it } from 'vitest'
import { createProvider, knownProviderNames, specFor } from './registry.js'

const base = { MODEL_ID: '@cf/meta/llama-4-scout-17b-16e-instruct' }
const fakeAi = {} as Ai

describe('choosing a reader', () => {
  it('resolves each known provider by name, case-insensitively', () => {
    expect(specFor('workers-ai')?.name).toBe('workers-ai')
    expect(specFor(' Gemini ')?.name).toBe('gemini')
    expect(specFor('nope')).toBeNull()
  })

  it('builds the configured provider, and reports which one it built', () => {
    const p = createProvider({ ...base, MODEL_PROVIDER: 'workers-ai', AI: fakeAi })
    expect(p.name).toBe('workers-ai')
    expect(p.spec.requiresCredential).toBe(false)
  })

  it('builds gemini when a credential is present', () => {
    const p = createProvider({
      MODEL_PROVIDER: 'gemini',
      MODEL_ID: 'gemini-2.5-flash-002',
      MODEL_API_KEY: 'k',
    })
    expect(p.name).toBe('gemini')
    expect(p.spec.requiresCredential).toBe(true)
  })

  // Falling back to a default would read labels with a model the audit record
  // does not name — worse than not reading them (D29).
  it('refuses an unknown provider rather than defaulting', () => {
    expect(() => createProvider({ ...base, MODEL_PROVIDER: 'openai' })).toThrow(/unknown/)
    expect(knownProviderNames()).toContain('workers-ai')
    expect(knownProviderNames()).toContain('gemini')
  })

  it('refuses a provider whose dependency is missing, and says which', () => {
    expect(() => createProvider({ ...base, MODEL_PROVIDER: 'workers-ai' })).toThrow(/AI binding/)
    expect(() =>
      createProvider({ MODEL_PROVIDER: 'gemini', MODEL_ID: 'gemini-2.5-flash-002' }),
    ).toThrow(/MODEL_API_KEY/)
  })
})
