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

import { DEPLOY_AGENT, SYSTEM_AGENT } from './batch/agent.js'
import { appendAudit, readWholeChain, verifyChain } from './batch/audit.js'
import { MAX_ATTEMPTS, retryDelaySeconds } from './batch/backoff.js'
import { BatchTooLarge } from './batch/cap.js'
import { loadCurrentJob } from './batch/current.js'
import {
  agreementByOutcome,
  alreadyDecided,
  checkDecision,
  DecisionRejected,
  isDisagreement,
  listDecisions,
  recordDecision,
} from './batch/decision.js'
import { loadSubmissionDetail } from './batch/detail.js'
import { sha256Hex } from './batch/digest.js'
import { startBatch } from './batch/intake.js'
import { contentKey, labelImageKey } from './batch/keys.js'
import { buildPersistPlan, persistResult } from './batch/persist.js'
import { processItem } from './batch/pipeline.js'
import {
  isReferenceCode,
  normaliseReferenceCode,
  referenceCodeFor,
} from './batch/reference-code.js'
import { loadStoredVerdict, ReplayUnavailableError, replayVerdict } from './batch/replay-load.js'
import { retentionPolicyText, retentionWindowDays, sweepRetention } from './batch/retention.js'
import { approvalFor, isApproved } from './domain/approval.js'
import { ExtractionContractError } from './domain/extraction.js'
import { POLICY_SET } from './domain/findings.js'
import { configuredLegibilityFloor } from './domain/legibility.js'
import type { PolicyRule } from './domain/policy.js'
import { referenceIsUnverified, warningReference } from './domain/reference.js'
import type { Env, WorkMessage } from './env.js'
import { checkImageIntake } from './normalise/image.js'
import { IntakeRejected } from './normalise/normaliser.js'
import { archiveHealth, reconcileArchive, ruleSetAsAt } from './policy/archive.js'
import { gatewayFrom } from './providers/gateway.js'
import { PROMPT_VERSION, promptDigest } from './providers/prompt.js'
import { createProvider, knownProviderNames, specFor } from './providers/registry.js'
import { checkReviewRequest, ReviewRejected, reviewOne } from './review/single.js'
import { PAGE_HTML } from './ui/page.js'

/**
 * The rules a replay must re-derive against: the archive as it stood at the
 * verdict's own two dates (D41, D42).
 *
 * Empty options for a verdict written before migration 0008, which carries
 * neither date. Reaching for today's rules there would be the exact failure the
 * dates exist to prevent, so it falls back to the reviewed file and the version
 * comparison refuses it instead.
 */
