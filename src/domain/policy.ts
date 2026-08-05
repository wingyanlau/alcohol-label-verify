/**
 * The policy module's boundary (M11, design §18).
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS, AND WHAT IT IS NOT
 *
 * The rules are **not owned here**. A policy set is supplied from outside this
 * system — by whoever owns the regulations, on whatever cadence they own them.
 * What lives in this file is the *contract* such a set must satisfy, the
 * refusal when it does not, and the deterministic query that decides which of
 * its rules govern a given submission.
 *
 * `config/policy-set.json` is a worked example rather than the deliverable: it
 * was extracted from the eCFR versioner API so the contract could be shown to
 * be satisfiable with real regulation, and so the prototype has something to
 * run against. A production deployment replaces it.
 *
 * ---------------------------------------------------------------------------
 * THE THREE PROPERTIES THE CONTRACT EXISTS TO GUARANTEE
 *
 * 1. **Nothing is enforced that nobody approved** (D27). A set without a named
 *    approver is somebody's draft, and applying it would quietly make this
 *    deployment the approver.
 *
 * 2. **A rule this system cannot perform is refused, never skipped.** Skipping
 *    means reporting compliance against a rule that was never applied —
 *    under-enforcement indistinguishable from enforcement, and invisible in
 *    every output. Refusing to load is loud; skipping is silent, so the whole
 *    set is rejected on one unknown check.
 *
 * 3. **A submission is judged by the rules in force when it was filed.**
 *    Standards of fill changed in January 2025. Judging a 2024 filing by
 *    today's list applies a rule that did not govern it — and would be
 *    invisible afterwards, because the verdict would look perfectly ordinary.
 *
 * Two dates are therefore kept apart throughout, and conflating them is the
 * mistake this module is shaped to prevent: `effectiveFrom`/`effectiveTo`
 * bound the *submission* dates a rule governs, while a regulation's
 * `extractedFromIssueDate` records when this deployment last read the text.
 */

/**
 * Checks this system can actually perform.
 *
 * A closed vocabulary, not an expression language (§18.2). The policy file
 * supplies parameters; each kind is implemented and tested here. A rule
 * language would move logic into a config file where it cannot be unit-tested
 * and would re-admit the non-determinism D23 exists to exclude. The cost —
 * a genuinely new *shape* of check needs code — is the intended cost, because
 * a new shape of check is exactly what should be reviewed rather than
 * configured.
 */
import { userMay } from './users.js'
export const CHECK_KINDS = [
  'field-present',
  'format-matches',
  'value-in-set',
  'numeric-consistency',
  'statutory-text',
  // Added when the BAM's class-and-type chapter showed a shape the first five
  // could not express: a bound on one field determined by the VALUE OF
  // ANOTHER. Minimum bottling strength depends on the labelled class — whisky
  // and gin at 40% ABV, liqueurs at 30%, rock-and-bourbon at 24% — so the
  // check needs both fields at once.
  //
  // Worth noting how this arrived: a new shape of check required a code change
  // and a review, which is what §18.2 intends. A rule language would have
  // absorbed it silently into a config file, untested.
  'numeric-bound',
] as const

export type CheckKind = (typeof CHECK_KINDS)[number]

export type RuleStatus = 'draft' | 'active' | 'superseded'
export type Severity = 'blocking' | 'advisory'
/** How far a rule has earned its way toward deciding on its own (§18.5). */
export type Automation = 'advisory' | 'assisted' | 'automatic'

export interface Regulation {
  readonly id: string
  /**
   * The CFR part — 4 wine, 5 distilled spirits, 7 malt beverages, 16 warning.
   *
   * Present in the data since the set was written and unmodelled until a rule
   * resting on a *subpart* was enacted: a numbered section like "5.63" already
   * embeds its part, so nothing had needed it. "subpart I" does not, and the
   * citation built without it read "27 CFR subpart I" — which identifies
   * nothing an agent could quote to an applicant.
   */
  readonly part: number
  readonly section: string
  readonly heading: string
  /** Verbatim from the regulation's own source note, or null when it has none. */
  readonly amendmentCitation: string | null
  /** Fingerprint of the text that was read. A change means the rule needs review. */
  readonly textDigest: string
  readonly extractedFromIssueDate: string
}

