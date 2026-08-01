# Deployment Runbook

*Every step taken to stand this up, in order, so it can be audited and redone
from nothing. Companion to `deployment-path.md`, which explains why Cloudflare
first and a container later.*

| Field | Value |
|---|---|
| Status | Current as of 2026-08-01 |
| Environment | Single — no staging/production split yet |
| Live | https://alcohol-label-verify.wing-lawrence.workers.dev |

---

## 1. What Exists

*The audit record of the account. Every resource below was created by the
commands in §4 and nothing else.*

| Resource | Name | Identifier | Created |
|---|---|---|---|
| Cloudflare account | `Wing.lawrence@gmail.com's Account` | `fb1dbb92cdbbab3ebd151838821ce3e5` | pre-existing |
| Worker | `alcohol-label-verify` | — | 2026-08-01 |
| R2 bucket | `alcohol-label-verify-staging` | — | 2026-08-01 |
| D1 database | `alcohol-label-verify` | `ac8a691b-3b4b-4518-9539-54fe81203529` | 2026-08-01 |
| Queue | `alcohol-label-verify-work` | `a561986bb3c448acacb971970d0f7b68` | 2026-08-01 |
| Queue | `alcohol-label-verify-dlq` | `99fd0bf7734a4816a8bc2176933ce0d0` | 2026-08-01 |
| Durable Object | `JobCoordinator` | migration tag `v1`, SQLite-backed | 2026-08-01 |

**No secrets are set.** Workers AI authenticates through its binding, so
`MODEL_API_KEY` is absent by design — not forgotten. `/health` accounts for this:
validation is provider-aware, and a binding-authed provider is not asked for a
credential.

To confirm this list against the account rather than trusting the table:

```bash
npx wrangler whoami
npx wrangler r2 bucket list
npx wrangler d1 list
npx wrangler queues list
npx wrangler secret list          # expect: empty
npx wrangler deployments list
```

---

## 2. Prerequisites

| Tool | Version used | Needed for |
|---|---|---|
| Node | 22.20.0 | Runtime and tooling |
| npm | 10.9.3 | Dependencies |
| Cloudflare account | — | Workers paid plan not required for this scope |
| Python 3 | 3.11 | Test corpus generation only |
| Google Chrome | — | Test corpus rendering only |

Python and Chrome are **build-time only**. Nothing at runtime depends on them.

---

## 3. Initialise From Nothing

*If the repository is lost, this recreates it. If only the Cloudflare account is
lost, skip to §4.*

```bash
git clone git@github.com:wingyanlau/alcohol-label-verify.git
cd alcohol-label-verify
npm ci                     # exact versions from package-lock.json
npx wrangler login         # interactive: opens a browser
npx wrangler whoami        # confirm the expected account
```

`npm ci` rather than `npm install` — a runbook that resolves versions afresh does
not reproduce anything.

---

## 4. Create the Cloudflare Resources

*Run in this order. Each is idempotent enough to re-run safely; a bucket or
queue that already exists reports so and does not duplicate.*

```bash
# 4.1  Transient content staging. Submission PDFs and rasterised regions live
#      here for the life of a job, then are purged (B-D10).
npx wrangler r2 bucket create alcohol-label-verify-staging

# 4.2  The durable record: jobs, submissions, extractions, verdicts, and the
#      append-only transaction history (D32).
npx wrangler d1 create alcohol-label-verify
#      -> note the database_id it prints and put it in wrangler.jsonc

# 4.3  Work distribution, with a dead-letter target.
npx wrangler queues create alcohol-label-verify-work
npx wrangler queues create alcohol-label-verify-dlq
```

**The Durable Object needs no create step.** It is declared in `wrangler.jsonc`
with a migration tag and comes into existence on first deploy.

### 4.4 Apply the schema

```bash
npx wrangler d1 migrations apply alcohol-label-verify --remote
```

Omitting `--remote` migrates the *local* development database instead, and the
deployed Worker will then fail its schema check. `/health` catches this: a
missing `schema_meta` row is reported as a configuration problem rather than
silently tolerated.

Verify:

```bash
npx wrangler d1 execute alcohol-label-verify --remote \
  --command "SELECT key, value FROM schema_meta"
```

---

## 5. Configuration

All non-secret configuration is in `wrangler.jsonc` and is version-controlled, so
a deployment's settings are auditable from the repository rather than from a
dashboard.

