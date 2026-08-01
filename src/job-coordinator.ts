/**
 * Job coordination.
 *
 * Design reference: batch-backend-design.md §5 (job model), §7 (streaming),
 * §15.3 (why a Durable Object), B-D12; deployment-path.md §5.1 and R3.
 *
 * ---------------------------------------------------------------------------
 * TWO CONSTRAINTS GOVERN THIS FILE. Both exist to survive the port to a
 * container, where neither is free.
 *
 *   1. EVERY PUBLIC OPERATION IS ATOMIC BY CONTRACT (R3).
 *      No caller may read state, decide, and write it back. `claimNextItem`
 *      and `recordResult` each resolve in a single conditional statement, so
 *      the guarantee comes from the statement rather than from this class
 *      being single-threaded.
 *
 *      A Durable Object serialises per object, so read-modify-write would
 *      appear correct here and would race behind multiple container replicas.
 *      That bug does not exist in development — it appears under concurrency,
 *      in production, intermittently. Writing to the atomic contract now is
 *      what makes the coordinator portable.
 *
 *   2. THE COORDINATOR PERFORMS NO I/O BEYOND ITS OWN STORAGE (B-D12).
 *      No fetch, no R2, no D1, no extraction. It records state and fans out.
 *      Its 6-connection cap and per-object throughput make that a hard
 *      boundary rather than a stylistic preference. Item workers write the
 *      durable record to D1 themselves and then tell the coordinator.
 * ---------------------------------------------------------------------------
 */

import { DurableObject } from 'cloudflare:workers'
import type { Env } from './index.js'

export type ItemState = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'REJECTED'

/** Outcome vocabulary is the domain's; the coordinator only stores it. */
export type Outcome = 'CLEAR' | 'CLEAR_CONFIRM_FLAGGED' | 'DISCREPANCIES_FOUND' | 'INCOMPLETE'

export interface ItemRef {
  readonly itemId: string
  readonly sourceName: string
  readonly attempts: number
}

export interface Progress {
  readonly total: number
  readonly queued: number
  readonly running: number
  readonly completed: number
  readonly failed: number
  readonly done: boolean
}

export interface ItemRow {
  readonly itemId: string
  readonly sourceName: string
  readonly state: ItemState
  readonly outcome: Outcome | null
  readonly summary: string | null
  readonly cause: string | null
  readonly attempts: number
}

export interface Snapshot {
  readonly jobId: string | null
  readonly openedAt: string | null
  readonly progress: Progress
  readonly items: readonly ItemRow[]
}

type Event =
  | { type: 'snapshot'; snapshot: Snapshot }
  | { type: 'item.started'; itemId: string; progress: Progress }
  | { type: 'item.completed'; item: ItemRow; progress: Progress }
  | { type: 'item.failed'; item: ItemRow; progress: Progress }
  | { type: 'job.completed'; progress: Progress }

