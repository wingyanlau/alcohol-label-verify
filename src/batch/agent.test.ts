/**
 * The agent, and the principle it makes checkable (§19, D46).
 *
 * The point of this concept is not headcount. The governing principle — the
 * model reads, the rules compare, the human decides — was enforced in exactly
 * one place and described everywhere else, and prose does not fail a build.
 */

import { describe, expect, it } from 'vitest'
import {
  AgentNotPermitted,
  checkAgentMay,
  DECIDING_ACTIONS,
  DEPLOY_AGENT,
  humanAgent,
  mayDecide,
  modelAgent,
  namedModelAgent,
  SYSTEM_AGENT,
} from './agent.js'

const provenance = {
  provider: 'gemini',
  modelId: 'gemini-3.5-flash',
  promptVersion: 'label-extract@1',
  samplingParameters: { temperature: 0 },
  latencyMs: 900,
}

describe('only a person may decide', () => {
  it('permits a human', () => {
    expect(mayDecide(humanAgent('jenny'))).toBe(true)
  })

  it('refuses a model, whatever it is called', () => {
    expect(mayDecide(modelAgent(provenance))).toBe(false)
    expect(mayDecide(namedModelAgent('claude-opus-5'))).toBe(false)
  })

  it('refuses the system and the deployment', () => {
    // job.opened and content.purged are the system executing, not anyone
    // deciding. Folding them into either other kind would attribute work to a
    // party that did not perform it.
    expect(mayDecide(SYSTEM_AGENT)).toBe(false)
    expect(mayDecide(DEPLOY_AGENT)).toBe(false)
  })
})

describe('the invariant, enforced where the act is recorded', () => {
  it('refuses a model recording a decision', () => {
    // The single assertion this whole concept exists to make possible.
    expect(() => checkAgentMay(modelAgent(provenance), 'decision.recorded')).toThrow(
      AgentNotPermitted,
    )
  })

  it('refuses a model enacting a rule', () => {
    // §18.5a. A model may propose; only a person may enact.
    expect(() => checkAgentMay(namedModelAgent('claude-opus-5'), 'policy.rule.enacted')).toThrow(
      AgentNotPermitted,
    )
  })

  it('refuses the system deciding, which is the subtler case', () => {
    // A model deciding is an obvious defect. A deployment quietly enacting a
    // rule nobody approved looks like automation working.
    expect(() => checkAgentMay(DEPLOY_AGENT, 'policy.rule.enacted')).toThrow(AgentNotPermitted)
  })

  it('permits a model to read, propose and be superseded', () => {
    // Everything short of deciding. A model that could do none of this would
    // be no use, and the principle is about the decision, not the work.
    for (const action of ['verdict.recorded', 'policy.rule.proposed', 'policy.rule.superseded']) {
      expect(() => checkAgentMay(modelAgent(provenance), action), action).not.toThrow()
    }
  })

  it('permits a person the acts reserved to one', () => {
    for (const action of DECIDING_ACTIONS) {
      expect(() => checkAgentMay(humanAgent('jenny'), action), action).not.toThrow()
    }
  })

  it('says which principle was broken, not just that something was', () => {
    try {
      checkAgentMay(modelAgent(provenance), 'decision.recorded')
      throw new Error('expected a refusal')
    } catch (error) {
      expect((error as Error).message).toMatch(/the human decides/i)
    }
  })
})

describe('a model is identified by its whole tuple (D29, §19.4)', () => {
  it('distinguishes two prompt versions of the same model', () => {
    // Version, prompt and sampling all change what it produces. One name over
    // two readers would report the difference as a trend.
    const a = modelAgent(provenance)
    const b = modelAgent({ ...provenance, promptVersion: 'label-extract@2' })
    expect(a.id).not.toBe(b.id)
  })

  it('distinguishes the same model behind two providers', () => {
    const a = modelAgent(provenance)
    const b = modelAgent({ ...provenance, provider: 'workers-ai' })
    expect(a.id).not.toBe(b.id)
  })
})

describe('a human identity is declared, not authenticated (§19.5)', () => {
  it('carries the name as entered', () => {
    expect(humanAgent('  jenny  ').display).toBe('jenny')
  })

  it('does not pretend an empty name is somebody', () => {
    // Recorded as it was given. Whether an unnamed decision is acceptable is
    // checkDecision's question, and it refuses one.
    expect(humanAgent('   ').display).toBe('')
  })
})
