/**
 * Reading and writing the policy archive rows (§18.8.3).
 *
 * The thin half. `reconcile.ts` decides what should happen and is pure; this
 * carries it out, which is the same split as `buildPersistPlan` / `persistResult`
 * and for the same reason: the part with the compliance content is testable
 * without a database, and the part that touches one has no judgement in it.
 */

import { type Agent, DEPLOY_AGENT, humanAgent } from '../batch/agent.js'
import { appendAudit } from '../batch/audit.js'
import { sha256Hex } from '../batch/digest.js'
import { POLICY_SET } from '../domain/findings.js'
import type { PolicyRule } from '../domain/policy.js'
import {
  type ArchivedRule,
  actionEvent,
  canonicalRuleBody,
  describeReconciliation,
  planReconciliation,
  type ReconcileAction,
  type SourceRule,
} from './reconcile.js'

/** Digest of the rule as applied. Annotations are excluded — see reconcile.ts. */
export async function ruleDigest(rule: PolicyRule): Promise<string> {
  return (await sha256Hex(canonicalRuleBody(rule))).slice(0, 32)
}

/** Pair each reviewed rule with the digest that decides whether it changed. */
export async function sourceRules(rules: readonly PolicyRule[]): Promise<SourceRule[]> {
  return Promise.all(rules.map(async (rule) => ({ rule, digest: await ruleDigest(rule) })))
}

/** The open window for every rule the archive currently holds. */
export async function currentRules(db: D1Database): Promise<ArchivedRule[]> {
  const { results } = await db
    .prepare(
      `SELECT id, rule_id AS ruleId, body_digest AS bodyDigest
         FROM policy_rule WHERE retired_at IS NULL`,
    )
    .all<ArchivedRule>()
  return results
}

/**
 * The rule set as it stood for a filing on `validOn`, as this deployment
 * understood it at `asOf` (D41, D42).
 *
 * Two windows, because they answer different questions. Valid time says which
 * submission dates a rule governs — the law's timeline. Transaction time says
 * when this deployment held it — ours. A verdict binds both, so the exact set
 * that produced it can be rebuilt however far in the future somebody asks.
 *
 * Drafts are excluded here rather than by the caller. A rule nobody enacted is
 * not part of any rule set, and leaving that to a filter downstream is how it
 * eventually gets forgotten (§18.5a).
 */
export async function ruleSetAsAt(
  db: D1Database,
  validOn: string,
  asOf: string,
): Promise<PolicyRule[]> {
  const { results } = await db
    .prepare(
      `SELECT body FROM policy_rule
        WHERE status = 'active'
          AND recorded_at <= ?2
          AND (retired_at     IS NULL OR retired_at     >  ?2)
          AND (effective_from IS NULL OR effective_from <= ?1)
          AND (effective_to   IS NULL OR effective_to   >  ?1)
        ORDER BY rule_id`,
    )
    .bind(validOn, asOf)
    .all<{ body: string }>()
  return results.map((row) => JSON.parse(row.body) as PolicyRule)
}

/**
 * Whether the rows still agree with the reviewed file.
 *
 * The cost of keeping both representations (D45, §18.8.8). Rows are derived and
 * never hand-authored, but nothing physically stops them drifting — a
 * reconciliation that half-ran, a deploy that skipped it, a hand-edited row.
 *
 * Reported as a startup condition rather than discovered later, on the same
 * reasoning as the retention policy (D32): a deployment enforcing rules that
 * are not the ones anybody reviewed is a false statement about what it does,
 * and nothing else in the system would reveal it.
 *
 * `pending` is simply what a reconciliation would still do. Zero means the file
 * and the rows say the same thing.
 */
export async function archiveHealth(
  db: D1Database,
  rules: readonly PolicyRule[],
): Promise<{
  rows: number
  pending: number
  inSync: boolean
  summary: string
}> {
  const current = await currentRules(db)
  const actions = planReconciliation(await sourceRules(rules), current)
  return {
    rows: current.length,
    pending: actions.length,
    inSync: actions.length === 0,
    summary: describeReconciliation(actions),
  }
}

