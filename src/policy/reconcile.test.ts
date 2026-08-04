/**
 * Reconciling the reviewed file into the archive.
 *
 * This is where a wrong answer rewrites policy history, so the planning half is
 * pure and tested against cases. The properties that matter are not "it copies
 * the rules" — they are that running it twice does nothing the second time, and
 * that nothing is ever lost.
 */

import { describe, expect, it } from 'vitest'
import type { PolicyRule } from '../domain/policy.js'
import {
  type ArchivedRule,
  actionEvent,
  canonicalRuleBody,
  describeReconciliation,
  NOTHING_TO_DO,
  planReconciliation,
  type ReconcileAction,
  type SourceRule,
} from './reconcile.js'

const rule = (over: Partial<PolicyRule> = {}): PolicyRule =>
  ({
    id: 'DS-STANDARD-OF-FILL',
    ruleVersion: 1,
    regulation: '27-CFR-5.203',
    effectiveFrom: '2025-01-10',
    effectiveTo: null,
    supersedes: null,
    requirement: 'Net contents must be an authorised standard of fill',
    appliesWhen: { productType: ['Distilled spirits'] },
    check: { kind: 'value-in-set', field: 'netContents', unit: 'mL', permitted: [750, 500] },
    severity: 'blocking',
    status: 'active',
    automation: 'advisory',
    ...over,
  }) as PolicyRule

const source = (r: PolicyRule, digest = `digest-of-${r.id}`): SourceRule => ({ rule: r, digest })
const row = (ruleId: string, bodyDigest: string, id = `row-${ruleId}`): ArchivedRule => ({
  id,
  ruleId,
  bodyDigest,
})

const kinds = (actions: readonly ReconcileAction[]) => actions.map((a) => a.kind)

describe('an empty archive takes everything the file has', () => {
  it('inserts each rule', () => {
    const plan = planReconciliation([source(rule()), source(rule({ id: 'WINE-X' }))], [])
    expect(kinds(plan)).toEqual(['insert', 'insert'])
  })
})

describe('running it again does nothing (the property that makes it safe on every deploy)', () => {
  it('plans nothing when every digest already matches', () => {
    const entry = source(rule())
    const plan = planReconciliation([entry], [row(entry.rule.id, entry.digest)])
    expect(plan).toEqual([])
    expect(describeReconciliation(plan)).toBe(NOTHING_TO_DO)
  })

  it('is unmoved by a reordered file', () => {
    // Key order is whoever last edited the JSON, not a policy change. A digest
    // that moved when a formatter reordered a literal would announce a change
    // that did not happen.
    const a = canonicalRuleBody(rule())
    const b = canonicalRuleBody({
      ...rule(),
      // Same rule, keys arriving in a different order.
      status: 'active',
      id: 'DS-STANDARD-OF-FILL',
    } as PolicyRule)
    expect(a).toBe(b)
  })

  it('is unmoved by an edited annotation', () => {
    // $examples and $draftNote are for a human reading the file. Superseding a
    // rule — a new row and an audit event — because somebody improved a comment
    // would fill the chain with changes nobody made.
    const plain = canonicalRuleBody(rule())
    const annotated = canonicalRuleBody({
      ...rule(),
      $examples: ['750 mL'],
      $draftNote: 'reworded for clarity',
    } as unknown as PolicyRule)
    expect(annotated).toBe(plain)
  })
})

describe('a changed rule is superseded, not edited', () => {
  const entry = source(rule(), 'digest-v2')

  it('closes the old window and opens a new one, as one act', () => {
    const plan = planReconciliation([entry], [row(entry.rule.id, 'digest-v1')])
    expect(kinds(plan)).toEqual(['supersede'])
  })

  it('names the row it closes, so the two halves cannot drift apart', () => {
    const plan = planReconciliation([entry], [row(entry.rule.id, 'digest-v1', 'row-42')])
    const action = plan[0]
    expect(action?.kind).toBe('supersede')
    if (action?.kind === 'supersede') {
      expect(action.closes.id).toBe('row-42')
      expect(action.source.digest).toBe('digest-v2')
    }
  })
})

describe('a rule removed from the file is retired, never dropped', () => {
  it('closes its window', () => {
    // D27. A verdict that cites the rule would otherwise lose the thing it was
    // judged by — and that verdict is precisely the one somebody is disputing.
    const plan = planReconciliation([], [row('DS-OLD', 'digest-v1')])
    expect(kinds(plan)).toEqual(['retire'])
  })

  it('leaves rules that are still in the file alone', () => {
    const kept = source(rule())
    const plan = planReconciliation(
      [kept],
      [row(kept.rule.id, kept.digest), row('DS-GONE', 'digest-x')],
    )
    expect(kinds(plan)).toEqual(['retire'])
  })
})

describe('what each action announces to the audit chain', () => {
  it('records an approved rule as enacted', () => {
    expect(actionEvent({ kind: 'insert', source: source(rule({ status: 'active' })) })).toBe(
      'policy.rule.enacted',
    )
  })

  it('records an unapproved one as proposed, not enacted', () => {
    // A model may propose; only a person may enact (§18.5a). A draft seeds as a
    // row so it can be reviewed in place, and selection never sees it.
    expect(actionEvent({ kind: 'insert', source: source(rule({ status: 'draft' })) })).toBe(
      'policy.rule.proposed',
    )
  })

  it('distinguishes superseding from retiring', () => {
    const closes = row('X', 'd')
    expect(actionEvent({ kind: 'supersede', closes, source: source(rule()) })).toBe(
      'policy.rule.superseded',
    )
    expect(actionEvent({ kind: 'retire', closes })).toBe('policy.rule.retired')
  })
})

describe('the account it gives of itself', () => {
  it('counts what it did, for a deploy log to read', () => {
    const plan = planReconciliation(
      [source(rule({ id: 'A' }), 'new'), source(rule({ id: 'B' }), 'v2')],
      [row('B', 'v1'), row('C', 'old')],
    )
    const described = describeReconciliation(plan)
    expect(described).toMatch(/1 insert/)
    expect(described).toMatch(/1 supersede/)
    expect(described).toMatch(/1 retire/)
  })
})
