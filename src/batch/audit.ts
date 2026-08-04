import { type Agent, checkAgentMay } from './agent.js'
/**
 * The append-only transaction history (D32, §11.2.1).
 *
 * What it is for: a verdict is only defensible if what produced it can be
 * named afterwards — which model, which prompt, which reference data, in which
 * order. The durable record holds the values; this holds the sequence, and
 * makes an alteration to either detectable.
 *
 * What it must never hold is content. Identifiers, classifications, versions
 * and timings only (D20). The reason is sharper here than elsewhere: a digest
 * cannot be redacted. Label artwork written into a chained history is beyond
 * the reach of any later retention decision, because removing it breaks the
 * evidence that the rest was not tampered with.
 */

/** An event as recorded. The chain digests exactly these fields. */
export interface AuditRow {
  readonly at: string
  /**
   * Who or what acted (D46).
   *
   * **Required.** Every act names its agent, or the invariant the concept
   * exists for — no model may decide — holds only while nobody writes the code
   * that breaks it. The compiler is what keeps it true.
   */
  readonly agent: Agent
  /**
   * The agent's display name, and the field the DIGEST covers.
   *
   * Derived from `agent`, and kept as its own field because it is what the
   * chain attests to. `actor_kind` and `actor_id` are an index over this, are
   * outside the digest, and are rebuildable from it — see 0009.
   */
  readonly actor: string
  readonly action: string
  readonly subjectType: 'job' | 'submission' | 'extraction' | 'verdict' | 'config'
  readonly subjectId: string
  /** Identifiers, classifications and versions. Never a label value. */
  readonly detail: string | null
}

export interface ChainedRow {
  readonly row: AuditRow
  readonly prevDigest: string
  readonly digest: string
  /** Present when read back; absent when a chain is built in a test. */
  readonly seq?: number
}

/** The chain's first link. */
export const GENESIS = '0'.repeat(64)

/**
 * Deterministic serialisation.
 *
 * Field order is fixed here rather than taken from object key order, which is
 * an implementation detail no digest should depend on: a refactor that
 * reordered a literal would silently invalidate every prior link.
 */
export function canonical(row: AuditRow): string {
  return [row.at, row.actor, row.action, row.subjectType, row.subjectId, row.detail ?? ''].join('')
}

/** `sha256(prevDigest || canonical(row))`, hex. */
export async function chainDigest(prevDigest: string, row: AuditRow): Promise<string> {
  const bytes = new TextEncoder().encode(`${prevDigest}${canonical(row)}`)
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Recompute the chain.
 *
 * Returns the index of the first row that does not follow from its
 * predecessor, or null when the whole sequence holds. An index rather than a
 * boolean because "something was altered" is not actionable and "the third
 * event was altered" is.
 */
export async function verifyChain(rows: readonly ChainedRow[]): Promise<number | null> {
  let expectedPrev = GENESIS
  for (let i = 0; i < rows.length; i++) {
    const entry = rows[i]
    if (entry === undefined) return i
    if (entry.prevDigest !== expectedPrev) return i
    if ((await chainDigest(entry.prevDigest, entry.row)) !== entry.digest) return i
    expectedPrev = entry.digest
  }
  return null
}

/**
 * Append one event, atomically.
 *
 * A hash chain read-modify-written by concurrent workers is a race: two items
 * settling together read the same tail, compute from the same predecessor, and
 * the second silently orphans the first. `max_concurrency: 1` makes that
 * unlikely today and would not survive raising it, which is exactly the class
 * of bug that appears in production and never in development.
 *
 * So the insert is conditional on the tail not having moved — the same atomic
 * contract the coordinator holds itself to (deployment-path R3). A losing
 * writer inserts nothing, re-reads and tries again.
 */
export async function appendAudit(db: D1Database, row: AuditRow, attempts = 5): Promise<boolean> {
  // The principle, enforced where the act is recorded rather than left to a
  // reviewer noticing later (§19.2). A model agent reaching this with a
  // deciding action is a defect in the caller, and it should not become a row.
  checkAgentMay(row.agent, row.action)

  for (let attempt = 0; attempt < attempts; attempt++) {
    const tail = await db
      .prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM audit_event')
      .first<{ seq: number }>()
    const tailSeq = tail?.seq ?? 0

    const prev =
      tailSeq === 0
        ? GENESIS
        : ((
            await db
              .prepare('SELECT digest FROM audit_event WHERE seq = ?')
              .bind(tailSeq)
              .first<{ digest: string }>()
          )?.digest ?? GENESIS)

    const digest = await chainDigest(prev, row)

    const result = await db
      .prepare(
        `INSERT INTO audit_event
           (at, actor, action, subject_type, subject_id, detail, prev_digest, digest,
            actor_kind, actor_id)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE (SELECT COALESCE(MAX(seq), 0) FROM audit_event) = ?`,
      )
      .bind(
        row.at,
        row.actor,
        row.action,
        row.subjectType,
        row.subjectId,
        row.detail,
        prev,
        digest,
        row.agent.kind,
        row.agent.id,
        tailSeq,
      )
      .run()

    if ((result.meta?.changes ?? 0) > 0) return true
  }
  // The caller must not fail an item for this. A verdict that was reached is
  // still a verdict; an unrecorded event is a gap in the history, and saying
  // so is better than discarding the work that produced it.
  return false
}

/**
 * Read the chain back, oldest first.
 *
 * `limit` is a page size, not a ceiling — see `readWholeChain`. A verifier that
 * silently examined a prefix and reported "ok" would be worse than no verifier,
 * because it would answer the question it was asked with evidence about a
 * different question.
 */
export async function readChain(db: D1Database, limit = 1000, afterSeq = 0): Promise<ChainedRow[]> {
  const { results } = await db
    .prepare(
      `SELECT seq, at, actor, action, subject_type, subject_id, detail, prev_digest, digest,
              actor_kind, actor_id
         FROM audit_event WHERE seq > ? ORDER BY seq ASC LIMIT ?`,
    )
    .bind(afterSeq, limit)
    .all<{
      seq: number
      at: string
      actor: string
      action: string
      subject_type: string
      subject_id: string
      detail: string | null
      prev_digest: string
      digest: string
      actor_kind: string | null
      actor_id: string | null
    }>()

  return results.map((r) => ({
    row: {
      at: r.at,
      // Rebuilt from the index. `actor` is what the digest covers; the kind is
      // a classification of it, so an entry whose columns were never backfilled
      // still verifies — it simply says less about who acted.
      agent: {
        kind: (r.actor_kind ?? 'system') as Agent['kind'],
        id: r.actor_id ?? r.actor,
        display: r.actor,
      },
      actor: r.actor,
      action: r.action,
      subjectType: r.subject_type as AuditRow['subjectType'],
      subjectId: r.subject_id,
      detail: r.detail,
    },
    prevDigest: r.prev_digest,
    digest: r.digest,
    seq: r.seq,
  }))
}

/**
 * Every event, in pages.
 *
 * The chain is append-only and unbounded; a verification that stopped at a
 * fixed count would report a healthy prefix while an alteration sat beyond it.
 * Paging costs a few round trips and removes an entire class of false
 * assurance.
 */
export async function readWholeChain(db: D1Database, pageSize = 1000): Promise<ChainedRow[]> {
  const all: ChainedRow[] = []
  let after = 0
  for (;;) {
    const page = await readChain(db, pageSize, after)
    if (page.length === 0) return all
    all.push(...page)
    after = page[page.length - 1]?.seq ?? after
    if (page.length < pageSize) return all
  }
}
