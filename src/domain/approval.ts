/**
 * Which models this deployment is permitted to read labels with.
 *
 * Choosing the reader is a governance decision, not a deployment detail. It
 * determines what every verdict was produced by, and D29 already treats a
 * moving identifier as invalidating the records that cite it — so who decided,
 * when, and on what grounds belongs in the record too.
 *
 * It lives in configuration because the prototype has no authenticated admin
 * surface (D14), and a runtime setting with no gate behind it would be an
 * affordance pretending to be a control. A file in the repository is at least
 * versioned, diffable and reviewed. When an authenticated admin exists this
 * becomes its seed rather than its replacement.
 *
 * The enforcement is deliberately mild: an unapproved pairing is reported by
 * /health as a configuration problem, in the same way an unpinned model id is.
 * The service says what it is doing rather than silently doing it.
 */

import raw from '../../config/approved-models.json'

export interface ModelApproval {
  readonly provider: string
  readonly modelId: string
  readonly approvedBy: string
  readonly approvedOn: string
  readonly rationale: string
}

const APPROVALS = (raw as { approvals: ModelApproval[] }).approvals

/** The approval for a provider and model, or null if the pairing is not listed. */
export function approvalFor(provider: string, modelId: string): ModelApproval | null {
  const p = provider.trim().toLowerCase()
  const m = modelId.trim()
  // Matched as a pair. The same model under a different provider is a
  // different reader, reached by a different route, with different failure
  // modes — approving one says nothing about the other.
  return APPROVALS.find((a) => a.provider === p && a.modelId === m) ?? null
}

export function isApproved(provider: string, modelId: string): boolean {
  return approvalFor(provider, modelId) !== null
}
