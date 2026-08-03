// Re-exported: wrangler and existing imports resolve the worker's types here.
/**
 * Deployment skeleton.
 *
 * Infrastructure only — this file exists to prove the deployment pipeline works
 * and to fail loudly on misconfiguration. It contains no verification logic.
 *
 * Design reference: §9.4.6 (startup validation), D29 (no floating model alias),
 * §9.5 (configuration).
 */

import { readWholeChain, verifyChain } from './batch/audit.js'
import { MAX_ATTEMPTS, retryDelaySeconds } from './batch/backoff.js'
import { loadCurrentJob } from './batch/current.js'
import { loadSubmissionDetail } from './batch/detail.js'
import { startBatch } from './batch/intake.js'
import { contentKey, labelImageKey } from './batch/keys.js'
import { processItem } from './batch/pipeline.js'
import { ExtractionContractError } from './domain/extraction.js'
import type { Env, WorkMessage } from './env.js'
import { gatewayFrom } from './providers/gateway.js'
import { createProvider, knownProviderNames, specFor } from './providers/registry.js'
import { PAGE_HTML } from './ui/page.js'

export type ConfigProblem = { readonly setting: string; readonly problem: string }

export function validateConfig(env: Env): ConfigProblem[] {
  const problems: ConfigProblem[] = []

  // Both questions below are the vendor's to answer, and the answers differ
  // between them: Cloudflare floats an id with a `-latest` suffix, Google
  // floats by omitting a version, and only one of the two needs a credential.
  // A single list here would have been right for whichever vendor it was
  // written against and quietly wrong for the next.
  const providerName = (env.MODEL_PROVIDER ?? '').trim()
  const spec = providerName === '' ? null : specFor(providerName)

  if (providerName === '' || providerName === 'unset') {
    problems.push({ setting: 'MODEL_PROVIDER', problem: 'not set' })
  } else if (spec === null) {
    problems.push({
      setting: 'MODEL_PROVIDER',
      problem: `"${providerName}" is not a known provider. Known: ${knownProviderNames()}`,
    })
  } else if (spec.requiresCredential && !env.MODEL_API_KEY) {
    problems.push({
      setting: 'MODEL_API_KEY',
      problem: `provider "${providerName}" needs a credential — set it with \`wrangler secret put MODEL_API_KEY\``,
    })
  }

  const id = (env.MODEL_ID ?? '').trim()
  if (id === '' || id === 'unset') {
    problems.push({ setting: 'MODEL_ID', problem: 'not set' })
  } else if (spec?.isFloatingModelId(id)) {
    problems.push({
      setting: 'MODEL_ID',
      problem: `"${id}" is a floating alias. Pin a fully qualified version (D29).`,
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

/**
 * How the configured provider classifies its own failure.
 *
 * Reported so nothing downstream — least of all a shell script in a workflow —
 * has to recognise a vendor's error vocabulary. Null when no provider could be
 * built, because then the fault is the configuration rather than the vendor.
 */
function faultOf(env: Env, error: unknown): string | null {
  const spec = specFor((env.MODEL_PROVIDER ?? '').trim())
  return spec ? spec.classify(error) : null
}

/** Whether inference is routed through AI Gateway, and why not if it is not. */
function gatewayStatus(env: Env): { routed: boolean; id: string | null; reason?: string } {
  const gateway = gatewayFrom(env)
  if (gateway === null) return { routed: false, id: null, reason: 'AI_GATEWAY_ID is not set' }
  if (gateway.accountId === '') {
    return { routed: false, id: gateway.id, reason: 'AI_GATEWAY_ACCOUNT is not set' }
  }
  return { routed: true, id: gateway.id }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2) + '\n', {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })

export type { Env, WorkMessage } from './env.js'
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
          // Which deployment answered. A verification that cannot tell this
          // from the previous version is not verifying the deploy.
          version: env.CF_VERSION_METADATA?.id ?? null,
          model: { provider: env.MODEL_PROVIDER, id: env.MODEL_ID },
          bindings: bindings(env as unknown as Record<string, unknown>),
          // Whether inference is proxied. The address is built from a secret,
          // so a missing one degrades silently to direct vendor calls — the
          // right failure (observability lost, service intact) but only if it
          // is visible.
          gateway: gatewayStatus(env),
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
      const started = Date.now()
      const configured = (env.MODEL_PROVIDER ?? '').trim()
      try {
        const provider = createProvider(env)
        await provider.ping()
        return json({
          status: 'ok',
          provider: provider.name,
          model: env.MODEL_ID,
          latencyMs: Date.now() - started,
        })
      } catch (e) {
        return json(
          {
            status: 'error',
            provider: configured,
            model: env.MODEL_ID,
            latencyMs: Date.now() - started,
            // The provider's own reading of its own failure. The deploy gate
            // acts on this rather than pattern-matching the message, which was
            // one vendor's vocabulary applied to whichever vendor happened to
            // be configured.
            fault: faultOf(env, e),
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
    // One extraction, through whichever provider is configured.
    //
    // This replaced two probes that hand-built Cloudflare's request shape to
    // answer "does the image reach the model" — a question now settled in the
    // adapter's own tests. What is left is the question a deployment actually
    // needs answered: can the configured reader read a known label? It runs the
    // production path end to end, so a wrong envelope, a lost image or a
    // refused credential all surface the same way they would in a batch.
    if (pathname === '/health/extract') {
      if (!env.ASSETS) return json({ status: 'unavailable', reason: 'no ASSETS binding' }, 503)

      const id = new URL(request.url).searchParams.get('id') ?? 'L01'
      const asset = await env.ASSETS.fetch(
        new Request(`https://assets.local/rasters/${id}-label.png`),
      )
      if (!asset.ok) return json({ status: 'error', reason: `no shipped raster for ${id}` }, 404)
      const image = await asset.arrayBuffer()

      const started = Date.now()
      // Named before the attempt, so a failure says which reader failed. With
      // one provider that was implicit; with two it is the first thing to know.
      const configured = (env.MODEL_PROVIDER ?? '').trim()
      try {
        const provider = createProvider(env)
        const result = await provider.extract({
          region: 'label',
          image,
          mimeType: 'image/png',
          fields: ['brandName', 'classType', 'alcoholContent', 'netContents'],
          includeWarning: true,
        })
        return json({
          status: 'ok',
          provider: provider.name,
          model: env.MODEL_ID,
          latencyMs: Date.now() - started,
          // The values, not the artwork: enough to see whether it read the
          // label, without putting label content into a log (D20).
          fields: Object.fromEntries(
            Object.entries(result.extraction.fields).map(([k, v]) => [
              k,
              v.unreadable ? 'UNREADABLE' : (v.raw ?? 'ABSENT'),
            ]),
          ),
          warningRead: result.extraction.warningStatement !== null,
          // The transcription itself, for a corpus label someone is
          // deliberately probing. It answers a question a boolean cannot: a
          // model that recites a statutory string it knows by heart and one
          // that reads a degraded scan both report "read", and only the words
          // separate them. Never logged, never persisted (D20).
          warning: result.extraction.warningStatement?.slice(0, 300) ?? null,
        })
      } catch (e) {
        return json(
          {
            status: 'error',
            provider: configured,
            model: env.MODEL_ID,
            latencyMs: Date.now() - started,
            fault: faultOf(env, e),
            error: e instanceof Error ? e.message : String(e),
            // Only here, and only for a corpus label someone is deliberately
            // probing. It never reaches a log or the durable record (D20).
            raw:
              e instanceof ExtractionContractError && e.raw !== undefined
                ? e.raw.slice(0, 600)
                : undefined,
          },
          502,
        )
      }
    }

    // What the configured provider will actually accept.
    //
    // Added after two deploys spent on model ids that did not exist: one I
    // invented to satisfy my own pinning rule, one retired for new accounts.
    // Both were guesses where a lookup was available.
    if (pathname === '/health/models') {
      const configured = (env.MODEL_PROVIDER ?? '').trim()
      try {
        const provider = createProvider(env)
        if (!provider.listModels) {
          return json({
            status: 'unavailable',
            provider: configured,
            reason: 'this provider cannot enumerate its catalogue',
          })
        }
        return json({ status: 'ok', provider: configured, models: await provider.listModels() })
      } catch (e) {
        return json(
          {
            status: 'error',
            provider: configured,
            error: e instanceof Error ? e.message : String(e),
          },
          502,
        )
      }
    }

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
    // Recompute the transaction history.
    //
    // A chain nobody verifies is decoration: its value is entirely in someone
    // being able to run this and get an answer that names where the sequence
    // stops holding. Reported as an index rather than a boolean, because
    // "something was altered" is not actionable and "event 47 was" is.
    if (pathname === '/audit/verify' && request.method === 'GET') {
      if (!env.DB) return json({ error: 'unavailable', reason: 'no DB binding' }, 503)

      const chain = await readWholeChain(env.DB)
      const brokenAt = await verifyChain(chain)

      return json(
        {
          status: brokenAt === null ? 'ok' : 'broken',
          events: chain.length,
          brokenAt,
          // The most recent link, so an external record can pin the history at
          // a moment: anything appended later extends this, and anything
          // altered before it cannot reproduce it.
          head: chain.length > 0 ? chain[chain.length - 1]?.digest : null,
        },
        brokenAt === null ? 200 : 409,
      )
    }

    // Which job every session should be showing. The page asks on load, so a
    // reload — or a second visitor — rejoins the batch in progress instead of
    // being offered a start button while 26 submissions are being read.
    if (pathname === '/batch/current' && request.method === 'GET') {
      if (!env.DB) return json({ error: 'unavailable', reason: 'no DB binding' }, 503)
      return json(await loadCurrentJob(env.DB))
    }

    // Stop whatever is running.
    //
    // A job only ends when every item reaches a terminal state, so anything
    // that strands work — a purged queue, a spent allowance, a deploy mid-run
    // — leaves rows QUEUED for ever. `/batch/current` then reports the job as
    // running, and because starting joins a job in flight, every later batch
    // attaches to the corpse. Until now the only cure was editing D1 by hand.
    //
    // Both stores are settled, not just the ledger: the durable record is what
    // `/batch/current` reads, and leaving it behind would reset the page while
    // still blocking the next run.
    if (pathname === '/batch/reset' && request.method === 'POST') {
      if (!env.DB || !env.JOB) return json({ error: 'unavailable' }, 503)

      const current = await loadCurrentJob(env.DB)
      if (current === null) return json({ jobId: null, stopped: 0 })

      const reason = 'Stopped by request.'
      const settled = await env.DB.prepare(
        `UPDATE submission SET state = 'FAILED', failure_cause = ?
          WHERE job_id = ? AND state IN ('QUEUED', 'RUNNING')`,
      )
        .bind(reason, current.jobId)
        .run()

      // Messages already delivered cannot be recalled, but the coordinator's
      // abort flag is checked before any work, so they ack and drain instead of
      // reviving the job an item at a time.
      const stub = env.JOB.get(env.JOB.idFromName(current.jobId))
      await stub.abort(reason)

      return json({ jobId: current.jobId, stopped: settled.meta?.changes ?? 0 })
    }

    if (pathname === '/batch' && request.method === 'POST') {
      try {
        // Joining, not starting a second job: two people pressing the button
        // must converge on one ledger, or "everyone sees the same thing" is
        // false by construction. It also stops a double-click from costing
        // another 26 browser launches against the rate limit.
        if (env.DB) {
          const current = await loadCurrentJob(env.DB)
          if (current?.running) {
            return json({ jobId: current.jobId, joined: true })
          }
        }
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

    // The submission as filed. The label crop shows what the model was given;
    // this shows what the applicant sent, so a reviewer can check a verdict
    // against the whole document rather than the region the crop happened to
    // capture — which is also how a bad region map would be spotted.
    const source = pathname.match(/^\/batch\/([^/]+)\/submission\/([^/]+)\/source\.pdf$/)
    if (source && request.method === 'GET') {
      const jobId = source[1]
      const itemId = source[2]
      if (jobId && itemId) {
        if (!env.STAGING) return new Response('unavailable', { status: 503 })
        const object = await env.STAGING.get(
          contentKey(decodeURIComponent(jobId), decodeURIComponent(itemId)),
        )
        if (object === null) return new Response('not found', { status: 404 })
        return new Response(object.body, {
          headers: {
            'content-type': 'application/pdf',
            // Inline so the browser's own viewer renders it in the panel.
            'content-disposition': 'inline',
            'cache-control': 'no-store',
          },
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
        const { retry, delaySeconds } = await processItem(env, body, message.attempts)
        if (!retry) message.ack()
        // Holding the message rather than redelivering at once: a rate limit is
        // an interval to wait out, and an immediate retry is refused before it
        // could have cleared.
        else if (delaySeconds === undefined) message.retry()
        else message.retry({ delaySeconds })
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
        if (message.attempts >= MAX_ATTEMPTS) message.ack()
        else message.retry({ delaySeconds: retryDelaySeconds(message.attempts) })
      }
    }
  },
} satisfies ExportedHandler<Env, WorkMessage>
