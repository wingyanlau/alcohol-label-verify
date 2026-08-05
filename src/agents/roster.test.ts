/**
 * The agent roster (§19).
 *
 * D46 made "who or what acted" one concept with three kinds. The register was
 * then only visible to code — a person could read the audit trail and see that
 * `model:workers-ai:@cf/…:label-extract@2` had read a label, without anywhere
 * to look up what that is or what it is allowed to do.
 *
 * These tests pin the two claims the page makes, because both are claims about
 * governance rather than about display:
 *
 *  1. Only a human may decide, and the roster says so of every entry.
 *  2. Nothing here counts what anyone did (D47).
 */

import { describe, expect, it } from 'vitest'
import { mayDecide } from '../batch/agent.js'
import { agentRoster } from './roster.js'

const roster = agentRoster()

describe('the agent roster', () => {
  it('lists all three kinds', () => {
    // The system is a kind, not a tidy-up: `job.opened` is the deployment
    // executing, and folding it into either other kind would attribute work to
    // a party that did not do it.
    expect(new Set(roster.map((a) => a.kind))).toEqual(new Set(['human', 'model', 'system']))
  })

  it('agrees with the rule the code enforces, entry by entry', () => {
    // Not a restatement — the same function the recorder calls. A page that
    // decided this for itself could say a model may decide while the code
    // refused it, and the page is the one people would believe.
    for (const entry of roster) {
      expect(entry.mayDecide, entry.id).toBe(
        mayDecide({ kind: entry.kind, id: entry.id, display: entry.display }),
      )
    }
  })

  it('names every person from the register, with their role', () => {
    const people = roster.filter((a) => a.kind === 'human')
    expect(people.length).toBeGreaterThan(2)
    for (const person of people) {
      expect(person.entitlements.length, person.display).toBeGreaterThan(0)
    }
  })

  it('separates proposing a rule from enacting one', () => {
    // D27, and the whole of why the two roles exist. A proposal signed off by
    // the person who made it is not a review.
    const grants = (display: string) =>
      roster.find((a) => a.display === display)?.entitlements ?? []
    const enacts = (list: readonly string[]) => list.some((e) => e.startsWith('Enact a rule'))

    expect(grants('Sarah Peterson').join(' ')).toMatch(/^Propose a rule/)
    expect(enacts(grants('Sarah Peterson'))).toBe(false)

    const approver = roster.find((a) => enacts(a.entitlements))
    expect(approver, 'somebody must be able to enact a rule').toBeDefined()
    expect(approver?.display).not.toBe('Sarah Peterson')
    expect(approver?.kind).toBe('human')
  })

  it('identifies a model by its whole tuple, never by a bare name', () => {
    // D29. "gemini" would compare two different readers under one name and call
    // the difference a trend.
    for (const model of roster.filter((a) => a.kind === 'model')) {
      expect(model.id, model.display).toMatch(/^model:[^:]+:.+/)
    }
  })

  it('says of every model that it may not decide, in words', () => {
    for (const model of roster.filter((a) => a.kind === 'model')) {
      expect(model.entitlements.join(' '), model.id).toMatch(/read|propose/i)
      expect(model.mayDecide).toBe(false)
    }
  })

  it('counts nothing anybody did (D47)', () => {
    // The metric is deliberately withheld, and a roster is exactly where one
    // would arrive by accident. Throughput is not effectiveness, the costs of
    // disagreement are asymmetric, and measuring named employees is a labour
    // question before a technical one.
    for (const entry of roster) {
      expect(Object.keys(entry)).not.toContain('actions')
      expect(Object.keys(entry)).not.toContain('count')
    }
  })
})
