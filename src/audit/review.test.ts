/**
 * Recording an audit.
 *
 * The failure modes are all about the act being meaningless rather than wrong:
 * a machine signing its own record, a name nobody recognises, or a conclusion
 * the system computed and attributed to a person.
 */

import { describe, expect, it } from 'vitest'
import { AgentNotPermitted, humanAgent, modelAgent, SYSTEM_AGENT } from '../batch/agent.js'
import { AuditRejected, checkAudit, suggestedResult } from './review.js'

const person = humanAgent('Dave Mitchell')
const model = modelAgent({
  provider: 'gemini',
  modelId: 'gemini-3.5-flash',
  promptVersion: 'label-extract@2',
  samplingParameters: {},
  latencyMs: 1,
})

describe('who may record an audit', () => {
  it('accepts a recognised person', () => {
    expect(checkAudit(person, 'Dave Mitchell', 'UPHELD')).toBe('UPHELD')
  })

  it('refuses a model outright', () => {
    // The strongest form of the governing principle. A machine concluding that
    // the record it produced is sound is the thing an audit exists to prevent.
    expect(() => checkAudit(model, 'Dave Mitchell', 'UPHELD')).toThrow(AgentNotPermitted)
  })

  it('refuses the deployment itself', () => {
    expect(() => checkAudit(SYSTEM_AGENT, 'Dave Mitchell', 'UPHELD')).toThrow(AgentNotPermitted)
  })

  it('refuses a name nobody recognises', () => {
    // An audit signed by a string is not signed.
    expect(() => checkAudit(person, 'A. Stranger', 'UPHELD')).toThrow(AuditRejected)
  })

  it('refuses an empty name', () => {
    expect(() => checkAudit(person, '   ', 'UPHELD')).toThrow(AuditRejected)
  })

  it('refuses a conclusion outside the three', () => {
    expect(() => checkAudit(person, 'Dave Mitchell', 'PROBABLY FINE')).toThrow(AuditRejected)
  })
})

describe('what the evidence suggests', () => {
  const evidence = (over: Partial<Parameters<typeof suggestedResult>[0]> = {}) => ({
    chainStatus: 'ok',
    replayStatus: 'identical',
    rereadStatus: 'identical',
    ...over,
  })

  it('suggests upheld when everything reproduces', () => {
    expect(suggestedResult(evidence())).toBe('UPHELD')
  })

  it('suggests failed when the verdict no longer re-derives', () => {
    expect(suggestedResult(evidence({ replayStatus: 'differs' }))).toBe('FAILED')
  })

  it('suggests failed when the stored reading itself moved', () => {
    expect(suggestedResult(evidence({ replayStatus: 'record-altered' }))).toBe('FAILED')
  })

  it('suggests failed when the history has been altered', () => {
    expect(suggestedResult(evidence({ chainStatus: 'broken' }))).toBe('FAILED')
  })

  it('suggests concerns — not failure — when only the reading moved', () => {
    // The verdict still follows from what was stored. That the model no longer
    // reads it the same way is something to explain, not a broken record.
    expect(suggestedResult(evidence({ rereadStatus: 'differs' }))).toBe('CONCERNS')
  })

  it('suggests concerns when a check could not run', () => {
    // Nothing to compare against is a gap for the auditor to weigh, and it is
    // emphatically not a pass.
    expect(suggestedResult(evidence({ replayStatus: 'not-comparable' }))).toBe('CONCERNS')
    expect(suggestedResult(evidence({ replayStatus: 'not-re-derivable' }))).toBe('CONCERNS')
  })

  it('is a suggestion and nothing more', () => {
    // Pinned because the temptation is to store it. The recorded result is
    // whatever the person chose; a suggestion the system promoted to a finding
    // would be the machine auditing itself by the back door.
    const strongest = suggestedResult(evidence())
    expect(strongest).toBe('UPHELD')
    // checkAudit takes the human's answer and never consults the suggestion.
    expect(checkAudit(person, 'Dave Mitchell', 'FAILED')).toBe('FAILED')
  })
})