/** One rule as a reviewer needs to see it (ui-design §2.3). */
export interface ArchiveEntry {
  readonly ruleId: string
  readonly status: string
  readonly severity: string
  readonly requirement: string
  readonly regulation: string | null
  readonly productTypes: readonly string[]
  /** Valid time: the submission dates this rule governs. */
  readonly effectiveFrom: string | null
  readonly effectiveTo: string | null
  /** Transaction time: when this deployment held it. */
  readonly recordedAt: string
  readonly retiredAt: string | null
  readonly approvedBy: string | null
  readonly approvedAt: string | null
  /**
   * Whether that approval is the set's rather than the rule's own.
   *
   * Shown, not hidden: "covered by the set's approval" and "this person signed
   * this rule" are different assurances, and a reviewer deciding whether to
   * trust a rule should be told which one they have.
   */
  readonly approvalInherited: boolean
  /** The words it was drawn from, where the rule records any. */
  readonly quote: string | null
  readonly sourceDocument: string | null
  readonly proposedBy: string | null
}

/**
 * The archive, as a person would read it.
 *
 * Read from the ROWS rather than the file, because the rows are what is
 * actually enforced and the only place the two time windows exist. The file
 * states intent; this states what is in force and since when.
 *
 * Everything, including retired rules: a reviewer asking why a verdict said
 * what it did needs the rule that governed it then, not only the ones
 * governing now (D27 — supersede, never delete).
 */
export async function listArchive(db: D1Database): Promise<ArchiveEntry[]> {
  const { results } = await db
    .prepare(
      `SELECT rule_id, status, severity, body, regulation_id, citation,
              effective_from, effective_to, recorded_at, retired_at,
              approved_by, approved_at, quote, source_document_id
         FROM policy_rule
        ORDER BY retired_at IS NOT NULL, status, rule_id, recorded_at DESC`,
    )
    .all<{
      rule_id: string
      status: string
      severity: string
      body: string
      regulation_id: string | null
      citation: string | null
      effective_from: string | null
      effective_to: string | null
      recorded_at: string
      retired_at: string | null
      approved_by: string | null
      approved_at: string | null
      quote: string | null
      source_document_id: string | null
    }>()

  return results.map((r) => {
    // The requirement and the product types live in the stored body — the rule
    // as applied, not as the file reads today.
    let rule: PolicyRule | null = null
    try {
      rule = JSON.parse(r.body) as PolicyRule
    } catch {
      // A body that cannot be parsed is still a row worth listing: the reviewer
      // should see that it exists and is unreadable, rather than not see it.
    }
    return {
      ruleId: r.rule_id,
      status: r.status,
      severity: r.severity,
      requirement: rule?.requirement ?? '(this rule could not be read)',
      regulation: r.citation ?? r.regulation_id,
      productTypes: rule?.appliesWhen?.productType ?? [],
      effectiveFrom: r.effective_from,
      effectiveTo: r.effective_to,
      recordedAt: r.recorded_at,
      retiredAt: r.retired_at,
      // Who is answerable, resolved the same way the finding and the enactment
      // resolve it — and NOT the same way for a draft.
      //
      // A rule in force was approved: D27 admits no other way for it to be in
      // force, and where it names no approver of its own the SET's covers it.
      // A draft has not been approved by anyone, and inheriting there would
      // put a person's name against a rule they have not seen — which is the
      // exact claim this screen exists to let them make or withhold.
      approvedBy: r.approved_by ?? (r.status === 'active' ? (POLICY_SET.approvedBy ?? null) : null),
      approvedAt: r.approved_at,
      /** True when the approval is the set's rather than the rule's own. */
      approvalInherited: r.approved_by === null && r.status === 'active',
      quote: r.quote,
      sourceDocument: r.source_document_id,
      proposedBy: rule?.provenance?.model ?? rule?.provenance?.extractedBy ?? null,
    }
  })
}

/** What a reconciliation did, for the deploy to report and CI to assert on. */
export interface ReconcileReport {
  readonly reconciliationId: string
  readonly at: string
  readonly actions: number
  readonly summary: string
  readonly events: readonly string[]
}

/**
 * Bring the rows into agreement with the reviewed file, and say so in the chain.
 *
 * The rows are written first and the chain appended after, deliberately — the
 * same ordering as a decision. An audit entry for a policy change that failed
 * to store would be a claim about something that never happened, which is worse
 * in an audit trail than a change whose entry is missing and recoverable from
 * the rows it describes.
 *
 * `now` and `reconciliationId` are supplied rather than read: this module is
 * outside the pure core, but a caller that cannot control them cannot test it.
 */
