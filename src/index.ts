/**
 * Deployment skeleton.
 *
 * Infrastructure only — this file exists to prove the deployment pipeline works
 * and to fail loudly on misconfiguration. It contains no verification logic.
 *
 * Design reference: §9.4.6 (startup validation), D29 (no floating model alias),
 * §9.5 (configuration).
 */

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
  /** On-platform inference. Carries its own auth — no separate credential. */
  AI?: Ai
  /** Work distribution. One submission per message (B-D4). */
  WORK?: Queue<WorkMessage>
  /** Transient submission content. Purged at job completion (B-D10). */
  STAGING?: R2Bucket
  /** The durable record and append-only transaction history (D32). */
  DB?: D1Database
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

    if (pathname === '/') {
      return new Response(
        'TTB Label Check — deployment skeleton. No application yet.\n' +
          'Try /health to verify configuration.\n',
        { headers: { 'content-type': 'text/plain; charset=utf-8' } },
      )
    }

    return json({ error: 'not_found', path: pathname }, 404)
  },

  /**
   * Work consumer — skeleton.
   *
   * One submission per invocation (B-D4): batching would serialise the two
   * parallel extractions against the 6-connection cap. The verification
   * pipeline is not built yet, so this validates the message shape and
   * acknowledges.
   *
   * Retry is bounded and permitted here, unlike on the interactive path
   * (§9.2): the agent is not waiting on any individual batch item, so a retry
   * is invisible rather than a doubling of worst-case latency.
   */
  async queue(batch: MessageBatch<WorkMessage>, _env: Env): Promise<void> {
    for (const message of batch.messages) {
      const { jobId, submissionId, contentKey } = message.body ?? ({} as WorkMessage)
      if (!jobId || !submissionId || !contentKey) {
        // Malformed messages are not retried — redelivery cannot fix them.
        console.log(
          JSON.stringify({
            event: 'work.rejected',
            reason: 'malformed',
            messageId: message.id,
          }),
        )
        message.ack()
        continue
      }
      // Payload-free by policy (D20): identifiers and classifications only.
      console.log(
        JSON.stringify({
          event: 'work.received',
          jobId,
          submissionId,
          attempt: message.attempts,
        }),
      )
      message.ack()
    }
  },
} satisfies ExportedHandler<Env, WorkMessage>
