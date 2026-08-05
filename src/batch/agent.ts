/**
 * Who or what acted (design §19, D46).
 *
 * One concept for something the record already said four ways and could not
 * join: a free-text `actor` on the chain, `extractedBy` on a rule's provenance,
 * a qualified `model_id` on an extraction, and a person's name on a decision.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS, AND IT IS NOT HEADCOUNT
 *
 * The governing principle — *the model reads, the rules compare, the human
 * decides* — is enforced in exactly one place today and described everywhere
 * else. Prose does not fail a build. A kind on every act makes it a property
 * that can be asserted over the whole record:
 *
 *   no act by an agent of kind `model` may be a decision
 *
 * `mayDecide` below is that principle as a function. The workforce metric is
 * deliberately not built (D47).
 */

import type { ExtractionProvenance } from '../domain/extraction.js'

/**
 * Three kinds, and the third is not a tidy-up.
 *
 * `job.opened` and `content.purged` are the system executing, not anyone
 * deciding. Folding them into either other kind would attribute work to a party
 * that did not perform it — and would inflate any measure taken later.
 */
export type AgentKind = 'human' | 'model' | 'system'

export interface Agent {
  readonly kind: AgentKind
  /**
   * The qualified identity.
   *
   * For a model this is provider, model and prompt version together (D29,
   * §19.4). A model is not a stable agent: version, prompt and sampling all
   * move, and each changes what it produces, so identifying it as "gemini"
   * would compare two different readers under one name and call the difference
   * a trend.
   */
  readonly id: string
  /** What a reader sees. For a human, the name they entered. */
  readonly display: string
}

/**
 * A person, by the name they entered.
 *
 * **Declared, not authenticated** (§19.5). This deployment has no accounts, so
 * nothing verifies it, and no measure built on this attribution should be
 * described as measuring anybody. The name says `AsEntered` wherever it reaches
 * a reader for exactly that reason.
 */
export function humanAgent(nameAsEntered: string): Agent {
  const name = nameAsEntered.trim()
  return { kind: 'human', id: `human:${name}`, display: name }
}

/** The reader that produced an extraction, identified by its whole tuple. */
export function modelAgent(provenance: ExtractionProvenance): Agent {
  const id = `model:${provenance.provider}:${provenance.modelId}:${provenance.promptVersion}`
  return { kind: 'model', id, display: `${provenance.provider} ${provenance.modelId}` }
}

/** A model named only as a string — a rule's provenance carries no more. */
export function namedModelAgent(modelId: string): Agent {
  return { kind: 'model', id: `model:${modelId}`, display: modelId }
}

/** The system executing its own steps. Never an agent that decides. */
export const SYSTEM_AGENT: Agent = { kind: 'system', id: 'system', display: 'system' }

/** A deployment applying what was reviewed. Also the system, not a person. */
export const DEPLOY_AGENT: Agent = { kind: 'system', id: 'system:deploy', display: 'deploy' }

/**
 * The governing principle, as a function.
 *
 * Only a person may decide, and only a person may enact a rule (§18.5a). Every
 * other kind may read, compare, propose and execute — and none of that is
 * deciding.
 */
export function mayDecide(agent: Agent): boolean {
  return agent.kind === 'human'
}

/** Actions that constitute a decision, and so require a human agent. */
export const DECIDING_ACTIONS: readonly string[] = [
  'decision.recorded',
  'policy.rule.enacted',
  // Auditing is deciding. A machine that could sign off on the record's
  // soundness would be awarding itself the thing an audit exists to withhold.
  'audit.recorded',
]

export class AgentNotPermitted extends Error {
  constructor(agent: Agent, action: string) {
    super(
      `${agent.kind} agent "${agent.display}" may not perform "${action}". ` +
        'The model reads, the rules compare, the human decides.',
    )
    this.name = 'AgentNotPermitted'
  }
}

/**
 * Refuse an act the agent is not entitled to perform.
 *
 * Checked at the point of recording rather than left to a reviewer noticing.
 * The principle is worth nothing if the only thing enforcing it is that nobody
 * has yet written the code that breaks it.
 */
export function checkAgentMay(agent: Agent, action: string): void {
  if (DECIDING_ACTIONS.includes(action) && !mayDecide(agent)) {
    throw new AgentNotPermitted(agent, action)
  }
}