async function rulesForReplay(
  db: D1Database,
  stored: { validOn: string | null; asOf: string | null },
): Promise<{ rules?: readonly PolicyRule[] }> {
  if (stored.validOn === null || stored.asOf === null) return {}
  return { rules: await ruleSetAsAt(db, stored.validOn, stored.asOf) }
}

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
  } else if (spec !== null && !isApproved(providerName, id)) {
    // Which model reads a label is a governance decision, not a deployment
    // detail: it determines what every verdict was produced by. Reported
    // rather than refused — the service says what it is doing instead of
    // silently doing it — and enforced by the deploy gate, which fails on a
    // /health that is not ok.
    problems.push({
      setting: 'MODEL_ID',
      problem: `"${id}" is not an approved reader for provider "${providerName}". Approvals are recorded in config/approved-models.json.`,
    })
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
    // Unset retention is a misconfiguration, not a default. See
    // `retentionWindowDays` — a deployment that never chose a window must not
    // quietly delete applicant content on one.
    'RETENTION_WINDOW_DAYS',
  ] as const) {
    positiveInt(k)
  }

  // Checked as a positive NUMBER, not a positive integer. Edge energy is a
  // continuous measurement, so 29.5 is a meaningful floor in a way that half a
  // day of retention is not — and rejecting it here while the parser accepts
  // it would fail the deploy gate on a value the system would have honoured.
  // An unset floor leaves no opinion on whether a warning could be read, and
  // UNREADABLE is the verdict that stops a non-compliant label passing (D5).
  if (configuredLegibilityFloor(env) === null) {
    problems.push({
      setting: 'LEGIBILITY_FLOOR',
      problem: `expected a positive number, got "${env.LEGIBILITY_FLOOR}"`,
    })
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

/**
 * What the deployment promises about applicant content, and whether the two
 * places that say so agree (D32).
 *
 * `stated` is the policy recorded in the database — the durable statement, the
 * one an auditor would read. `enforced` is what the sweep will actually do
 * tonight, derived from the configured window. They are reported as a pair
 * because a retention promise that has drifted from the deletion schedule is
 * worse than one nobody made: it is a false statement about someone's data,
 * and nothing else in the system would reveal it.
 */
function retentionReport(
  env: Env,
  stated: string | null,
): {
  stated: string | null
  enforced: string | null
  windowDays: number | null
  agrees: boolean | null
} {
  const windowDays = retentionWindowDays(env)
  const enforced = windowDays === null ? null : retentionPolicyText(windowDays)
  return {
    stated,
    enforced,
    windowDays,
    // Null, not false, when either side is absent: unknown is not disagreement,
    // and the missing piece is already reported as its own problem.
    agrees: stated === null || enforced === null ? null : stated === enforced,
  }
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
      let storedRetention: string | null = null
      if (env.DB) {
        try {
          const row = await env.DB.prepare(
            "SELECT value FROM schema_meta WHERE key = 'schema_version'",
          ).first<{ value: string }>()
          schema = row?.value ?? null
          storedRetention =
            (
              await env.DB.prepare(
                "SELECT value FROM schema_meta WHERE key = 'retention_policy'",
              ).first<{ value: string }>()
            )?.value ?? null
          if (row?.value == null) {
            problems.push({
              setting: 'DB',
              problem: 'schema_meta is empty — migrations not applied',
            })
          }

          // The recorded policy and the enforced one must say the same thing.
          // Treated as a startup problem, like an unapproved model, because the
          // deployment would otherwise publish a retention promise it does not
          // keep — and the deploy gate is the last place that can catch it.
          const retention = retentionReport(env, storedRetention)
          if (retention.agrees === false) {
            problems.push({
              setting: 'RETENTION_WINDOW_DAYS',
              problem:
                `the recorded policy and the configured window disagree. ` +
                `Recorded: "${retention.stated}". Enforced: "${retention.enforced}". ` +
                `Update schema_meta.retention_policy in a migration to match.`,
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
          // What the deployment promises about applicant content (D32), from
          // the record and from the code. Reported as a pair because the
          // window lives in two places — a migration and a constant — and a
          // policy that has drifted from what the sweep actually deletes is
          // worse than one that was never stated.
          retention: retentionReport(env, storedRetention),
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
          servedModelVersion: result.provenance.servedModelVersion ?? null,
          // The envelope's own keys, so what a vendor offers is read rather
          // than assumed. Three response-shape assumptions were wrong today.
          envelopeKeys: result.envelopeKeys ?? null,
          vendorRequestId: result.provenance.vendorRequestId ?? null,
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
    // What this deployment reads with, and on whose authority.
    //
    // Read-only, deliberately. An administrative interface is a production-path
    // item (§15) and the prototype is unauthenticated by design (D14), so an
    // endpoint that could repoint the model would be a control with no gate
    // behind it — the opposite of the governance it appears to offer. Changing
    // the reader stays a reviewed change to config/approved-models.json and
    // wrangler.jsonc; this is how an administrator checks what is in force.
    if (pathname === '/admin/model' && request.method === 'GET') {
      const providerName = (env.MODEL_PROVIDER ?? '').trim()
      const modelId = (env.MODEL_ID ?? '').trim()
      const approval = approvalFor(providerName, modelId)
      const spec = specFor(providerName)

      return json({
        inForce: { provider: providerName, modelId },
        approved: approval !== null,
        approval,
        // Whether the identifier can move beneath the record that cites it.
        // Vendor-specific: Cloudflare floats by suffix, Google by omitting a
        // version, which is why the fingerprint below exists at all.
        pinned: spec === null ? null : !spec.isFloatingModelId(modelId),
        prompt: { version: PROMPT_VERSION, digest: await promptDigest() },
        referenceData: {
          configVersion: warningReference().configVersion,
          verified: !referenceIsUnverified(),
        },
        // Identity is established per job and recorded in the chain; this says
        // where to look rather than repeating it.
        fingerprint: 'recorded per job as model.fingerprinted — see /audit/verify',
      })
    }

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

    // Re-derive the most recent verdicts and summarise (NFR-13).
    //
    // The per-submission route below answers "is this verdict sound?"; this one
    // answers "is re-derivability still holding?", which is the question a
    // deploy gate needs and nobody would think to ask by hand. A regression in
    // the comparison rules shows up here as `differs > 0` within seconds of the
    // deploy that caused it, instead of the next time an auditor looks.
    //
    // Statuses are kept apart rather than summed. Verdicts recorded before
    // migration 0002 can never be re-derived, and if they counted as failures
    // the number would never reach zero — so the gate would be permanently red
    // and permanently ignored.
    if (pathname === '/audit/replay' && request.method === 'GET') {
      if (!env.DB) return json({ error: 'unavailable', reason: 'no DB binding' }, 503)

      const limit = Math.min(
        Number(new URL(request.url).searchParams.get('limit') ?? 25) || 25,
        100,
      )
      const rows = (
        await env.DB.prepare(
          `SELECT DISTINCT submission_id FROM verdict
            WHERE superseded_by IS NULL
            ORDER BY created_at DESC LIMIT ?1`,
        )
          .bind(limit)
          .all<{ submission_id: string }>()
      ).results

      const counts: Record<string, number> = {
        identical: 0,
        differs: 0,
        'not-comparable': 0,
        'not-re-derivable': 0,
        'record-altered': 0,
      }
      const findings: unknown[] = []
      for (const row of rows) {
        try {
          const stored = await loadStoredVerdict(env.DB, row.submission_id)
          const report = await replayVerdict(stored, await rulesForReplay(env.DB, stored))
          counts[report.status] = (counts[report.status] ?? 0) + 1
          // Only genuine disagreement is quoted back. The other non-identical
          // statuses are facts about the record's age, not about correctness.
          // An altered record is quoted back as loudly as a disagreement, and
          // is the graver of the two: a rule that moved is a mistake in this
          // revision, a reading that changed means the stored evidence moved
          // after the verdict was written.
          if (report.status === 'differs' || report.status === 'record-altered') {
            findings.push(report)
          }
        } catch (error) {
          counts.differs = (counts.differs ?? 0) + 1
          findings.push({
            submissionId: row.submission_id,
            status: 'differs',
            differences: [error instanceof Error ? error.message : String(error)],
          })
        }
      }

      const failed = (counts.differs ?? 0) + (counts['record-altered'] ?? 0)
      return json({ checked: rows.length, ...counts, findings }, failed === 0 ? 200 : 409)
    }

    // Re-derive a stored verdict from the record alone (NFR-13).
    //
    // The audit record's central claim is that a verdict can be produced again
    // without the model, the artwork, or the run that made it. This is where
    // that claim is tested rather than asserted — and it goes through the same
    // `verifySubmission` the live path uses, so a rule that changed without a
    // version bump shows up here as a disagreement instead of staying quiet.
    //
    // Disagreement is reported, not thrown: "stored CLEAR, replayed
    // DISCREPANCIES_FOUND" is the finding, and a 409 makes it hard to ignore.
    if (pathname.startsWith('/audit/replay/') && request.method === 'GET') {
      if (!env.DB) return json({ error: 'unavailable', reason: 'no DB binding' }, 503)

      const submissionId = decodeURIComponent(pathname.slice('/audit/replay/'.length))
      if (submissionId === '') return json({ error: 'no submission id' }, 400)

      try {
        const stored = await loadStoredVerdict(env.DB, submissionId)
        const report = await replayVerdict(stored, await rulesForReplay(env.DB, stored))
        return json(report, report.status === 'identical' ? 200 : 409)
      } catch (error) {
        if (error instanceof ReplayUnavailableError) {
          return json({ error: 'not-found', reason: error.message }, 404)
        }
        // A reading that no longer parses is itself the finding: the record
        // holds something the current contract cannot accept, which is a
        // re-derivability failure and not a server fault.
        return json(
          {
            error: 'not-replayable',
            reason: error instanceof Error ? error.message : String(error),
          },
          409,
        )
      }
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
        // A batch refused for its size is the caller's to fix, not a fault of
        // the service: it gets the limit, the number it sent, and a 400. Every
        // other failure is ours, and says nothing was saved.
        if (e instanceof BatchTooLarge) {
          return json({ error: e.reason, reason: e.message }, 400)
        }
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

    // What the agent decided (§18.5).
    //
    // The only ground truth this system can have. Everything else in the
    // record is the system's account of its own work; this is the one place
    // that says whether a person agreed with it, and it is what any future
    // move toward automation would have to earn its way past.
    if (pathname === '/decision' && request.method === 'POST') {
      if (!env.DB) return json({ error: 'unavailable', reason: 'no DB binding' }, 503)

      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
      if (body === null) return json({ error: 'bad_request', reason: 'expected JSON' }, 400)

      const submissionId = String(body.submissionId ?? '')
      const labelUrl = ''
      const detail = submissionId
        ? await loadSubmissionDetail(env.DB, submissionId, labelUrl)
        : null
      if (detail === null) return json({ error: 'not_found' }, 404)
      if (detail.outcome === null || detail.verdictId === null) {
        // Nothing has been checked yet, so there is no recommendation to
        // decide against — and a decision recorded against nothing would be
        // the one row in this table that means nothing.
        return json({ error: 'conflict', reason: 'this submission has no verdict yet' }, 409)
      }

      // A verdict is decided once. Without this a second POST — two tabs, a
      // double click, a retried request — appends another row, and the detail
      // view shows only the latest, so an earlier approval is masked rather
      // than superseded. Approval is a legal act; it should not be quietly
      // replaceable. A corrected submission gets a NEW verdict, and that one
      // is decidable again.
      if (await alreadyDecided(env.DB, detail.verdictId)) {
        return json({ error: 'conflict', reason: 'this verdict has already been decided' }, 409)
      }

      const note = typeof body.note === 'string' && body.note.trim() !== '' ? body.note : null
      const input = {
        decision: String(body.decision ?? ''),
        decidedBy: String(body.decidedBy ?? ''),
        recommendedOutcome: detail.outcome,
        note,
      }
      try {
        checkDecision(input)
      } catch (error) {
        if (error instanceof DecisionRejected) {
          return json({ error: 'rejected', reason: error.message }, 422)
        }
        throw error
      }

      // The recommendation is read from the verdict here rather than taken
      // from the request. A client supplying it could record the agent as
      // having agreed with something the system never said.
      await recordDecision(env.DB, {
        id: crypto.randomUUID(),
        submissionId,
        verdictId: detail.verdictId,
        decidedBy: input.decidedBy,
        decidedAt: new Date().toISOString(),
        decision: input.decision,
        recommendedOutcome: detail.outcome,
        note,
      })

      // `agreed` is computed here rather than left to the page. The browser had
      // its own copy of the rule, as a string-prefix test on the outcome name,
      // and a second implementation of "did the agent agree" is one that can
      // disagree with the one the statistics are drawn from.
      return json({
        recorded: true,
        recommendedOutcome: detail.outcome,
        agreed: !isDisagreement({ decision: input.decision, recommendedOutcome: detail.outcome }),
      })
    }

    // Single review — one label, checked now (UC-1, ui-design §4).
    //
    // The interactive path. It shares every rule with the batch path and
    // differs only in where the pixels come from, so a verdict here and a
    // verdict there are the same verdict computed the same way.
    //
    // It persists like any other review. M4 says every review produces an
    // audit record, and a second entry point that quietly produced none would
    // make that claim false while looking finished — and would lose replay,
    // retention and reference lookup, all of which key off the record.
    if (pathname === '/review' && request.method === 'POST') {
      if (!env.DB || !env.STAGING) return json({ error: 'unavailable' }, 503)

      try {
        const form = await request.formData()
        const file = form.get('label')
        const image = file instanceof File ? await file.arrayBuffer() : null
        // Not stated is null, not the empty string. The two would be different
        // values meaning the same thing, and only one of them reads as absent
        // where rule selection asks (D25).
        const productType = String(form.get('productType') ?? '').trim()
        const application = {
          brandName: String(form.get('brandName') ?? ''),
          classType: String(form.get('classType') ?? ''),
          alcoholContent: String(form.get('alcoholContent') ?? ''),
          netContents: String(form.get('netContents') ?? ''),
          productType: productType === '' ? null : productType,
        }

        // Re-enforced server-side, always. Client validation exists for
        // responsiveness and never for correctness (§4.5, §9.3).
        checkReviewRequest({ application, image })
        checkImageIntake(image as ArrayBuffer, { maxBytes: Number(env.MAX_UPLOAD_BYTES) })

        const submissionId = crypto.randomUUID()
        const jobId = crypto.randomUUID()
        const reference = await referenceCodeFor(submissionId)
        const now = new Date().toISOString()
        const sourceName = file instanceof File && file.name ? file.name : 'label image'
        const mimeType = file instanceof File && file.type ? file.type : 'image/png'

        // The artwork, kept for the results panel and purged by the same sweep
        // as everything else — a single review is a job of one, so retention
        // needs no special case.
        await env.STAGING.put(labelImageKey(jobId, submissionId), image as ArrayBuffer, {
          httpMetadata: { contentType: mimeType },
        })

        const { view, result } = await reviewOne(
          { application, image: image as ArrayBuffer, mimeType },
          {
            provider: createProvider(env),
            submissionId,
            reference,
            labelImageUrl: `/batch/${jobId}/submission/${submissionId}/label.png`,
            sourceName,
            env,
            // The archive, so this verdict binds rules that can be rebuilt
            // later rather than the file as it happens to read today.
            db: env.DB,
          },
        )

        // 'single', so this job does not surface on the batch screen. It exists
        // to hang an audit record off, not to be watched as a worklist.
        await env.DB.prepare(
          `INSERT INTO job (id, created_at, state, item_count, kind)
           VALUES (?, ?, 'COMPLETE', 1, 'single')`,
        )
          .bind(jobId, now)
          .run()
        await env.DB.prepare(
          `INSERT INTO submission
             (id, job_id, source_name, content_digest, byte_size, content_key, state,
              created_at, reference_code)
           VALUES (?, ?, ?, ?, ?, NULL, 'COMPLETED', ?, ?)`,
        )
          .bind(
            submissionId,
            jobId,
            sourceName,
            await sha256Hex(image as ArrayBuffer),
            (image as ArrayBuffer).byteLength,
            now,
            reference,
          )
          .run()

        // The record, on the same terms as a batch item: extraction rows, the
        // verdict with its version set, the field and warning rows, and a
        // chained event carrying the digest of the reading. Without this a
        // review would be unreplayable and absent from the audit history while
        // appearing, on screen, to have been checked exactly like any other.
        const plan = buildPersistPlan(
          result,
          {
            verdictId: crypto.randomUUID(),
            submissionId,
            labelExtractionId: crypto.randomUUID(),
            recordExtractionId: null,
          },
          // No rasterisation happened: the agent supplied the pixels. Recorded
          // as null rather than as a DPI nobody chose, because an UNREADABLE
          // here is not an artefact of a resolution this system picked.
          null,
        )
        await persistResult(env.DB, plan, 'COMPLETED', now)
        await appendAudit(env.DB, {
          at: now,
          agent: SYSTEM_AGENT,
          actor: 'system',
          action: 'verdict.recorded',
          subjectType: 'verdict',
          subjectId: plan.verdict.id,
          detail: [
            `submission=${submissionId}`,
            `outcome=${result.outcome}`,
            `path=single`,
            `provider=${result.provenance.label.provider}`,
            `model=${result.provenance.label.modelId}`,
            `prompt=${result.provenance.label.promptVersion}`,
            `record=declared`,
            `labelDigest=${await sha256Hex(result.rawResponses.label)}`,
            `reference=${result.warning.referenceDataVersion}`,
            `legible=${result.warning.legible}`,
          ].join(';'),
        })

        return json(view)
      } catch (error) {
        if (error instanceof ReviewRejected) {
          // The field, so the screen can move focus to it (§4.5).
          return json({ error: 'invalid', field: error.field, reason: error.message }, 400)
        }
        if (error instanceof IntakeRejected) {
          return json({ error: error.reason, field: 'image', reason: error.message }, 400)
        }
        return json(
          {
            error: 'review_unavailable',
            reason:
              'The label reading service is not responding. Nothing is wrong with your ' +
              'label — please try again in a moment.',
            fault: faultOf(env, error),
          },
          503,
        )
      }
    }

    // Run the retention sweep now, instead of waiting for 03:20.
    //
    // The same function the schedule calls, so exercising this exercises the
    // nightly job rather than a parallel path that happens to work. It takes
    // no window: an endpoint that could shorten the retention period is an
    // endpoint that could delete every submission in the system with one
    // parameter. To test the sweep, backdate a job — not the policy.
    //
    // Idempotent, so calling it twice is harmless: the second run finds every
    // candidate already marked and does nothing.
    if (pathname === '/retention/sweep' && request.method === 'POST') {
      if (!env.DB || !env.STAGING) return json({ error: 'unavailable' }, 503)
      const windowDays = retentionWindowDays(env)
      // Refused rather than defaulted. Deleting applicant content on a window
      // nobody configured is the one outcome worse than not deleting it.
      if (windowDays === null) {
        return json({ error: 'unconfigured', reason: 'RETENTION_WINDOW_DAYS is not set' }, 503)
      }
      const result = await sweepRetention(env.DB, env.STAGING, new Date(), windowDays)
      return json({ ...result, windowDays })
    }

    // Bring the archive rows into agreement with the reviewed file (D45).
    //
    // Called by the deploy, after migrations, in the same place and for the
    // same reason as `migrate:` — the schema and the policy both have to be
    // current before the revision serves a request.
    //
    // Unauthenticated, like every other operational endpoint here, and that is
    // less alarming than it sounds: reconciliation applies the file that is
    // already deployed, and it is idempotent. Calling it achieves exactly what
    // deploying achieved. It cannot introduce a rule, because it has no input
    // — the only way to change the rules is to change the reviewed file and
    // ship it.
    if (pathname === '/policy/reconcile' && request.method === 'POST') {
      if (!env.DB) return json({ error: 'unavailable', reason: 'no DB binding' }, 503)
      const report = await reconcileArchive(env.DB, POLICY_SET.rules, {
        now: new Date().toISOString(),
        reconciliationId: crypto.randomUUID(),
        // D27: no rule reaches force without a named human approval. A rule
        // that names no approver inherits the set's.
        setApprovedBy: POLICY_SET.approvedBy,
        // Falls back to the deployment when a rule names no approver — a draft
        // has none by definition, and saying so beats attributing it to nobody.
        // A deployment applying what was reviewed. The reconciler resolves
        // this to an agent itself: the approver named in the file where there
        // is one, the deployment otherwise (§19.3).
        actor: 'deploy',
      })
      return json(report)
    }

    // What the archive holds, and whether it still matches what was reviewed.
    if (pathname === '/health/policy' && request.method === 'GET') {
      if (!env.DB) return json({ error: 'unavailable', reason: 'no DB binding' }, 503)
      const health = await archiveHealth(env.DB, POLICY_SET.rules)
      return json(
        {
          ...health,
          policySetVersion: POLICY_SET.policySetVersion,
          activeInFile: POLICY_SET.rules.filter((r) => r.status === 'active').length,
          draftsInFile: POLICY_SET.rules.filter((r) => r.status !== 'active').length,
        },
        // Drift is a deployment problem, not a request failure: the rules being
        // enforced are not the ones anybody reviewed, and the deploy gate
        // should fail on it the way it fails on a drifted retention policy.
        health.inSync ? 200 : 503,
      )
    }

    // Find a review from the code an agent quoted (D21).
    //
    // This is the half of the requirement that makes the other half worth
    // having: printing a reference nobody can look up is decoration. The agent
    // reports "7K2M-4QX9 called this a mismatch and it isn't", and an operator
    // needs to reach that record without asking them to read a UUID aloud.
    //
    // Returns the location rather than the result, so there is exactly one
    // renderer for a review and this route cannot drift away from it.
    // What people actually decided, newest first (ui-design §2.3).
    //
    // Not scoped to a reviewer. This deployment authenticates nobody, so a
    // role-gated history would imply an access control that does not exist —
    // and this is the one record that says what humans did rather than what the
    // system found, which is the ground truth §18.5 says any move toward
    // automation would have to be earned against.
    //
    // Attribution is DECLARED, not verified, and the field name says so.
    if (pathname === '/audit/decisions' && request.method === 'GET') {
      if (!env.DB) return json({ error: 'unavailable', reason: 'no DB binding' }, 503)
      const limit = Math.min(
        Number(new URL(request.url).searchParams.get('limit') ?? '100') || 100,
        500,
      )
      const [decisions, agreement] = await Promise.all([
        listDecisions(env.DB, limit),
        agreementByOutcome(env.DB),
      ])
      return json({
        decisions,
        agreement,
        // Stated rather than left to be inferred from an empty list, which
        // reads as "nobody disagreed" when it means "nobody has decided".
        note:
          decisions.length === 0
            ? 'No decision has been recorded yet. This is empty because nothing has been decided, not because everything agreed.'
            : 'Attribution is the name entered by whoever decided. This deployment authenticates nobody.',
      })
    }

    // Everything needed to defend one verdict, in one answer (ui-design §2.3,
    // "Auditor / compliance reviewer").
    //
    // That row named its own blocker as "requires persistence, which N3
    // forbids". Persistence arrived with M4 and the policy layer with M11/M12,
    // so the reason no longer holds and the surface is buildable.
    //
    // Assembled here rather than left to a caller stitching four endpoints
    // together: an auditor asking "why was this approved" should not have to
    // know the shape of this system to get an answer, and a question answered
    // by four round trips is one where the answers can disagree.
    const audit = pathname.match(/^\/audit\/submission\/([^/]+)$/)
    if (audit && request.method === 'GET') {
      if (!env.DB) return json({ error: 'unavailable', reason: 'no DB binding' }, 503)

      // Accepts either the quotable code an agent read off the screen (D21) or
      // the submission id. The code is what somebody actually has.
      const given = decodeURIComponent(audit[1] ?? '')
      const code = normaliseReferenceCode(given)
      let submissionId = given
      if (isReferenceCode(code)) {
        const found = await env.DB.prepare(`SELECT id FROM submission WHERE reference_code = ?1`)
          .bind(code)
          .first<{ id: string }>()
        if (found === null) return json({ error: 'not_found', reference: code }, 404)
        submissionId = found.id
      }

      const detail = await loadSubmissionDetail(env.DB, submissionId, '')
      if (detail === null) return json({ error: 'not_found', submissionId }, 404)

      // The replay is run, not offered. An audit view that showed a button
      // nobody pressed would report a verdict as defensible without ever
      // having checked that it reproduces.
      let replay: unknown = { status: 'unavailable', reason: 'no verdict to replay' }
      if (detail.verdictId !== null) {
        try {
          const stored = await loadStoredVerdict(env.DB, submissionId)
          replay = await replayVerdict(stored, await rulesForReplay(env.DB, stored))
        } catch (error) {
          // A replay that cannot run is a finding about the record, not a
          // failure of this request — the rest of the trace is still true and
          // still worth reading.
          replay = {
            status: 'unavailable',
            reason: error instanceof ReplayUnavailableError ? error.message : 'replay failed',
          }
        }
      }

      return json({ ...detail, replay })
    }

    const lookup = pathname.match(/^\/reference\/([^/]+)$/)
    if (lookup && request.method === 'GET') {
      if (!env.DB) return json({ error: 'unavailable', reason: 'no DB binding' }, 503)

      const code = normaliseReferenceCode(decodeURIComponent(lookup[1] ?? ''))
      // A typo is answered as a typo. Sending a malformed code to the database
      // would return "not found", which tells an operator the record is gone
      // when in fact the code was mistyped — two very different problems.
      if (!isReferenceCode(code)) {
        return json({ error: 'malformed', reason: `"${code}" is not a reference code` }, 400)
      }

      const rows = (
        await env.DB.prepare(
          `SELECT id, job_id, source_name FROM submission WHERE reference_code = ?1`,
        )
          .bind(code)
          .all<{ id: string; job_id: string | null; source_name: string }>()
      ).results

      if (rows.length === 0) return json({ error: 'not_found', reference: code }, 404)
      // Reported, not silently resolved to the first. Forty bits will not
      // collide at this scale, and if it ever does the operator must see two
      // candidates rather than be handed the wrong one with confidence.
      if (rows.length > 1) {
        return json(
          {
            error: 'ambiguous',
            reference: code,
            candidates: rows.map((r) => ({ submissionId: r.id, sourceName: r.source_name })),
          },
          409,
        )
      }

      const row = rows[0] as { id: string; job_id: string | null; source_name: string }
      return json({
        reference: code,
        submissionId: row.id,
        jobId: row.job_id,
        sourceName: row.source_name,
        detailUrl:
          row.job_id === null
            ? null
            : `/batch/${encodeURIComponent(row.job_id)}/submission/${encodeURIComponent(row.id)}`,
      })
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
  /**
   * The retention sweep (B-D10, D32).
   *
   * Deletion is a step the system performs and records, not a bucket lifecycle
   * rule — that is what B-D10 was protecting, and a TTL cannot write an audit
   * event. The window itself and the reasoning behind it are in
   * `batch/retention.ts`; this handler only runs it and says what happened.
   */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (!env.DB || !env.STAGING) return

    // No window, no sweep. The schedule fires nightly and a default here would
    // delete content on a policy the deployment was never given.
    const windowDays = retentionWindowDays(env)
    if (windowDays === null) return

    ctx.waitUntil(
      sweepRetention(env.DB as D1Database, env.STAGING as R2Bucket, new Date(), windowDays),
    )
  },

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
