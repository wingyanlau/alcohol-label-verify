/**
 * Who and what may act here, and what each is entitled to do (§19).
 *
 * D46 made "who or what acted" a single concept with three kinds — human, model,
 * system — so that the governing principle could be asserted over the whole
 * record instead of trusted in one place. The register that concept draws on
 * was visible only to code: an audit line reading
 * `model:workers-ai:@cf/…:label-extract@2` identified an agent precisely and
 * gave a reader nowhere to look up what it is or what it may do.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DELIBERATELY DOES NOT COUNT
 *
 * Nothing. No volumes, no throughput, no per-agent activity — D47, and a roster
 * is precisely where such a number would arrive by accident. Three reasons, all
 * still standing: throughput is not effectiveness; the costs of disagreement are
 * asymmetric, so an average of them would recommend moving exactly the wrong
 * work to a model with a confident-looking number attached; and measuring named
 * employees is a labour-relations question before a technical one.
 *
 * The record holds what would be needed. Withholding the measure is the
 * decision, not a gap.
 */

import approvedModels from '../../config/approved-models.json' with { type: 'json' }
import type { Agent, AgentKind } from '../batch/agent.js'
import { DEPLOY_AGENT, mayDecide, SYSTEM_AGENT } from '../batch/agent.js'
import type { UserRole } from '../domain/users.js'
import { registeredUsers, roleLabelFor } from '../domain/users.js'

export interface RosterEntry {
  readonly kind: AgentKind
  /** The qualified identity, exactly as it appears in the record (D29, §19.4). */
  readonly id: string
  readonly display: string
  /** What this agent is here — a role, a provider, or the deployment itself. */
  readonly role: string
  /** What it may do, in the words of the acts themselves. */
  readonly entitlements: readonly string[]
  /** The governing principle, per entry. Taken from the code, never restated. */
  readonly mayDecide: boolean
  /** Why this agent is on the list at all. */
  readonly source: string
}

/**
 * What each role is entitled to do, in the words of the act.
 *
 * `policy-author` and `policy-approver` are deliberately disjoint, and that
 * disjointness is the whole of D27: a proposal signed off by the person who
 * made it is not a review.
 */
const ROLE_ENTITLEMENTS: Readonly<Record<UserRole, readonly string[]>> = {
  'compliance-agent': ['Decide a submission — approve, reject or return it'],
  'policy-approver': [
    'Enact a rule, which is the named human approval no rule takes effect without',
  ],
  'policy-author': ['Propose a rule for approval — and never enact their own proposal'],
  administrator: ['Approve which models may read a label'],
}

function humanEntries(): RosterEntry[] {
  return registeredUsers().map((user) => {
    const agent: Agent = { kind: 'human', id: `human:${user.name}`, display: user.name }
    return {
      kind: 'human' as const,
      id: agent.id,
      display: user.name,
      role: roleLabelFor(user),
      entitlements: user.roles.flatMap((r) => ROLE_ENTITLEMENTS[r] ?? []),
      mayDecide: mayDecide(agent),
      // Declared, never authenticated (§19.5). Saying so here is the point:
      // this list says who is recognised, not that whoever typed a name is
      // that person.
      source: 'Named in the user register. Recognised, not authenticated (D14).',
    }
  })
}

function modelEntries(): RosterEntry[] {
  const approvals = (approvedModels as { approvals: { provider: string; modelId: string }[] })
    .approvals
  return approvals.map((approval) => {
    const agent: Agent = {
      kind: 'model',
      id: `model:${approval.provider}:${approval.modelId}`,
      display: `${approval.provider} ${approval.modelId}`,
    }
    return {
      kind: 'model' as const,
      id: agent.id,
      display: agent.display,
      role: 'Reader',
      entitlements: [
        'Read a label, and report what it could not read',
        'Propose a rule, which a person must then enact',
      ],
      mayDecide: mayDecide(agent),
      // The recorded identity is longer than this one: a verdict pins the
      // prompt version too, because a model is not a stable agent — version,
      // prompt and sampling all move, and each changes what it produces.
      source:
        'Approved to read labels in config/approved-models.json (D29). ' +
        'Recorded against a verdict with its prompt version appended, because that also decides what it produces.',
    }
  })
}

function systemEntries(): RosterEntry[] {
  const describe = (agent: Agent, role: string, entitlements: string[], source: string) => ({
    kind: agent.kind,
    id: agent.id,
    display: agent.display,
    role,
    entitlements,
    mayDecide: mayDecide(agent),
    source,
  })
  return [
    describe(
      SYSTEM_AGENT,
      'The deployment executing',
      ['Open and close a job', 'Purge staged content when retention says so'],
      'Its own kind rather than folded into another: opening a job is execution, not anyone deciding, and attributing it to a person or a model would credit work to a party that did not do it.',
    ),
    describe(
      DEPLOY_AGENT,
      'The deployment applying what was reviewed',
      ['Bring the policy archive into agreement with the reviewed file'],
      'A deploy applies rules a person approved in the reviewed source; it does not approve them (D45).',
    ),
  ]
}

/**
 * Everyone and everything recognised here.
 *
 * Ordered people first: the governing principle puts the decision with them,
 * and a list that opened with the machines would read as though the machines
 * were the establishment and the people an annotation.
 */
export function agentRoster(): readonly RosterEntry[] {
  return [...humanEntries(), ...modelEntries(), ...systemEntries()]
}
