/**
 * Object-store key layout for a job.
 *
 * Every key is prefixed by the job id, so a job's transient content is a single
 * addressable subtree — which is what lets completion delete it in one sweep
 * (batch design §10) rather than hunting individual objects.
 */

/** The staged submission PDF. */
export const contentKey = (jobId: string, itemId: string): string => `${jobId}/${itemId}.pdf`

/** The rasterised label crop, kept for the results image panel (ui-design §6.4). */
export const labelImageKey = (jobId: string, itemId: string): string =>
  `${jobId}/${itemId}-label.png`
