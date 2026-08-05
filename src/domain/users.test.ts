/**
 * The register (design §19.5).
 *
 * Every name in this record was a free string. A typo, a different
 * capitalisation and a person who does not exist were indistinguishable from a
 * real approval, because any string passed.
 *
 * What this is NOT is authentication. It says who is recognised and what they
 * may do; nothing here verifies that whoever selected a name is that person.
 */

import { describe, expect, it } from 'vitest'
import { describeUser, registeredUsers, userByName, userMay } from './users.js'

describe('who is recognised', () => {
  it('resolves a registered person', () => {
    expect(userByName('Sarah Peterson')?.title).toMatch(/sponsor/i)
  })

  it('does not resolve a near miss', () => {
    // Deliberately exact. A fuzzy match silently resolving to somebody would be
    // worse than not resolving, because the value here is that the name means
    // one specific person.
    expect(userByName('sarah peterson')).toBeNull()
    expect(userByName('S. Peterson')).toBeNull()
  })

  it('tolerates surrounding whitespace, which is a typing artefact', () => {
    expect(userByName('  Sarah Peterson ')?.id).toBe('sarah-peterson')
  })

  it('says plainly when a name is not in the register', () => {
    expect(describeUser('A Passing Stranger')).toMatch(/not in the register/)
  })
})

describe('what each may do', () => {
  it('lets a compliance agent decide a submission', () => {
    expect(userMay('Jenny Alvarez', 'compliance-agent')).toBe(true)
  })

  it('does not let a compliance agent enact a rule', () => {
    // Deciding a submission and deciding what the law requires are different
    // acts, and the register is where that difference lives.
    expect(userMay('Jenny Alvarez', 'policy-approver')).toBe(false)
  })

  it('keeps proposing and enacting apart', () => {
    // Separation of duty. A proposal signed off by its own author is not a
    // review, and D27 asks for a review.
    expect(userMay('Sarah Peterson', 'policy-author')).toBe(true)
    expect(userMay('Sarah Peterson', 'policy-approver')).toBe(false)
  })

  it('grants nothing to somebody it does not know', () => {
    for (const role of ['compliance-agent', 'policy-approver', 'policy-author'] as const) {
      expect(userMay('Nobody In Particular', role), role).toBe(false)
    }
  })

  it('has somebody entitled to decide, or the decision form offers nothing', () => {
    const agents = registeredUsers().filter((u) => u.roles.includes('compliance-agent'))
    expect(agents.length).toBeGreaterThan(0)
  })

  it('has exactly one route to enacting a rule, and it is not an author', () => {
    const approvers = registeredUsers().filter((u) => u.roles.includes('policy-approver'))
    expect(approvers.length).toBeGreaterThan(0)
    for (const a of approvers) {
      expect(a.roles.includes('policy-author'), `${a.name} both proposes and enacts`).toBe(false)
    }
  })
})
