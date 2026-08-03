/**
 * How long staged content is kept, and who deletes it (B-D10, D32, §10).
 *
 * ---------------------------------------------------------------------------
 * WHAT B-D10 SAID, AND WHY IT COULD NOT BE IMPLEMENTED AS WRITTEN
 *
 * The batch design says content is deleted at job completion, with a TTL only
 * as a backstop, and that rasterised regions are held "in memory only, never
 * written down". That describes a system where the reviewer watches results
 * arrive and nothing survives the run.
 *
 * That is not the system. Review happens *after* a job finishes: an agent
 * opens a submission, reads the verdict, and adjudicates it against the label
 * crop and the document as filed. Purging at completion would delete both, and
 * the review screen the whole product exists to serve would render two broken
 * panels. The design's §10 was written before the review path existed and was
 * never revisited — the document is stale, not the code.
 *
 * ---------------------------------------------------------------------------
 * THE POLICY
 *
 * Retention is bounded and stated rather than incidental:
 *
 *   - Staged content — the submission PDF and the label crop — is kept for a
 *     REVIEW WINDOW measured from when the job was STARTED, then deleted.
 *   - Deletion remains an explicit step the system performs and records, which
 *     is what B-D10 was actually protecting: a TTL alone means an abandoned
 *     job retains submissions for the full window with nothing accountable for
 *     it. The step now runs on a schedule instead of at completion, because
 *     completion is when the content starts being needed, not when it stops.
 *   - The durable record — verdicts, extractions, the audit chain — is NOT
 *     content and is not purged here. It carries values read from the label,
 *     not the label, and NFR-13 depends on it surviving.
 *
 * MEASURED FROM THE START, NOT THE FINISH, and the difference matters more
 * than it looks. A job that never completes has no completion to measure from,
 * so a window keyed to it would retain that job's content for ever — which is
 * precisely the abandoned-job failure B-D10 was written to prevent. Keying to
 * the start covers the abandoned case by construction. It costs nothing in
 * accuracy: a job runs for minutes, so start-plus-fourteen-days and
 * finish-plus-fourteen-days are the same day.
 *
 * It also avoids inventing a completion timestamp the system does not have.
 * `job.completed_at` exists in the schema and has never been written — the row
 * records PROCESSING at intake and is never updated (see `current.ts`), with
 * progress derived by counting submissions instead. Retention is the wrong
 * reason to add a write to six settle paths and a race between them.
 *
 * WHAT THIS CONCEDES. It is a widening of N3, and the README must say so in
 * these words rather than repeat a stronger claim: the prototype stores
 * nothing durable *except* the record, and keeps submitted content for as long
 * as the review window. Fourteen days is a prototype's number, chosen to
 * outlast a reviewer's weekend and nothing more. A production deployment sets
 * it from a records schedule, which is Q-PRV-03 and is not ours to answer.
 */

import { appendAudit } from './audit.js'
import { labelImageKey } from './keys.js'

/**
 * How long content outlives the job that staged it.
 *
 * Long enough that a review begun on Friday can be finished the following
 * week; short enough that it is a window rather than an archive.
 */
export const REVIEW_WINDOW_DAYS = 14

/** Recorded in `schema_meta`, so the deployment states its own policy (D32). */
export const RETENTION_POLICY =
  `Content (submission PDF, label crop) purged ${REVIEW_WINDOW_DAYS} days after the job starts; ` +
  `record (verdict, extraction, audit chain) retained indefinitely pending Q-PRV-03`

export interface PurgeCandidate {
  readonly submissionId: string
  readonly jobId: string
  readonly contentKey: string | null
}

export interface PurgeOutcome {
  readonly purged: number
  readonly objectsDeleted: number
  readonly submissionIds: readonly string[]
}

/** The cutoff: content staged by jobs started before this is due for deletion. */
export function purgeCutoff(now: Date, windowDays = REVIEW_WINDOW_DAYS): string {
  return new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000).toISOString()
}

/**
 * Submissions whose review window has closed.
 *
 * Keyed off the job rather than the individual submission, so a job is purged
 * as a unit. A reviewer opening one item of a batch and finding its neighbour
 * already gone would reasonably conclude the tool had lost data.
 *
 * `content_purged_at IS NULL` makes this idempotent: an interrupted purge
 * resumes rather than repeating, and a second run over the same window finds
 * nothing to do.
 */
export async function findPurgeCandidates(
  db: D1Database,
  cutoff: string,
  limit: number,
): Promise<readonly PurgeCandidate[]> {
  const rows = await db
    .prepare(
      `SELECT s.id AS submission_id, s.job_id, s.content_key
         FROM submission s
         JOIN job j ON j.id = s.job_id
        WHERE s.content_purged_at IS NULL
          AND j.created_at < ?1
        LIMIT ?2`,
    )
    .bind(cutoff, limit)
    .all<{ submission_id: string; job_id: string; content_key: string | null }>()

  return rows.results.map((r) => ({
    submissionId: r.submission_id,
    jobId: r.job_id,
    contentKey: r.content_key,
  }))
}