export async function reconcileArchive(
  db: D1Database,
  rules: readonly PolicyRule[],
  opts: {
    readonly now: string
    readonly reconciliationId: string
    /**
     * Who approved the SET, for a rule that names no approver of its own.
     *
     * D27 is that no rule reaches force without named human approval, and the
     * agent invariant (§19.2) turned that from a sentence into something that
     * fails: enacting a rule attributed to the deployment was refused, because
     * a system agent may not decide. Falling back to the set's approver is the
     * honest resolution — the set IS approved by a named person, and a rule
     * inside it inherits that unless it names its own.
     */
    readonly setApprovedBy?: string
    readonly actor?: string
  },
): Promise<ReconcileReport> {
  const actions = planReconciliation(await sourceRules(rules), await currentRules(db))
  const events: string[] = []

  if (actions.length > 0) {
    await db.batch(actions.flatMap((action) => statementsFor(db, action, opts)))

    for (const action of actions) {
      const ruleId = action.kind === 'retire' ? action.closes.ruleId : action.source.rule.id
      await appendAudit(db, {
        at: opts.now,
        // Not 'system': a policy change has a person behind it, and the file
        // carries who approved the rule.
        // The person who signed the rule when the file names one; the
        // deployment otherwise. A proposal has no approver by definition.
        agent: agentFor(action, opts.setApprovedBy),
        actor: approverOf(action) ?? opts.setApprovedBy ?? opts.actor ?? 'system',
        action: actionEvent(action),
        // 'config' — declared in 0001_init.sql and, until now, never written.
        subjectType: 'config',
        subjectId: ruleId,
        // Identifiers and classifications only (D20). The rule body is not a
        // label value, but it is bulky and it already lives in a row that this
        // digest identifies exactly.
        detail: JSON.stringify({
          reconciliationId: opts.reconciliationId,
          kind: action.kind,
          digest: action.kind === 'retire' ? action.closes.bodyDigest : action.source.digest,
          ...(action.kind === 'retire' ? {} : { status: action.source.rule.status }),
        }),
      })
      events.push(actionEvent(action))
    }
  }

  return {
    reconciliationId: opts.reconciliationId,
    at: opts.now,
    actions: actions.length,
    summary: describeReconciliation(actions),
    events,
  }
}

/**
 * The agent an action is attributed to.
 *
 * Enacting is a decision and only a person may make one (§19.2). A rule names
 * its own approver, or inherits the set's; a retirement or a proposal is the
 * deployment applying what was reviewed, which is the system and is not a
 * decision.
 */
function agentFor(action: ReconcileAction, setApprovedBy: string | undefined): Agent {
  if (actionEvent(action) !== 'policy.rule.enacted') return DEPLOY_AGENT
  const by = approverOf(action) ?? setApprovedBy
  // Refused rather than attributed to nobody. An enactment this system cannot
  // name a person for is one D27 says should not be happening.
  if (by === undefined || by.trim() === '') return DEPLOY_AGENT
  return humanAgent(by)
}

/** Who signed the rule this action is about, when the file names anyone. */
function approverOf(action: ReconcileAction): string | null {
  if (action.kind === 'retire') return null
  return action.source.rule.approval?.by ?? null
}

/**
 * The writes for one action.
 *
 * A supersede is two statements in one batch — close, then open — so the
 * archive is never momentarily saying two things about one rule, or nothing at
 * all about it.
 */
function statementsFor(
  db: D1Database,
  action: ReconcileAction,
  opts: { readonly now: string; readonly reconciliationId: string },
): D1PreparedStatement[] {
  const close = (rowId: string) =>
    db
      .prepare(`UPDATE policy_rule SET retired_at = ? WHERE id = ? AND retired_at IS NULL`)
      .bind(opts.now, rowId)

  if (action.kind === 'retire') return [close(action.closes.id)]

  const { rule, digest } = action.source
  const insert = db
    .prepare(
      `INSERT INTO policy_rule
         (id, rule_id, body_digest, body, effective_from, effective_to,
          recorded_at, retired_at, status, severity, regulation_id, citation,
          source_document_id, quote, approved_by, approved_at, recorded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      `${rule.id}@${digest.slice(0, 12)}`,
      rule.id,
      digest,
      canonicalRuleBody(rule),
      rule.effectiveFrom,
      rule.effectiveTo,
      opts.now,
      rule.status,
      rule.severity,
      rule.regulation,
      null,
      rule.provenance?.sourceDocument ?? null,
      rule.provenance?.quote ?? null,
      rule.approval?.by ?? null,
      rule.approval?.at ?? null,
      opts.reconciliationId,
    )

  return action.kind === 'supersede' ? [close(action.closes.id), insert] : [insert]
}
