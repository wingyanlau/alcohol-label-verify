/**
 * The event stream, as something other tooling can consume.
 *
 * "Give me the logs" has two answers here and they are different things.
 *
 * **Transient runtime logs** — what `emit()` writes — go to the platform's own
 * pipeline (`wrangler tail`, Logpush). They are operational: a request failed,
 * a rate limit was waited out. Nothing in this system stores them, and a
 * monitoring stack should read them from the platform rather than from here.
 *
 * **The durable event stream** is `audit_event`, and it is what this endpoint
 * serves. Every act that changed the record — a job opened, a verdict written,
 * a decision taken, a rule enacted, an audit concluded — with the agent that
 * performed it. It is the log that matters for anything asking *what happened
 * to this application*, and unlike a log file it is hash-chained: each event
 * commits to the one before it.
 *
 * ---------------------------------------------------------------------------
 * WHY THAT MATTERS FOR AN INTEGRATION
 *
 * Most log APIs hand a consumer lines it has to trust. This one hands over the
 * digests too, so a downstream system can **verify the chain itself** rather
 * than taking the exporter's word for it. A monitoring stack that re-computes
 * the chain is checking the source system, not merely charting it.
 *
 * **Content is absent by construction** (D20). `detail` carries identifiers,
 * classifications and versions — never artwork, never a value read from a
 * label — so exporting the stream wholesale cannot leak an applicant's
 * submission. That is a property of what was written, not a filter applied on
 * the way out, which is why it can be relied on.
 */

export interface EventQuery {
  /** Exclusive lower bound on `seq`. The cursor: monotonic, stable, gapless. */
  readonly afterSeq: number
  readonly limit: number
  readonly action?: string | undefined
  readonly actorKind?: string | undefined
  readonly subjectType?: string | undefined
  /** ISO instants, inclusive. */
  readonly since?: string | undefined
  readonly until?: string | undefined
}

/** The largest page this will serve, however large a caller asks for. */
export const MAX_PAGE = 1000
export const DEFAULT_PAGE = 200

/**
 * Read a query out of a URL, refusing nonsense rather than coercing it.
 *
 * A limit of `abc` is a caller bug and returning 200 rows for it hides that.
 * Everything here has a default, so the endpoint is usable with no parameters
 * at all — a consumer's first call should not need documentation.
 */
export function parseEventQuery(url: URL): EventQuery {
  const num = (name: string, fallback: number): number => {
    const raw = url.searchParams.get(name)
    if (raw === null || raw.trim() === '') return fallback
    const value = Number(raw)
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback
  }
  const str = (name: string): string | undefined => {
    const raw = url.searchParams.get(name)
    return raw === null || raw.trim() === '' ? undefined : raw.trim()
  }
  return {
    afterSeq: num('afterSeq', 0),
    limit: Math.min(num('limit', DEFAULT_PAGE), MAX_PAGE),
    action: str('action'),
    actorKind: str('actorKind'),
    subjectType: str('subjectType'),
    since: str('since'),
    until: str('until'),
  }
}

/** The SQL, built from a query. Parameterised — none of this is interpolated. */
export function eventSql(q: EventQuery): { sql: string; binds: unknown[] } {
  const where: string[] = ['seq > ?']
  const binds: unknown[] = [q.afterSeq]

  // Each filter is a column comparison rather than a string match, so a
  // consumer filtering on `action` gets exactly the actions it named.
  if (q.action !== undefined) {
    where.push('action = ?')
    binds.push(q.action)
  }
  if (q.actorKind !== undefined) {
    where.push('actor_kind = ?')
    binds.push(q.actorKind)
  }
  if (q.subjectType !== undefined) {
    where.push('subject_type = ?')
    binds.push(q.subjectType)
  }
  if (q.since !== undefined) {
    where.push('at >= ?')
    binds.push(q.since)
  }
  if (q.until !== undefined) {
    where.push('at <= ?')
    binds.push(q.until)
  }

  binds.push(q.limit)
  return {
    sql: `SELECT seq, at, action, actor, actor_kind, actor_id, subject_type, subject_id,
              detail, prev_digest, digest
         FROM audit_event
        WHERE ${where.join(' AND ')}
        ORDER BY seq ASC
        LIMIT ?`,
    binds,
  }
}

export interface EventRow {
  seq: number
  at: string
  action: string
  actor: string | null
  actor_kind: string | null
  actor_id: string | null
  subject_type: string | null
  subject_id: string | null
  detail: string | null
  prev_digest: string | null
  digest: string
}

/**
 * One event, in the shape a consumer reads.
 *
 * Renamed to camelCase at the boundary on purpose: the column names are this
 * deployment's schema and a consumer should not be coupled to a migration.
 */
export function toEvent(row: EventRow) {
  return {
    seq: row.seq,
    at: row.at,
    action: row.action,
    agent: {
      kind: row.actor_kind ?? row.actor ?? 'unknown',
      id: row.actor_id ?? null,
    },
    subject: { type: row.subject_type, id: row.subject_id },
    // Identifiers and classifications only. See the module comment.
    detail: row.detail,
    chain: { previous: row.prev_digest, digest: row.digest },
  }
}

/**
 * The next cursor, or null at the end of the stream.
 *
 * Null rather than repeating the last sequence, so a poller can tell "you have
 * everything" from "there is more" without comparing counts to the page size —
 * which is the classic way a consumer silently stops at a page boundary.
 */
export function nextCursor(rows: readonly EventRow[], limit: number): number | null {
  if (rows.length < limit) return null
  return rows[rows.length - 1]?.seq ?? null
}
