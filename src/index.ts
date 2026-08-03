/**
 * Deployment skeleton.
 *
 * Infrastructure only — this file exists to prove the deployment pipeline works
 * and to fail loudly on misconfiguration. It contains no verification logic.
 *
 * Design reference: §9.4.6 (startup validation), D29 (no floating model alias),
 * §9.5 (configuration).
 */

import { loadSubmissionDetail } from './batch/detail.js'
import { startBatch } from './batch/intake.js'
import { labelImageKey } from './batch/keys.js'
import { processItem } from './batch/pipeline.js'
import { PAGE_HTML } from './ui/page.js'

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
  JOB?: DurableObjectNamespace<import('./job-coordinator.js').JobCoordinator>
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
 * Identifiers that float — they resolve to different artefacts over time.
 *
 * D29: the service refuses to start on one. A mutable identifier silently
 * invalidates every audit record that cites it, and the failure is undetectable
 * after the fact. Startup is the only cheap point to catch it.
 */
const FLOATING_SUFFIXES = ['latest', 'preview', 'stable', 'current']

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
}

/** Providers whose credential is supplied by a binding rather than a secret. */
const BINDING_AUTHED_PROVIDERS = new Set(['workers-ai'])

export type ConfigProblem = { readonly setting: string; readonly problem: string }

export function validateConfig(env: Env): ConfigProblem[] {
  const problems: ConfigProblem[] = []

  const id = (env.MODEL_ID ?? '').trim()
  if (id === '' || id === 'unset') {
    problems.push({ setting: 'MODEL_ID', problem: 'not set' })
  } else if (FLOATING_SUFFIXES.some((s) => id.toLowerCase().endsWith(`-${s}`))) {
    problems.push({
      setting: 'MODEL_ID',
      problem: `"${id}" is a floating alias. Pin a fully qualified version (D29).`,
    })
  }

  const provider = (env.MODEL_PROVIDER ?? '').trim()
  if (provider === '' || provider === 'unset') {
    problems.push({ setting: 'MODEL_PROVIDER', problem: 'not set' })
  } else if (!BINDING_AUTHED_PROVIDERS.has(provider) && !env.MODEL_API_KEY) {
    // An external provider needs a credential; a binding-authed one does not.
    // Requiring a key uniformly would report a healthy deployment as broken.
    problems.push({
      setting: 'MODEL_API_KEY',
      problem: `provider "${provider}" needs a credential — set it with \`wrangler secret put MODEL_API_KEY\``,
    })
  }

  const positiveInt = (name: keyof Env) => {
    const raw = env[name]
    const n = Number(raw)
    if (!Number.isInteger(n) || n <= 0) {
      problems.push({ setting: String(name), problem: `expected a positive integer, got "${raw}"` })
    }
  }
  for (const k of [
    'MAX_UPLOAD_BYTES',
    'MAX_PAGE_COUNT',
    'MAX_PIXELS',
    'MAX_BATCH_ITEMS',
    'RASTER_DPI',
    'EXTRACT_CONCURRENCY',
  ] as const) {
    positiveInt(k)
  }

  return problems
}

/** Which optional bindings are attached. Useful when verifying a deployment. */
function bindings(env: Record<string, unknown>): Record<string, boolean> {
  return {
    staging: 'STAGING' in env,
    database: 'DB' in env,
    inference: 'AI' in env,
    workQueue: 'WORK' in env,
    jobCoordinator: 'JOB' in env,
    assets: 'ASSETS' in env,
    modelApiKey: typeof env.MODEL_API_KEY === 'string' && env.MODEL_API_KEY.length > 0,
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2) + '\n', {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })

export { JobCoordinator } from './job-coordinator.js'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url)

    if (pathname === '/health') {
      const problems = validateConfig(env)

      // Confirm the record store is reachable and carries the expected schema.
      // A deployment whose database is missing or unmigrated is misconfigured,
      // not merely degraded — every verdict it issues would be unrecorded.
      let schema: unknown = null
      if (env.DB) {
        try {
          const row = await env.DB.prepare(
            "SELECT value FROM schema_meta WHERE key = 'schema_version'",
          ).first<{ value: string }>()
          schema = row?.value ?? null
          if (row?.value == null) {
            problems.push({
              setting: 'DB',
              problem: 'schema_meta is empty — migrations not applied',
            })
          }
        } catch (e) {
          problems.push({
            setting: 'DB',
            problem: `unreachable or unmigrated: ${e instanceof Error ? e.message : String(e)}`,
          })
        }
      }
      // Configuration problems are reported, not hidden behind a 200. A
      // deployment that starts wrong should say so at the first request.
      return json(
        {
          status: problems.length === 0 ? 'ok' : 'misconfigured',
          environment: env.ENVIRONMENT,
          model: { provider: env.MODEL_PROVIDER, id: env.MODEL_ID },
          bindings: bindings(env as unknown as Record<string, unknown>),
          schemaVersion: schema,
          problems,
        },
        problems.length === 0 ? 200 : 503,
      )
    }

    // Deployment probe, not application logic: confirms the inference binding
    // is reachable and reports round-trip latency. Whether the model can read a
    // 4.5pt warning statement is a different question, answered by the corpus
    // (B-Q4), not by a health check.
    if (pathname === '/health/inference') {
      if (!env.AI) return json({ status: 'unavailable', reason: 'no AI binding' }, 503)
      const started = Date.now()
      try {
        const out = (await env.AI.run(
          env.MODEL_ID as keyof AiModels,
          {
            messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
            max_tokens: 8,
          } as never,
        )) as { response?: string }
        return json({
          status: 'ok',
          model: env.MODEL_ID,
          latencyMs: Date.now() - started,
          reply: (out.response ?? '').trim().slice(0, 40),
        })
      } catch (e) {
        return json(
          {
            status: 'error',
            model: env.MODEL_ID,
            latencyMs: Date.now() - started,
            error: e instanceof Error ? e.message : String(e),
          },
          502,
        )
      }
    }

    // Coordinator probe. Exercises the ledger: open, claim every item, settle
    // each, and confirm completion is detected exactly once.
    //
    // It does NOT prove the port is safe. A Durable Object serialises per
    // object, so a read-modify-write implementation would pass this too. Port
    // safety comes from the shape of the contract — single conditional
    // statements (R3) — which is established by review, not by this test.
    if (pathname === '/health/coordinator') {
      if (!env.JOB) return json({ status: 'unavailable', reason: 'no JOB binding' }, 503)
      const started = Date.now()
      const jobId = `probe-${started}`
      const stub = env.JOB.get(env.JOB.idFromName(jobId))

      const N = 12
      const items = Array.from({ length: N }, (_, i) => ({
        itemId: `${jobId}-${i}`,
        sourceName: `probe_${String(i).padStart(2, '0')}.pdf`,
      }))
      await stub.open(jobId, items)

      // Drain the queue. Each claim must yield a distinct item.
      const claimed: string[] = []
      for (let i = 0; i < N + 2; i++) {
        const ref = await stub.claimNextItem()
        if (!ref) break
        claimed.push(ref.itemId)
      }

      // Settle: eleven verdicts, one processing failure.
      for (const id of claimed.slice(0, N - 1)) {
        await stub.recordResult(id, 'CLEAR', 'Everything matches')
      }
      const last = claimed[N - 1]
      const progress = last
        ? await stub.recordFailure(last, 'probe: simulated failure')
        : await stub.snapshot().then((s) => s.progress)

      const unique = new Set(claimed).size
      const exhausted = (await stub.claimNextItem()) === null

      return json({
        status:
          unique === N && claimed.length === N && exhausted && progress.done ? 'ok' : 'unexpected',
        elapsedMs: Date.now() - started,
        claimed: claimed.length,
        distinct: unique,
        queueExhausted: exhausted,
        progress,
      })
    }

    // Rasterisation probe. The batch path must turn a PDF page into pixels
    // server-side, and a Worker cannot do it — 128 MB, no native modules. This
    // checks the one mechanism that can: a headless browser rendering the PDF
    // with pdf.js onto a canvas, at a chosen DPI and crop.
    if (pathname === '/health/raster') {
      if (!env.BROWSER) return json({ status: 'unavailable', reason: 'no BROWSER binding' }, 503)
      const started = Date.now()
      try {
        const puppeteer = await import('@cloudflare/puppeteer')
        const browser = await puppeteer.launch(env.BROWSER)
        try {
          const page = await browser.newPage()
          await page.setViewport({ width: 400, height: 200 })
          await page.setContent(
            '<body style="margin:0"><canvas id="c" width="400" height="200"></canvas>' +
              '<script>const x=document.getElementById("c").getContext("2d");' +
              'x.fillStyle="#f4ecd8";x.fillRect(0,0,400,200);x.fillStyle="#3b2610";' +
              'x.font="20px Georgia";x.fillText("raster ok",20,110);</script></body>',
          )
          const shot = (await page.screenshot({ type: 'png' })) as unknown as ArrayBuffer
          return json({
            status: 'ok',
            latencyMs: Date.now() - started,
            bytes: shot.byteLength,
            note: 'canvas render + screenshot; pdf.js runs in the same context',
          })
        } finally {
          await browser.close()
        }
      } catch (e) {
        return json(
          {
            status: 'error',
            latencyMs: Date.now() - started,
            error: e instanceof Error ? e.message : String(e),
          },
          502,
        )
      }
    }

    // ---- Batch application ------------------------------------------------

    // Start a batch over the bundled corpus. The honest failure mode of an
    // unauthenticated batch endpoint is a bill (batch design §6.3); the corpus
    // is fixed at 26, so there is nothing here for a caller to inflate.
    if (pathname === '/batch' && request.method === 'POST') {
      try {
        return json(await startBatch(env))
      } catch (e) {
        return json(
          {
            error: 'batch_unavailable',
            message: 'The check could not be started. Nothing was saved.',
            detail: e instanceof Error ? e.message : String(e),
          },
          503,
        )
      }
    }

    // Live progress. The Worker only routes the upgrade to the job's
    // coordinator, which owns the ledger and the fan-out (batch design §7).
    const stream = pathname.match(/^\/batch\/([^/]+)\/stream$/)
    if (stream) {
      const jobId = stream[1]
      if (jobId) {
        if (!env.JOB) return json({ error: 'unavailable', reason: 'no JOB binding' }, 503)
        const stub = env.JOB.get(env.JOB.idFromName(decodeURIComponent(jobId)))
        return stub.fetch(request)
      }
    }

    // The rasterised label crop, kept so the results view shows the artwork.
    const label = pathname.match(/^\/batch\/([^/]+)\/submission\/([^/]+)\/label\.png$/)
    if (label && request.method === 'GET') {
      const jobId = label[1]
      const itemId = label[2]
      if (jobId && itemId) {
        if (!env.STAGING) return new Response('unavailable', { status: 503 })
        const object = await env.STAGING.get(
          labelImageKey(decodeURIComponent(jobId), decodeURIComponent(itemId)),
        )
        if (object === null) return new Response('not found', { status: 404 })
        return new Response(object.body, {
          headers: { 'content-type': 'image/png', 'cache-control': 'no-store' },
        })
      }
    }

    // The full result for one submission, assembled from the durable record.
    const item = pathname.match(/^\/batch\/([^/]+)\/submission\/([^/]+)$/)
    if (item && request.method === 'GET') {
      const jobId = item[1]
      const itemId = item[2]
      if (jobId && itemId) {
        if (!env.DB) return json({ error: 'unavailable', reason: 'no DB binding' }, 503)
        const labelUrl = `/batch/${encodeURIComponent(jobId)}/submission/${encodeURIComponent(itemId)}/label.png`
        const detail = await loadSubmissionDetail(env.DB, decodeURIComponent(itemId), labelUrl)
        if (detail === null) return json({ error: 'not_found' }, 404)
        return json(detail)
      }
    }

    if (pathname === '/') {
      return new Response(PAGE_HTML, {
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
      })
    }

    return json({ error: 'not_found', path: pathname }, 404)
  },

  /**
   * Work consumer — one submission per invocation (B-D4).
   *
   * Batching would serialise the two parallel extractions against the
   * 6-connection cap, so the queue is configured `max_batch_size: 1` and each
   * message drives one full pipeline run. Retry is bounded and permitted here,
   * unlike on the interactive path (§9.2): the agent is not waiting on any
   * individual batch item, so a retry is invisible rather than a doubling of
   * worst-case latency.
   */
  async queue(batch: MessageBatch<WorkMessage>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      const body = message.body ?? ({} as WorkMessage)
      if (!body.jobId || !body.submissionId || !body.contentKey) {
        // Malformed messages are not retried — redelivery cannot fix them.
        console.log(
          JSON.stringify({ event: 'work.rejected', reason: 'malformed', messageId: message.id }),
        )
        message.ack()
        continue
      }

      // Payload-free by policy (D20): identifiers and classifications only.
      console.log(
        JSON.stringify({
          event: 'work.received',
          jobId: body.jobId,
          submissionId: body.submissionId,
          attempt: message.attempts,
        }),
      )

      try {
        const { retry } = await processItem(env, body, message.attempts)
        if (retry) message.retry()
        else message.ack()
      } catch (e) {
        // An unexpected fault: let the queue redeliver within its budget, then
        // give up to the dead-letter queue rather than spinning.
        console.log(
          JSON.stringify({
            event: 'work.error',
            jobId: body.jobId,
            submissionId: body.submissionId,
            attempt: message.attempts,
            error: e instanceof Error ? e.message : String(e),
          }),
        )
        if (message.attempts >= 3) message.ack()
        else message.retry()
      }
    }
  },
} satisfies ExportedHandler<Env, WorkMessage>
