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

  if ((env.MODEL_PROVIDER ?? '').trim() === '' || env.MODEL_PROVIDER === 'unset') {
    problems.push({ setting: 'MODEL_PROVIDER', problem: 'not set' })
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
            problems.push({ setting: 'DB', problem: 'schema_meta is empty — migrations not applied' })
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

    if (pathname === '/') {
      return new Response(
        'TTB Label Check — deployment skeleton. No application yet.\n' +
          'Try /health to verify configuration.\n',
        { headers: { 'content-type': 'text/plain; charset=utf-8' } },
      )
    }

    return json({ error: 'not_found', path: pathname }, 404)
  },
} satisfies ExportedHandler<Env>