export class JobCoordinator extends DurableObject<Env> {
  #sql: SqlStorage

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.#sql = ctx.storage.sql
    // Cheap and idempotent; the object may be recreated after hibernation.
    this.#sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS item (
        seq         INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id     TEXT NOT NULL UNIQUE,
        source_name TEXT NOT NULL,
        state       TEXT NOT NULL,
        outcome     TEXT,
        summary     TEXT,
        cause       TEXT,
        attempts    INTEGER NOT NULL DEFAULT 0,
        updated_at  TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS item_by_state ON item (state, seq);
    `)
  }

  // -------------------------------------------------------------------------
  // Operations. Each resolves atomically — see constraint 1 above.
  // -------------------------------------------------------------------------

  /**
   * Open the job and seed its ledger. Idempotent: re-opening with the same
   * items is safe, so a retried intake cannot duplicate work.
   */
  async open(jobId: string, items: readonly { itemId: string; sourceName: string }[]) {
    const now = new Date().toISOString()
    this.#sql.exec(
      `INSERT INTO meta (key, value) VALUES ('job_id', ?), ('opened_at', ?)
       ON CONFLICT(key) DO NOTHING`,
      jobId,
      now,
    )
    for (const it of items) {
      this.#sql.exec(
        `INSERT INTO item (item_id, source_name, state, updated_at)
         VALUES (?, ?, 'QUEUED', ?)
         ON CONFLICT(item_id) DO NOTHING`,
        it.itemId,
        it.sourceName,
        now,
      )
    }
    return this.#progress()
  }

  /**
   * Claim the next queued item.
   *
   * A single conditional UPDATE ... RETURNING. Two concurrent callers cannot
   * both receive the same item, and the guarantee holds under any
   * implementation that supports conditional update — not only under a
   * Durable Object's serialisation (R3).
   */
  async claimNextItem(): Promise<ItemRef | null> {
    const rows = this.#sql
      .exec<{ item_id: string; source_name: string; attempts: number }>(
        `UPDATE item
            SET state = 'RUNNING', attempts = attempts + 1, updated_at = ?
          WHERE item_id = (
                SELECT item_id FROM item WHERE state = 'QUEUED' ORDER BY seq LIMIT 1
          )
      RETURNING item_id, source_name, attempts`,
        new Date().toISOString(),
      )
      .toArray()

    const row = rows[0]
    if (!row) return null

    this.#broadcast({ type: 'item.started', itemId: row.item_id, progress: this.#progress() })
    return { itemId: row.item_id, sourceName: row.source_name, attempts: row.attempts }
  }

  /**
   * Record a verdict.
   *
   * `INCOMPLETE` is a COMPLETED item, not a failure (B-D6): a label that could
   * not be read is a verdict, and treating it as a processing error would let
   * it be retried and reported as a system fault.
   */
  async recordResult(itemId: string, outcome: Outcome, summary: string): Promise<Progress> {
    this.#sql.exec(
      `UPDATE item SET state = 'COMPLETED', outcome = ?, summary = ?, cause = NULL,
                       updated_at = ?
        WHERE item_id = ? AND state IN ('RUNNING','QUEUED')`,
      outcome,
      summary,
      new Date().toISOString(),
      itemId,
    )
    return this.#settle(itemId, 'item.completed')
  }

  /** Record a processing failure — the item could not be evaluated at all. */
  async recordFailure(itemId: string, cause: string): Promise<Progress> {
    this.#sql.exec(
      `UPDATE item SET state = 'FAILED', cause = ?, updated_at = ?
        WHERE item_id = ? AND state IN ('RUNNING','QUEUED')`,
      cause,
      new Date().toISOString(),
      itemId,
    )
    return this.#settle(itemId, 'item.failed')
  }

  /** Return an item to the queue for a bounded retry (batch design §8). */
  async requeue(itemId: string): Promise<Progress> {
    this.#sql.exec(
      `UPDATE item SET state = 'QUEUED', updated_at = ? WHERE item_id = ? AND state = 'RUNNING'`,
      new Date().toISOString(),
      itemId,
    )
    return this.#progress()
  }

  /** Current ledger and counts. Subscribers receive this before any delta. */
  async snapshot(): Promise<Snapshot> {
    const items = this.#sql
      .exec<{
        item_id: string
        source_name: string
        state: string
        outcome: string | null
        summary: string | null
        cause: string | null
        attempts: number
      }>(`SELECT item_id, source_name, state, outcome, summary, cause, attempts
            FROM item ORDER BY seq`)
      .toArray()

    return {
      jobId: this.#meta('job_id'),
      openedAt: this.#meta('opened_at'),
      progress: this.#progress(),
      items: items.map((r) => ({
        itemId: r.item_id,
        sourceName: r.source_name,
        state: r.state as ItemState,
        outcome: r.outcome as Outcome | null,
        summary: r.summary,
        cause: r.cause,
        attempts: r.attempts,
      })),
    }
  }

  // -------------------------------------------------------------------------
  // Streaming. Subscribers attach at any time and receive a snapshot, then
  // deltas (§7.2) — which is what makes the connection disposable and lets a
  // job outlive a closed laptop lid (B7).
  // -------------------------------------------------------------------------

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket upgrade', { status: 426 })
    }
    const { 0: client, 1: server } = new WebSocketPair()
    // Hibernation: the object sleeps between events while sockets stay open,
    // so a job running for minutes with a browser attached costs nothing idle.
    this.ctx.acceptWebSocket(server)
    server.send(JSON.stringify({ type: 'snapshot', snapshot: await this.snapshot() }))
    return new Response(null, { status: 101, webSocket: client })
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    // Subscribers observe; they do not command. The only accepted message is a
    // resync request, which costs nothing and simplifies reconnection.
    if (typeof message === 'string' && message === 'resync') {
      ws.send(JSON.stringify({ type: 'snapshot', snapshot: await this.snapshot() }))
    }
  }

  override async webSocketClose(ws: WebSocket, code: number) {
    // 1005 means "no status received" and is not valid to send back.
    ws.close(code === 1005 ? 1000 : code, 'closed')
  }

  // -------------------------------------------------------------------------

  #meta(key: string): string | null {
    const row = this.#sql
      .exec<{ value: string }>(`SELECT value FROM meta WHERE key = ?`, key)
      .toArray()[0]
    return row?.value ?? null
  }

  #progress(): Progress {
    const r = this.#sql
      .exec<{ total: number; queued: number; running: number; completed: number; failed: number }>(
        `SELECT COUNT(*) AS total,
                SUM(state = 'QUEUED')                     AS queued,
                SUM(state = 'RUNNING')                    AS running,
                SUM(state = 'COMPLETED')                  AS completed,
                SUM(state IN ('FAILED','REJECTED'))       AS failed
           FROM item`,
      )
      .toArray()[0]

    const total = r?.total ?? 0
    const completed = r?.completed ?? 0
    const failed = r?.failed ?? 0
    return {
      total,
      queued: r?.queued ?? 0,
      running: r?.running ?? 0,
      completed,
      failed,
      // Every item ends in a stated outcome, including failure (B5). "Done"
      // means nothing is outstanding, not that everything succeeded.
      done: total > 0 && completed + failed === total,
    }
  }

  /** Fetch the settled row, announce it, and announce completion if reached. */
  #settle(itemId: string, type: 'item.completed' | 'item.failed'): Progress {
    const r = this.#sql
      .exec<{
        item_id: string
        source_name: string
        state: string
        outcome: string | null
        summary: string | null
        cause: string | null
        attempts: number
      }>(
        `SELECT item_id, source_name, state, outcome, summary, cause, attempts
           FROM item WHERE item_id = ?`,
        itemId,
      )
      .toArray()[0]

    const progress = this.#progress()
    if (r) {
      const item: ItemRow = {
        itemId: r.item_id,
        sourceName: r.source_name,
        state: r.state as ItemState,
        outcome: r.outcome as Outcome | null,
        summary: r.summary,
        cause: r.cause,
        attempts: r.attempts,
      }
      this.#broadcast({ type, item, progress } as Event)
    }
    if (progress.done) this.#broadcast({ type: 'job.completed', progress })
    return progress
  }

  #broadcast(event: Event): void {
    const payload = JSON.stringify(event)
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(payload)
      } catch {
        // A dead socket must never interrupt the ledger. Subscribers are
        // observers; losing one changes nothing about the job.
      }
    }
  }
}
