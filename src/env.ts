/**
 * The platform contract.
 *
 * Its own module because three modules need it — the coordinator, the item
 * worker and intake — and all three used to import it from the worker entry,
 * which in turn imports them. Type-only, so it erased at runtime and the cycle
 * was invisible; but it meant the shape of the platform was defined by the file
 * that also does routing, health probes and queue consumption.
 */

import type { JobCoordinator } from './job-coordinator.js'

export interface Env {
  ENVIRONMENT: string
  MODEL_PROVIDER: string
  MODEL_ID: string
  MAX_UPLOAD_BYTES: string
  MAX_PAGE_COUNT: string
  MAX_PIXELS: string
  MAX_BATCH_ITEMS: string
  RASTER_DPI: string
  EXTRACT_CONCURRENCY: string
  /** Set with `wrangler secret put MODEL_API_KEY`. Never present in config. */
  MODEL_API_KEY?: string

  /** One coordinator per batch job (B-D12: it does no I/O beyond its storage). */
  JOB?: DurableObjectNamespace<JobCoordinator>
  /** Headless browser for server-side PDF rasterisation (batch path only). */
  BROWSER?: Fetcher
  /** On-platform inference. Carries its own auth — no separate credential. */
  AI?: Ai
  /** Work distribution. One submission per message (B-D4). */
  WORK?: Queue<WorkMessage>
  /** Transient submission content. Purged at job completion (B-D10). */
  STAGING?: R2Bucket
  /** The durable record and append-only transaction history (D32). */
  DB?: D1Database
  /** The bundled demonstration corpus, read at intake (see wrangler `assets`). */
  ASSETS?: Fetcher
}

/**
 * One unit of work: a single submission. Deliberately carries only references —
 * queue messages are capped at 128 KB, so content travels in R2 and its key
 * travels here (batch design §15.1).
 */
export interface WorkMessage {
  readonly jobId: string
  readonly submissionId: string
  readonly contentKey: string
  readonly contentDigest: string
  /**
   * Pre-rasterised regions for a bundled corpus submission.
   *
   * Present only for the demonstration corpus, whose pixels are rendered at
   * build time. An upload carries neither and takes the browser path, so the
   * real normalisation route stays exercised.
   */
  readonly labelRasterPath?: string
  readonly recordRasterPath?: string
}