| Setting | Value | Why it is what it is |
|---|---|---|
| `compatibility_date` | `2026-08-01` | Pinned. A floating runtime date changes behaviour beneath a recorded audit trail — the same reasoning as D29 |
| `MODEL_PROVIDER` | `workers-ai` | Gemini was intended; its key has zero project quota |
| `MODEL_ID` | `@cf/meta/llama-4-scout-17b-16e-instruct` | Fully qualified. The service **refuses to start** on a floating alias (D29) |
| `RASTER_DPI` | `300` | Set by the smallest text under verification. Recorded per extraction, since `UNREADABLE` may be an artefact of resolution |
| `EXTRACT_CONCURRENCY` | `5` | Governed by the provider's rate limit, not platform capacity |
| `MAX_BATCH_ITEMS` | `300` | Peak-season filing size, and a spend bound |
| `max_batch_size` (queue) | `1` | One submission per invocation. Batching would serialise the two parallel extractions against the 6-connection cap (B-D4) |

### Secrets

None currently. When an external provider is wired:

```bash
npx wrangler secret put MODEL_API_KEY
npx wrangler secret list          # names only; values are never retrievable
```

Secrets never appear in `wrangler.jsonc`, in the repository, or in logs (D20).

---

## 6. Deploy

```bash
npm run quality-check     # lint + typecheck + tests with coverage
npm run deploy
```

`quality-check` first, deliberately. The `pre-push` hook enforces the same gate,
so a deploy that skips it is a deliberate act rather than an oversight.

### 6.1 Verify — and this step is not optional

```bash
npx wrangler deployments list          # confirm the version you expect is live
curl -s $URL/health | jq
curl -s $URL/health/inference | jq
curl -s $URL/health/coordinator | jq
```

**A deploy can succeed with a binding silently missing.** This happened during
setup: an edit to `wrangler.jsonc` did not match, the deploy reported success,
and the Worker ran without a coordinator. Nothing failed — it simply was not
there.

So check the binding table that `wrangler deploy` prints, and check `/health`
reports every binding `true`. Expected when healthy:

```json
{
  "status": "ok",
  "bindings": { "staging": true, "database": true, "inference": true,
                "workQueue": true, "jobCoordinator": true, "modelApiKey": false },
  "schemaVersion": "1",
  "problems": []
}
```

`modelApiKey: false` is correct for Workers AI.

**Wait a few seconds before diagnosing.** Cloudflare propagation lags briefly
after a deploy; two apparent failures during setup — an error 1042 on `/` and
bindings reading `false` — were both propagation and resolved on retry.

---

## 7. Rollback

Every deploy creates an immutable version. Roll back without rebuilding:

```bash
npx wrangler versions list                 # 10 most recent
npx wrangler versions view <version-id>
npx wrangler rollback <version-id>
```

**Code rolls back; the database does not.** D1 migrations are forward-only, and
`audit_event` is append-only by trigger — a rolled-back deploy still faces the
newer schema. Any migration that a previous version could not tolerate needs a
compensating migration, not a rollback.

---

## 8. Teardown

*Destructive and in dependency order. The record store is listed last because it
is the only thing here that cannot be regenerated.*

```bash
npx wrangler delete                                        # the Worker
npx wrangler queues delete alcohol-label-verify-work
npx wrangler queues delete alcohol-label-verify-dlq
npx wrangler r2 bucket delete alcohol-label-verify-staging # transient content
npx wrangler d1 delete alcohol-label-verify                # THE RECORD — irreversible
```

Deleting the Worker also removes its Durable Objects and their storage, which is
where live job ledgers sit. Confirm no job is running first.

---

## 9. Problems Encountered, and Their Fixes

*Recorded because each cost time and each would recur.*

| Problem | Cause | Fix |
|---|---|---|
| `npm install` failed: no `@cloudflare/workers-types@^4…` | The package is on **v5** | Pin the version the registry actually reports, not the one assumed |
| Deploy succeeded, `JOB` binding absent | A `wrangler.jsonc` edit silently did not match | Always read the printed binding table after deploy |
| `/` returned Cloudflare error 1042 | Propagation lag on the first request after deploy | Retry before diagnosing |
| `/health` showed bindings `false` after a correct deploy | Same propagation lag | Wait a few seconds |
| Gemini returned HTTP 429, `quota_limit_value: "0"` | Zero quota on the project — not a rate limit | Wired Workers AI instead; the provider seam is unchanged |
| Biome warned `recommended` is deprecated | Biome 2.x renamed it to `preset` | Migrate the config |
| Queue consumer failed typecheck | `ExportedHandler<Env>` needs the message type parameter | `ExportedHandler<Env, WorkMessage>` |

---

## 10. What Is Not Yet Set Up

| Missing | Consequence |
|---|---|
| Staging environment | One environment; a deploy goes straight to the live URL |
| Automated deploy from CI | CI runs quality checks only; deployment is manual |
| Custom domain | The `workers.dev` subdomain is the only route |
| Retention enforcement | `schema_meta.retention_policy` is `UNSET`; nothing purges the record |
| Alerting | Logs are queryable; nothing watches them |
| Authentication | Deliberate for the prototype (D14) — a gated URL fails closed for a reviewer |

Each is a stage-2 or later concern in `deployment-path.md` §8, not an oversight.
