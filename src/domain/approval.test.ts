import { describe, expect, it } from 'vitest'
import { approvalFor, isApproved } from './approval.js'

describe('which models this deployment may read with', () => {
  it('recognises an approved pairing', () => {
    expect(isApproved('gemini', 'gemini-3.5-flash')).toBe(true)
    expect(isApproved('workers-ai', '@cf/meta/llama-4-scout-17b-16e-instruct')).toBe(true)
  })

  // The pairing matters, not the parts. An approved model under a different
  // provider is a different reader entirely.
  it('does not approve a model under the wrong provider', () => {
    expect(isApproved('workers-ai', 'gemini-3.5-flash')).toBe(false)
  })

  it('refuses anything not listed', () => {
    expect(isApproved('gemini', 'gemini-3.5-pro')).toBe(false)
    expect(isApproved('openai', 'gpt-5')).toBe(false)
  })

  // A deployer editing wrangler.jsonc could otherwise point the service at any
  // model, and the only trace would be a config diff nobody reviewed as a
  // decision. The approval is what makes it one.
  it('carries who decided and why, for the record', () => {
    const a = approvalFor('gemini', 'gemini-3.5-flash')
    expect(a?.approvedOn).toBe('2026-08-03')
    expect(a?.rationale).toMatch(/repointed|stable name/i)
  })

  it('returns nothing for an unapproved pairing rather than a default', () => {
    expect(approvalFor('gemini', 'gemini-1.0-pro')).toBeNull()
  })
})