export interface PolicyRule {
  readonly id: string
  readonly ruleVersion: number
  readonly regulation: string
  /** Bounds on the SUBMISSION date this rule governs. Null means unbounded. */
  readonly effectiveFrom: string | null
  readonly effectiveTo: string | null
  readonly supersedes: string | null
  readonly requirement: string
  readonly appliesWhen: { readonly productType?: readonly string[] }
  readonly check: { readonly kind: CheckKind } & Readonly<Record<string, unknown>>
  readonly severity: Severity
  readonly status: RuleStatus
  readonly automation: Automation
  readonly provenance?: RuleProvenance
  readonly approval?: RuleApproval
}

/**
 * A document a policy set was derived from.
 *
 * Registered with a digest so "which document does this rule come from" has an
 * answer that survives the document being edited. A rule whose source can no
 * longer be produced is a rule nobody can check.
 */
export interface SourceDocument {
  readonly id: string
  readonly title: string
  readonly digest: string
  readonly retrievedAt: string
}

/**
 * Where a rule came from, and who read it.
 *
 * Optional: a rule someone simply wrote needs no ceremony. Present when a rule
 * was derived from a supplied document, which is the path an LLM-assisted
 * policy knowledge base would take.
 */
export interface RuleProvenance {
  readonly sourceDocument: string
  /** The verbatim words the rule was drawn from. */
  readonly quote: string
  readonly extractedBy: 'human' | 'model'
  /** Required when `extractedBy` is `model`. Which reader drafted it. */
  readonly model?: string
  /**
   * The **person** putting the rule forward for approval. Required when a model
   * drafted it, and must be a registered `policy-author`.
   *
   * A model reading a regulation is a tool being used, and a tool cannot be
   * answerable for having judged the output worth proposing. Somebody chose to
   * draft this rule and to put it forward; without this field the record named
   * the tool and nobody else.
   *
   * With `approval` it completes the chain D27 and §18.5a describe between
   * them: a model drafts, a **person proposes**, a **different person**
   * approves.
   */
  readonly proposedBy?: string
  readonly extractedAt: string
}

/** A named person taking responsibility for a rule being enforceable. */
export interface RuleApproval {
  readonly by: string
  readonly at: string
}

export interface PolicySet {
  readonly policySetVersion: number
  /**
   * A digest of the governing content — regulations, source documents, rules.
   *
   * Present in the file since the set was written and unmodelled until a deploy
   * needed to prove *which* set it had applied. A worker answering a
   * reconciliation request during propagation may be the previous version, and
   * it answers 200 with a perfectly valid report saying the archive already
   * agrees — because against the bundle it is running, it does.
   */
  readonly contentDigest: string
  readonly approvedBy: string
  readonly approvedAt: string
  readonly regulations: readonly Regulation[]
  readonly sourceDocuments?: readonly SourceDocument[]
  readonly rules: readonly PolicyRule[]
}

/** The set was refused. It is never partially loaded. */
export class PolicyContractError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PolicyContractError'
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''

/**
 * Accept a policy set, or refuse the whole of it.
 *
 * All-or-nothing on purpose. A partially-loaded set would leave the deployment
 * enforcing an arbitrary subset of somebody's policy while reporting that it
 * had applied "the rules", and no output would reveal which ones were dropped.
 */
