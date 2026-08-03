/**
 * The current job — what every session should be looking at.
 *
 * A batch is a property of the service, not of the tab that started it. Before
 * this, `jobId` lived only in one browser's memory: a reload lost a running
 * check, and a second visitor saw a start button while 26 submissions were
 * being read. The job is server state, so the server names it.
 *
 * "Still running" is derived from the submissions rather than read from
 * `job.state`. The job row records PROCESSING at intake and is never updated —
 * a dead batch still claims to be processing — whereas the submission rows are
 * the same rows the worklist is drawn from, and they settle. One source of
 * truth, and it is the one that moves.
 */

/** How a job's submissions are distributed across the states that matter here. */
export interface JobStateCounts {
  readonly queued: number
  readonly running: number
  /** COMPLETED, FAILED or REJECTED — anything that will not change again. */
  readonly settled: number
}

/** The job a page should show, and whether it is still moving. */
export interface CurrentJob {
  readonly jobId: string
  readonly running: boolean
  readonly counts: JobStateCounts
}

/**
 * Whether work remains.
 *
 * Note that an all-failed batch is finished, not running. The stall this
 * replaced read it the other way and left the page saying "waiting" forever
 * over 26 items that had already died.
 */
export function isRunning(counts: JobStateCounts): boolean {
  return counts.queued > 0 || counts.running > 0
}

/**
 * The most recent job, whatever state it is in.
 *
 * Most recent rather than most recent *running*: when nothing is in flight the
 * page still shows the last worklist, so results survive a reload and a
 * reviewer opening the link sees the outcome instead of a bare button.
 */
export async function loadCurrentJob(db: D1Database): Promise<CurrentJob | null> {
  const job = await db
    .prepare(`SELECT id FROM job ORDER BY created_at DESC LIMIT 1`)
    .first<{ id: string }>()
  if (job === null) return null

  const row = await db
    .prepare(
      `SELECT
         SUM(state = 'QUEUED')  AS queued,
         SUM(state = 'RUNNING') AS running,
         SUM(state IN ('COMPLETED', 'FAILED', 'REJECTED')) AS settled
       FROM submission WHERE job_id = ?`,
    )
    .bind(job.id)
    .first<{ queued: number | null; running: number | null; settled: number | null }>()

  const counts: JobStateCounts = {
    queued: row?.queued ?? 0,
    running: row?.running ?? 0,
    settled: row?.settled ?? 0,
  }

  return { jobId: job.id, running: isRunning(counts), counts }
}
