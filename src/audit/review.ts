/**
 * An audit, as an act somebody performs and signs.
 *
 * The system can show three things: that the chain verifies, that a verdict
 * re-derives from its own record, and that the model still reads the artwork
 * the same way. **None of those is an audit.** They are evidence. An audit is a
 * person looking at that evidence and concluding something about the record —
 * and a conclusion nobody wrote down is a conversation, not a finding.
 *
 * So the shape here mirrors the decision flow exactly, because it is the same
 * shape: the system assembles what it can establish, a human draws the
 * conclusion, and the conclusion is recorded against the evidence it was formed
 * on. What the system must never do is *compute* the result — an "audit" a
 * machine awards itself is the thing an audit exists to guard against.
 */

import type { Agent } from '../batch/agent.js'
import { checkAgentMay } from '../batch/agent.js'
import { userMay } from '../domain/users.js'

/**
 * The three conclusions, and why not two.
 *
 * `CONCERNS` is not a soft `FAILED`. "This record did not hold up" and "this
 * needs explaining before I would rely on it" send a reader to different
 * places, and collapsing them would make every reservation read as a failure —
 * which is how a reviewer learns to stop recording reservations.
 */
export const AUDIT_RESULTS = ['UPHELD', 'CONCERNS', 'FAILED'] as const
export type AuditResult = (typeof AUDIT_RESULTS)[number]

export const AUDIT_RESULT_LABEL: Readonly<Record<AuditResult, string>> = {
  UPHELD: 'The record holds up',
  CONCERNS: 'Holds up, with something to explain',
  FAILED: 'The record does not hold up',
}

/** What the checks said when the audit was taken. Null means "did not run". */
export interface AuditEvidence {
  readonly chainStatus: string | null
  readonly replayStatus: string | null
  readonly rereadStatus: string | null
}

export class AuditRejected extends Error {
  constructor(
    readonly field: 'auditedBy' | 'result',
    message: string,
  ) {
    super(message)
    this.name = 'AuditRejected'
  }
}

/**
 * Refuse an audit that cannot mean anything.
 *
 * Two ways it could be meaningless, and both are refused rather than stored:
 * an unrecognised auditor, and a machine signing its own homework.
 */
export function checkAudit(agent: Agent, auditedBy: string, result: string): AuditResult {
  // Only a person may conclude. The same invariant that stops a model recording
  // a decision stops it recording an audit, and for a stronger reason: the
  // whole point of the act is that somebody outside the machine looked.
  checkAgentMay(agent, 'audit.recorded')

  const name = auditedBy.trim()
  if (name === '') {
    throw new AuditRejected('auditedBy', 'Please say who is recording this audit.')
  }
  if (!userMay(name, 'compliance-agent') && !userMay(name, 'administrator')) {
    throw new AuditRejected(
      'auditedBy',
      `"${name}" is not someone this deployment recognises as able to audit a record.`,
    )
  }

  if (!AUDIT_RESULTS.includes(result as AuditResult)) {
    throw new AuditRejected('result', `"${result}" is not one of the three conclusions.`)
  }
  return result as AuditResult
}

/**
 * What the evidence *suggests*, offered to a person — never applied.
 *
 * Deliberately a suggestion and deliberately not the stored result. It exists so
 * a reviewer working through a list is not left to decode three status strings,
 * and it stops there: the recorded conclusion is whatever the person chose, and
 * a suggestion the system quietly promoted to a finding would be exactly the
 * failure this whole design refuses elsewhere.
 */
export function suggestedResult(evidence: AuditEvidence): AuditResult {
  if (evidence.replayStatus === 'differs' || evidence.replayStatus === 'record-altered') {
    return 'FAILED'
  }
  if (evidence.chainStatus !== null && evidence.chainStatus !== 'ok') return 'FAILED'
  // A reading that no longer reproduces is not a failure of the record — the
  // verdict still follows from what was stored. It is something to explain.
  if (evidence.rereadStatus === 'differs') return 'CONCERNS'
  // Nothing to compare against is not a pass. It is a gap, and it is the
  // auditor's to weigh.
  if (evidence.replayStatus !== 'identical') return 'CONCERNS'
  return 'UPHELD'
}