export function validatePolicySet(value: unknown): PolicySet {
  if (!isRecord(value)) throw new PolicyContractError('the policy set is not an object')

  const version = value.policySetVersion
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new PolicyContractError(
      `policySetVersion must be a positive integer, got ${JSON.stringify(version)}. ` +
        'A set with no version cannot be cited by a verdict.',
    )
  }

  // D27. The approval is the whole difference between a rule and a proposal.
  if (!nonEmpty(value.approvedBy)) {
    throw new PolicyContractError(
      'the policy set names no approver. Nothing is enforced without a named ' +
        'approval — an unapproved set is a draft, and applying it would make ' +
        'this deployment its approver.',
    )
  }

  const regulations = value.regulations
  if (!Array.isArray(regulations)) throw new PolicyContractError('regulations must be an array')
  const known = new Set<string>()
  for (const r of regulations) {
    if (!isRecord(r) || !nonEmpty(r.id)) {
      throw new PolicyContractError('every regulation needs an id')
    }
    known.add(r.id)
  }

  const docs = new Set<string>()
  if (value.sourceDocuments !== undefined) {
    if (!Array.isArray(value.sourceDocuments)) {
      throw new PolicyContractError('sourceDocuments must be an array')
    }
    for (const d of value.sourceDocuments) {
      if (!isRecord(d) || !nonEmpty(d.id) || !nonEmpty(d.digest)) {
        throw new PolicyContractError(
          'every source document needs an id and a digest — without the digest, ' +
            'the document a rule cites can be edited and nothing would show it',
        )
      }
      docs.add(d.id)
    }
  }

  const rules = value.rules
  if (!Array.isArray(rules)) throw new PolicyContractError('rules must be an array')

  const seen = new Set<string>()
  for (const r of rules) {
    if (!isRecord(r) || !nonEmpty(r.id)) throw new PolicyContractError('every rule needs an id')
    if (seen.has(r.id)) {
      throw new PolicyContractError(
        `two rules share the id "${r.id}". A finding names its rule (FR-10), ` +
          'and an ambiguous name is not a citation.',
      )
    }
    seen.add(r.id)

    // A rule that cannot say what it requires cannot produce a defensible
    // finding, which is the entire point of carrying the rule with the verdict.
    if (!nonEmpty(r.requirement)) {
      throw new PolicyContractError(`rule "${r.id}" states no requirement`)
    }

    if (!nonEmpty(r.regulation) || !known.has(r.regulation)) {
      throw new PolicyContractError(
        `rule "${r.id}" cites regulation "${String(r.regulation)}", which this ` +
          'set does not carry. A citation that resolves to nothing cannot be checked.',
      )
    }

    const check = r.check
    if (!isRecord(check) || !nonEmpty(check.kind)) {
      throw new PolicyContractError(`rule "${r.id}" has no check`)
    }
    if (!(CHECK_KINDS as readonly string[]).includes(check.kind)) {
      throw new PolicyContractError(
        `rule "${r.id}" needs check "${check.kind}", which this deployment cannot ` +
          `perform. Known kinds: ${CHECK_KINDS.join(', ')}. The set is refused rather ` +
          'than loaded without it — skipping a rule reports compliance against a ' +
          'requirement that was never applied.',
      )
    }

    validateProvenance(r, known, docs)

    for (const [field, allowed] of [
      ['status', ['draft', 'active', 'superseded']],
      ['severity', ['blocking', 'advisory']],
      ['automation', ['advisory', 'assisted', 'automatic']],
    ] as const) {
      if (!allowed.includes(r[field] as never)) {
        throw new PolicyContractError(
          `rule "${r.id}" has ${field} "${String(r[field])}"; expected one of ${allowed.join(', ')}`,
        )
      }
    }
  }

  return value as unknown as PolicySet
}

/**
 * A rule derived from a document: is it checkable, and did a person enact it?
 *
 * THE GOVERNING PRINCIPLE, TURNED ON THE POLICY ITSELF. A model may read a
 * regulation and propose rules; it may never enact one. If a machine-extracted
 * rule could become enforceable without a person signing it, the model would
 * be deciding what the law says — the same failure this system refuses for
 * labels, one level up and with wider blast radius, because a wrong rule is
 * wrong for every submission rather than one.
 *
 * A proposal is welcome. It is simply `draft` until somebody signs it, which
 * is what lets an LLM-assisted knowledge base be useful without being
 * authoritative.
 */
