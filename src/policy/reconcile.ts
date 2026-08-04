/**
 * Bringing the archive rows into agreement with the reviewed file (D45, §18.8.3).
 *
 * `config/policy-set.json` says what we intend the rules to be, and is changed
 * by a person through a diff somebody reads. These rows say what we actually
 * applied and between when, which a file cannot: superseding edits a file in
 * place, and the previous wording then survives only in git.
 *
 * ---------------------------------------------------------------------------
 * SEEDING IS THE TRANSACTION
 *
 * Reconciliation is not a data load that happens to run at deploy. It IS the
 * policy change — the moment a reviewed edit becomes something this deployment
 * applies — so it is what emits the `policy.rule.*` events into the same hash
 * chain as the verdicts. Before this, `subject_type = 'config'` was a subject
 * type declared in `0001_init.sql` that nothing had ever written, and the
 * policy's history lived in a git log that is neither the audit trail nor
 * tamper-evident to an auditor.
 *
 * Two properties make that safe to run on every deploy:
 *
 *   IDEMPOTENT   the same file applied twice produces one set of rows and one
 *                set of events. The deploy RECORDS a change rather than being
 *                one.
 *   APPEND-ONLY  it can add to the history and close a window. It can never
 *                rewrite what the record says was applied — the database
 *                refuses that outright (migration 0007).
 *
 * The planning half below is pure, so the part with the compliance content is
 * tested without a database — the same split as `buildPersistPlan`.
 */

import type { PolicyRule } from '../domain/policy.js'

/** A rule as the reviewed file states it, paired with the digest of its body. */
export interface SourceRule {
  readonly rule: PolicyRule
  /** Digest of the rule as applied. Decides whether this counts as a change. */
  readonly digest: string
}

/** A row as the archive currently holds it — the open window for one rule. */
export interface ArchivedRule {
  readonly id: string
  readonly ruleId: string
  readonly bodyDigest: string
}

/**
 * What reconciliation will do, decided before anything is written.
 *
 * `supersede` carries both halves because they are one act: the predecessor's
 * window closes and the successor opens in the same batch, so the archive is
 * never momentarily saying two things about one rule.
 */
export type ReconcileAction =
  | { readonly kind: 'insert'; readonly source: SourceRule }
  | { readonly kind: 'supersede'; readonly closes: ArchivedRule; readonly source: SourceRule }
  | { readonly kind: 'retire'; readonly closes: ArchivedRule }

/**
 * The keys that are not the rule.
 *
 * `$examples` and `$draftNote` are annotations for a human reading the file.
 * Editing one is not a policy change, and treating it as one would supersede a
 * rule — writing a new row and an audit event — because somebody improved a
 * comment. The digest covers what the engine actually applies.
 */
const isAnnotation = (key: string) => key.startsWith('$')

/**
 * The rule as applied, in a form whose digest cannot depend on key order.
 *
 * Key order is an implementation detail of whoever last edited the JSON, and a
 * digest that moved when a formatter reordered a literal would report a policy
 * change that did not happen.
 */
export function canonicalRuleBody(rule: PolicyRule): string {
  return JSON.stringify(sortDeep(rule))
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep)
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !isAnnotation(key))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return Object.fromEntries(entries.map(([key, v]) => [key, sortDeep(v)]))
  }
  return value
}

/**
 * Decide what the archive must do to agree with the file.
 *
 * Pure, and deliberately: this is where a wrong answer would rewrite policy
 * history, so it is tested against cases rather than against a database.
 */
export function planReconciliation(
  source: readonly SourceRule[],
  current: readonly ArchivedRule[],
): readonly ReconcileAction[] {
  const open = new Map(current.map((row) => [row.ruleId, row]))
  const actions: ReconcileAction[] = []

  for (const entry of source) {
    const existing = open.get(entry.rule.id)
    if (existing === undefined) {
      actions.push({ kind: 'insert', source: entry })
      continue
    }
    // Seen, and unchanged. Doing nothing here is what makes a redeploy free —
    // and what stops the audit chain filling with events for a file nobody
    // edited.
    if (existing.bodyDigest !== entry.digest) {
      actions.push({ kind: 'supersede', closes: existing, source: entry })
    }
    open.delete(entry.rule.id)
  }

  // Whatever is still open was not in the file. Its window closes and the row
  // stays: a rule removed from the file is retired, never deleted (D27), or the
  // verdicts that cite it lose the thing they were judged by.
  for (const orphan of open.values()) {
    actions.push({ kind: 'retire', closes: orphan })
  }

  return actions
}

/** Which audit verb an action announces. */
export function actionEvent(action: ReconcileAction): string {
  if (action.kind === 'retire') return 'policy.rule.retired'
  if (action.kind === 'supersede') return 'policy.rule.superseded'
  // An unapproved proposal is recorded as proposed, not enacted. It seeds as a
  // row so it can be reviewed in place, and selection never sees it (§18.5a).
  return action.source.rule.status === 'active' ? 'policy.rule.enacted' : 'policy.rule.proposed'
}

/** Nothing to say. Reported rather than inferred from an empty action list. */
export const NOTHING_TO_DO = 'the archive already agrees with the reviewed file'

/** A one-line account of what a reconciliation did, for the deploy log. */
export function describeReconciliation(actions: readonly ReconcileAction[]): string {
  if (actions.length === 0) return NOTHING_TO_DO
  const counted = new Map<string, number>()
  for (const action of actions) counted.set(action.kind, (counted.get(action.kind) ?? 0) + 1)
  return [...counted.entries()].map(([kind, n]) => `${n} ${kind}`).join(', ')
}