/**
 * Delete the objects, and report only what actually went.
 *
 * A submission is reported purged only if every object belonging to it was
 * deleted without error. The alternative — marking on attempt — is worse than
 * not purging at all: the row would say the content is gone, nothing would
 * ever revisit it, and the object would outlive the policy with the record
 * asserting otherwise. A failed delete is retried on the next run instead.
 *
 * Deleting a key that does not exist is not an error in R2, and is not one
 * here: a submission rejected at intake never had a PDF staged, and an item
 * that failed before extraction never had a crop.
 */
export async function purgeContent(
  bucket: R2Bucket,
  candidates: readonly PurgeCandidate[],
): Promise<PurgeOutcome> {
  const purged: string[] = []
  let objectsDeleted = 0

  for (const c of candidates) {
    // The label crop is content as much as the PDF is. Purging one and not the
    // other would satisfy the policy on paper and retain the artwork.
    const keys = [c.contentKey, labelImageKey(c.jobId, c.submissionId)].filter(
      (k): k is string => k !== null,
    )

    try {
      for (const key of keys) {
        await bucket.delete(key)
        objectsDeleted++
      }
      purged.push(c.submissionId)
    } catch {
      // Left unmarked, so the next run tries again. Deliberately not fatal:
      // one unreachable object must not stop the rest of the sweep.
    }
  }

  return { purged: purged.length, objectsDeleted, submissionIds: purged }
}

/**
 * How many submissions one sweep will handle.
 *
 * Bounded because a scheduled invocation has a wall-clock limit and a
 * subrequest budget, and an unbounded sweep over a large backlog would be
 * killed partway — leaving objects deleted with the record still saying
 * otherwise. A bounded sweep that runs again tomorrow is correct at every
 * point; an unbounded one is correct only if it finishes.
 */
export const PURGE_BATCH = 200

/**
 * The whole step: find what is due, delete it, record that it went.
 *
 * The order is the point. Objects are deleted first and the record is marked
 * second, so an interruption between them leaves a row that claims content
 * still exists when it does not — recoverable, because the next sweep deletes
 * an absent key harmlessly and marks the row. The reverse order would leave a
 * row claiming the content is gone while it remains in the bucket, and nothing
 * would ever look at it again. Given a choice of which way to be briefly
 * wrong, be wrong in the direction that self-corrects.
 */
export async function runPurge(
  db: D1Database,
  bucket: R2Bucket,
  now: Date,
  windowDays = REVIEW_WINDOW_DAYS,
): Promise<PurgeOutcome & { readonly cutoff: string }> {
  const cutoff = purgeCutoff(now, windowDays)
  const candidates = await findPurgeCandidates(db, cutoff, PURGE_BATCH)
  if (candidates.length === 0) {
    return { purged: 0, objectsDeleted: 0, submissionIds: [], cutoff }
  }

  const outcome = await purgeContent(bucket, candidates)

  const at = now.toISOString()
  if (outcome.submissionIds.length > 0) {
    // `content_key` is nulled alongside the stamp: the key names an object
    // that no longer exists, and leaving it behind invites a later reader to
    // fetch it and report a fault where there is only a policy.
    await db.batch(
      outcome.submissionIds.map((id) =>
        db
          .prepare(
            `UPDATE submission SET content_purged_at = ?1, content_key = NULL
              WHERE id = ?2 AND content_purged_at IS NULL`,
          )
          .bind(at, id),
      ),
    )
  }

  return { ...outcome, cutoff }
}

/**
 * The sweep, as both the schedule and an operator invoke it.
 *
 * One function with two callers, deliberately. A manual trigger that ran its
 * own slightly different logic would prove the manual trigger works and
 * nothing about the nightly job, which is the one that actually enforces the
 * policy.
 *
 * Note what it does NOT take: a window. The caller cannot ask for a shorter
 * one. An endpoint able to override the retention window is an endpoint able
 * to delete every submission in the system with one parameter, and no
 * operational need justifies that — to exercise the sweep, move a job's
 * timestamp, not the policy.
 */
export async function sweepRetention(
  db: D1Database,
  bucket: R2Bucket,
  now: Date,
): Promise<PurgeOutcome & { readonly cutoff: string }> {
  const result = await runPurge(db, bucket, now)
  if (result.purged === 0) return result

  // Recorded in the chain, because a deletion is a thing that happened to a
  // submission and the record is meant to show what happened to it. Counts and
  // identifiers only — the same rule as every other event (D20).
  await appendAudit(db, {
    at: now.toISOString(),
    actor: 'system',
    action: 'content.purged',
    subjectType: 'job',
    subjectId: 'retention-sweep',
    detail: `submissions=${result.purged};objects=${result.objectsDeleted};cutoff=${result.cutoff};windowDays=${REVIEW_WINDOW_DAYS}`,
  })

  return result
}