function validateProvenance(
  rule: Record<string, unknown>,
  _regulations: ReadonlySet<string>,
  documents: ReadonlySet<string>,
): void {
  // Checked before the early return: an approval that names nobody is wrong
  // whether or not the rule was derived from a document. This sat inside the
  // provenance branch and so was skipped for hand-written rules — the approval
  // is the load-bearing part of D27, and it must not be conditional on how the
  // rule was authored.
  if (rule.approval !== undefined) {
    if (!isRecord(rule.approval) || !nonEmpty(rule.approval.by)) {
      throw new PolicyContractError(`rule "${rule.id}" has an approval that names nobody`)
    }
    // Enacting is an entitlement, not a matter of filling in a field. A rule
    // approved by somebody who does not hold the role has not been reviewed by
    // anyone who could review it (D27).
    if (!userMay(String(rule.approval.by), 'policy-approver')) {
      throw new PolicyContractError(
        `rule "${rule.id}" is approved by "${String(rule.approval.by)}", who is not a ` +
          'registered policy-approver.',
      )
    }
    // Separation of duty. A proposal signed off by the person who made it is
    // not a review, and a review is what D27 asks for.
    const proposer = (rule.provenance as { proposedBy?: unknown } | undefined)?.proposedBy
    if (proposer !== undefined && proposer === rule.approval.by) {
      throw new PolicyContractError(
        `rule "${rule.id}" is approved by the same person who proposed it. An approval ` +
          'by its own author is not a review.',
      )
    }
  }

  const p = rule.provenance
  // A rule someone simply wrote needs no ceremony.
  if (p === undefined) return
  if (!isRecord(p)) throw new PolicyContractError(`rule "${rule.id}" has a malformed provenance`)

  if (!nonEmpty(p.sourceDocument) || !documents.has(p.sourceDocument)) {
    throw new PolicyContractError(
      `rule "${rule.id}" cites source document "${String(p.sourceDocument)}", which ` +
        'this set does not carry. A rule whose source cannot be produced cannot be checked.',
    )
  }

  // Without the verbatim basis, reviewing one rule means re-reading the whole
  // regulation — which means, in practice, that nobody reviews it.
  if (!nonEmpty(p.quote)) {
    throw new PolicyContractError(
      `rule "${rule.id}" has no quote from its source. A reviewer needs the words ` +
        'the rule was drawn from, or the approval is a formality.',
    )
  }

  if (p.extractedBy !== 'human' && p.extractedBy !== 'model') {
    throw new PolicyContractError(`rule "${rule.id}" must say whether a human or a model read it`)
  }

  if (p.extractedBy === 'model') {
    // A model drafts; a PERSON puts it forward. Recording the tool and nobody
    // else leaves a proposal that arrived from no one — and a model cannot be
    // answerable for having judged the output worth proposing.
    //
    // With the approval below, this completes the chain D27 and §18.5a describe
    // between them: a model drafts, a person proposes, a person approves.
    if (!nonEmpty(p.proposedBy)) {
      throw new PolicyContractError(
        `rule "${rule.id}" was drafted by a model and names no proposer. Set ` +
          'provenance.proposedBy to whoever is answerable for putting it forward.',
      )
    }
    if (!userMay(String(p.proposedBy), 'policy-author')) {
      throw new PolicyContractError(
        `rule "${rule.id}" is proposed by "${String(p.proposedBy)}", who is not a ` +
          'registered policy-author. A name nobody recognises is not an attribution.',
      )
    }
    // Which reader proposed it, for the same reason a verdict records which
    // model produced it: an unattributed reading cannot be re-examined when
    // that reader turns out to have been wrong about something else.
    if (!nonEmpty(p.model)) {
      throw new PolicyContractError(
        `rule "${rule.id}" was extracted by a model but does not say which model`,
      )
    }
    if (rule.status === 'active' && !isRecord(rule.approval)) {
      throw new PolicyContractError(
        `rule "${rule.id}" was extracted by a model and is active, but carries no ` +
          'approval. A model may propose a rule; only a person may enact one. ' +
          'Leave it as a draft, or record who approved it.',
      )
    }
  }
}

/** What the application record says, as far as rule selection is concerned. */
export interface SelectionInputs {
  readonly productType?: string
}

/**
 * The rules governing this submission — a deterministic query (D25).
 *
 * A model never selects rules. The same label evaluated against different rule
 * sets on different days is worse than a wrong verdict, because nothing in the
 * output would reveal it happened.
 *
 * `on` is the submission's own date, not today's. That is the whole reason the
 * archive carries effective dates: an application filed before a regulation
 * changed must be judged by the regulation that governed it.
 */
export function rulesFor(
  set: PolicySet,
  inputs: SelectionInputs,
  on: string,
): readonly PolicyRule[] {
  return set.rules.filter((rule) => {
    // Draft and superseded rules are carried so the history stays readable —
    // D27 supersedes rather than deletes — but only active ones are applied.
    if (rule.status !== 'active') return false

    if (rule.effectiveFrom !== null && on < rule.effectiveFrom) return false
    if (rule.effectiveTo !== null && on >= rule.effectiveTo) return false

    const types = rule.appliesWhen.productType
    if (types !== undefined && types.length > 0) {
      if (inputs.productType === undefined) return false
      if (!types.includes(inputs.productType)) return false
    }

    return true
  })
}
