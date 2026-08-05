# Deployment Runbook

*Every step taken to stand this up, in order, so it can be audited and redone
from nothing. Companion to `deployment-path.md`, which explains why Cloudflare
first and a container later.*

| Field | Value |
|---|---|
| Status | Current as of 2026-08-03 |
| Environments | `staging` and `production`, with disjoint resources |
| Staging | https://alcohol-label-verify-staging.wing-lawrence.workers.dev — every merge to `main` |
| Production | https://alcohol-label-verify.wing-lawrence.workers.dev — a push to `prod` |

---

## 1. What Exists

*The audit record of the account. Every resource below was created by the
commands in §4 and nothing else.*

| Resource | Name | Identifier | Created |
|---|---|---|---|
| Cloudflare account | `Wing.lawrence@gmail.com's Account` | see `wrangler whoami` — deliberately not committed | pre-existing |

**Production** (`--env production`) — the resources created during setup, now
addressed by name rather than by default:

| Resource | Name | Identifier | Created |
|---|---|---|---|
| Worker | `alcohol-label-verify` | — | 2026-08-01 |
| R2 bucket | `alcohol-label-verify-staging` | — | 2026-08-01 |
| D1 database | `alcohol-label-verify` | `ac8a691b-3b4b-4518-9539-54fe81203529` | 2026-08-01 |
| Queue | `alcohol-label-verify-work` | `a561986bb3c448acacb971970d0f7b68` | 2026-08-01 |
| Queue | `alcohol-label-verify-dlq` | `99fd0bf7734a4816a8bc2176933ce0d0` | 2026-08-01 |
| Durable Object | `JobCoordinator` | migration tag `v1`, SQLite-backed | 2026-08-01 |

**Staging** (`--env staging`) — a disjoint set. Nothing is shared with
production, so a staging run cannot write to the production record:

| Resource | Name | Identifier | Created |
|---|---|---|---|
| Worker | `alcohol-label-verify-staging` | — | 2026-08-03 |
| R2 bucket | `alcohol-label-verify-content-staging` | — | 2026-08-03 |
| D1 database | `alcohol-label-verify-staging` | `9ac6b347-6668-408f-9c6d-998e27fbdfb1` | 2026-08-03 |
| Queue | `alcohol-label-verify-work-staging` | `1b21e606324241ae89ebf7a35c820c31` | 2026-08-03 |
| Queue | `alcohol-label-verify-dlq-staging` | `988cac1ef011491ea793d225e11cc8d6` | 2026-08-03 |
| Durable Object | `JobCoordinator` | migration tag `v1`, SQLite-backed | 2026-08-03 |

The production R2 bucket is called `…-staging` because `STAGING` is the binding
for *transient content* (B-D10) — it predates the staging environment and has
nothing to do with it. The staging environment's equivalent is named
`…-content-staging` so the two senses stay distinguishable in `r2 bucket list`.
Renaming the older bucket would mean copying its contents; it holds only
transient content, so the rename is safe to do later and is not worth a
migration now.

**Secrets depend on the provider, and the two environments now differ.**
Production reads with Workers AI, which authenticates through its binding, so
`MODEL_API_KEY` is absent there by design — not forgotten. Staging reads with
Gemini, an external API, and therefore requires it. `/health` asks whichever
vendor is configured whether a credential is needed, so neither environment is
reported broken for the other's arrangement.

To confirm this list against the account rather than trusting the table:

```bash
npx wrangler whoami
npx wrangler r2 bucket list
npx wrangler d1 list
npx wrangler queues list
npx wrangler secret list --env staging     # expect: MODEL_API_KEY
npx wrangler secret list --env production  # expect: empty
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
| `MODEL_PROVIDER` | `gemini` (staging), `workers-ai` (production) | Deliberately different. Both adapters use the same instruction and prompt version, so the two environments differ in one variable — who is reading — which is what makes B-Q4 measurable |
| `MODEL_ID` | `gemini-2.5-flash-002` (staging), `@cf/meta/llama-4-scout-17b-16e-instruct` (production) | Both pinned. The service **refuses to start** on a floating alias, and what floats differs by vendor: Cloudflare by `-latest` suffix, Google by omitting the version (D29) |
| `RASTER_DPI` | `300` | Set by the smallest text under verification. Recorded per extraction, since `UNREADABLE` may be an artefact of resolution |
| `EXTRACT_CONCURRENCY` | `5` | Governed by the provider's rate limit, not platform capacity |
| `MAX_BATCH_ITEMS` | `300` | Peak-season filing size, and a spend bound |
| `max_batch_size` (queue) | `1` | One submission per invocation. Batching would serialise the two parallel extractions against the 6-connection cap (B-D4) |

### Verifying the statutory warning (M0)

FR-5 and FR-6 rest entirely on `config/warning-statement.json`, and the corpus
cannot check it: the test submissions are generated from that same file, so a
wrong word would appear on the labels and in the reference and every case would
agree. It has to be compared against the regulation itself.

```bash
curl -sS "https://www.ecfr.gov/api/versioner/v1/full/2026-07-30/title-27.xml?part=16&subpart=C" \
  -o /tmp/ecfr16.xml
```

Then strip tags, collapse whitespace, and compare the concatenated `segments`
to the published text **programmatically**. Confirmed 2026-08-03: 283
characters, byte for byte identical.

The renderer endpoint and a browser show the same wording, and neither is the
check. A model summarising a legal text may normalise punctuation or
capitalisation without saying so, and this is a string where one word decides a
verdict — `birth defect` against `birth defects` is a real corpus case. Compare
bytes; do not read.

Re-verify when the title is reissued. `referenceIsUnverified()` reports the
status, and a deployment reading against an unconfirmed reference should say so
rather than imply an authority it does not have.

---

### AI Gateway (optional)

A proxy in front of whichever provider is configured, giving per-request
analytics, caching and rate-limit control across vendors. It exists because a
day's inference allowance was spent without anyone being able to say on what:
usage was visible only as "it worked" or as a 429.

Create it once — **AI → AI Gateway → Create Gateway** in the dashboard, name
`alcohol-label-verify` — then set two vars per environment in `wrangler.jsonc`:

```jsonc
"AI_GATEWAY_ID": "alcohol-label-verify"
```

The gateway's **name** is configuration and is committed. The **account** it
lives in is not: together they form a URL, and this repository is meant to be
readable — by a reviewer, and possibly published. A name on its own addresses
nothing.

`AI_GATEWAY_ACCOUNT` is therefore installed as a Worker secret by CI, reusing
the account id it already holds. This is a deliberate exception to "all
non-secret configuration is version-controlled": the account is an address, not
a setting, and nothing about a verdict depends on it.

Worth being precise about what the URL would expose if it did leak. A caller
who has it still cannot spend the Gemini allowance, because **this Worker
supplies the Google key in the header** — theirs would carry none. They could
pollute the gateway's analytics and consume its limits, which is an annoyance
rather than a bill. **That changes entirely if stored keys are ever configured**
— where Cloudflare holds the vendor credential so callers need not send one —
because then the URL alone is spendable and authentication stops being
optional.

Both absent means the providers talk to their vendors directly, exactly as
before. A half-configured gateway — an id with no account — also falls back to
direct rather than building a URL that would 404 every request.

**Caching is off unless `AI_GATEWAY_CACHE_TTL` is set, deliberately.** It would
make a repeated corpus run nearly free, which is why it must be opted into: a
run served from cache measures the cache, not the model, and B-Q4 asks which
model reads a 4.5pt warning best. Turn it on for a demonstration; leave it off
for a measurement.

---

### Secrets

Worker secrets, not GitHub secrets: CI passes `CLOUDFLARE_API_TOKEN` to
`wrangler`, but nothing in a workflow becomes a Worker secret by itself. They
are set once per *worker*, and survive every later deploy — `wrangler deploy`
does not clear them.

```bash
npx wrangler secret put MODEL_API_KEY --env staging   # required: staging uses Gemini
npx wrangler secret list --env staging                # names only; values are never retrievable
```

Production needs none while it reads with Workers AI.

Order matters when switching a provider: set the secret **before** changing
`MODEL_PROVIDER`. The other way round deploys a worker that cannot
authenticate, `/health` returns 503 naming the missing setting, and the deploy
fails at its verification step — loudly, but only after the upload.

CI sets it, from `GEMINI_API_KEY` on each GitHub environment. The names differ
on purpose: GitHub names a secret after the vendor that issued it, and the
worker names it after the role it plays, because which vendor fills that role
is configuration rather than a fact about the code.

The step runs **before** the deploy, and the order is load-bearing:
`wrangler secret put` publishes a new version of the worker, so setting it
afterwards would leave the verification waiting for a version id that is no
longer live.

The value travels through the step's environment rather than being
interpolated into the command line — a key containing a quote or a backslash
would break an inline JSON payload, and a command line is a worse place for a
credential than a variable. An environment with no key configured is left
untouched rather than having an empty secret written over a good one.

Secrets never appear in `wrangler.jsonc`, in the repository, or in logs (D20).
The Gemini adapter sends its key in a header rather than a query parameter for
the same reason: a URL is captured by anything that logs one.

#### Schema 11 — measurement (D52)

`0011_measurement.sql` adds token counts to `extraction` and stage timings to
`verdict`. Every column is nullable: rows written before it have none, and NULL
means *not reported* rather than zero. Nothing reads them but `/measurement`, so
an unmigrated deployment degrades to an empty measurement screen rather than an
error.

#### The reviewer credentials (D49)

Staging is a public URL that calls a metered API, so it is gated. Two pairs,
so two people can evaluate at once and either can be revoked without disturbing
the other:

| GitHub environment secret | Worker secret | Purpose |
|---|---|---|
| `POC_USER_ONE` | `POC_USER_ONE` | First reviewer's username |
| `POC_USER_ONE_PASSWORD` | `POC_USER_ONE_PASSWORD` | …and password |
| `POC_USER_TWO` | `POC_USER_TWO` | Second reviewer's username |
| `POC_USER_TWO_PASSWORD` | `POC_USER_TWO_PASSWORD` | …and password |

Set them on the **`staging` GitHub environment**, not at repository scope — the
same rule the Cloudflare credentials follow, so a workflow that does not declare
an environment cannot resolve them. CI installs each pair only when **both**
halves are present, and says in the log which of the two states it left the
deployment in.

```bash
# By hand, if ever needed. Both halves, or the pair is ignored.
npx wrangler secret put POC_USER_ONE --env staging
npx wrangler secret put POC_USER_ONE_PASSWORD --env staging
```

**With none configured the deployment is open**, and that is deliberate: a gate
that closed without a credential would brick `wrangler dev` and turn a forgotten
secret into an outage. The deploy log carries a warning when it leaves staging
open, so it is a stated fact rather than an assumption.

**It is a cost control, not a login.** It says the caller was given a
credential and nothing about who they are — see design §15.4.1. Handing a
reviewer the URL and one pair is the whole of the access procedure.

---

## 6. Deploy

Deploying is normally something you *observe*, not something you run: a merge to
`main` deploys staging, and a push to `prod` deploys production (§6.2). The
manual commands remain for a first stand-up from nothing, and for the case where
CI itself is broken.

```bash
npm run quality-check     # lint + typecheck + tests with coverage
npm run migrate:staging   # D1 first: the new code must not meet the old schema
npm run deploy:staging
```

Substitute `:production` for a production deploy. There is deliberately no bare
`npm run deploy` — it would publish the development block, whose bindings point
at production resources, to whichever worker `name` happens to resolve to.

`quality-check` first, deliberately. The `pre-push` hook enforces the same gate,
so a deploy that skips it is a deliberate act rather than an oversight.

### 6.1 Verify — and this step is not optional

```bash
npx wrangler deployments list          # confirm the version you expect is live
curl -s $URL/health | jq
curl -s $URL/health/inference | jq
curl -s $URL/health/coordinator | jq
curl -s $URL/health/raster | jq       # ~1–3 s; browser launch dominates
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

### 6.2 Continuous deployment

| Workflow | Trigger | Effect |
|---|---|---|
| `ci.yml` | pull request | Quality gate only |
| `deploy-staging.yml` | push to `main`, or manual | Migrate → deploy → verify staging |
| `deploy-production.yml` | push to `prod`, or manual | Migrate → deploy → verify production → tag `release-YYYYMMDD-HHMM` |
| `quality.yml` | called by the three above | Lint, typecheck, coverage, guard-test presence |

Verification waits for the version it just deployed. `wrangler deploy` prints a
version id, `/health` reports the id of whichever deployment answered, and the
check polls until the two match before asserting anything.

That is not decoration. Cloudflare serves the previous worker for a few seconds
after upload, and the earlier check retried until it received a 200 and then
asserted — so a healthy PREVIOUS version could satisfy a check about a broken
new one. It did: a deployment misconfigured for its inference provider passed
this gate while `/health` was returning 503. The loop written to tolerate
propagation lag was what made it accept a stale answer.

The gate lives in one reusable workflow so the check a change passes on a pull
request is the same one it passes on the way to an environment. Each deploy job
ends with the §6.1 verification as an *assertion* rather than a printout: the
run fails if `/health` is not `ok`, if it reports the wrong `environment`, or if
a required binding is missing.

Inference and rasterisation are then exercised for real, because they are the
two checks a configuration test cannot make — a binding can be present and the
dependency behind it still unreachable. Rasterisation earns its ~3 s because it
is the batch path's entry point (D33): the model is never shown a PDF text
layer, so a browser that cannot render is a batch that cannot start. Its
assertion includes `bytes > 0`, since a browser that launches and renders
nothing still reports `ok`.

The deploy step itself retries once. The Cloudflare API can return a 521 with an
HTML body on a trailing call: on run `30780074509` the script had uploaded and
the deployment had reached 100%, and only the subdomain registration failed —
a red run over work that had already landed. `wrangler deploy` is idempotent, so
the retry costs an upload and settles whether the failure was the revision or
the API. The verification steps remain the arbiter: a deploy that did land
passes them, and one that did not, fails.

The raster probe retries once; the inference probe does not. Browser Rendering
admits roughly 10 new instances per second (§15.4), so a refused launch says
nothing about the revision being deployed, and failing a good deploy on
contention would train people to ignore the check. Workers AI has no comparable
launch step, so a first failure there is a real one.

`modelApiKey` is excluded from the binding assertion: it is `false` by design
under Workers AI, so requiring every binding to be `true` would fail every
deploy.

GitHub configuration, done once. Both secrets are set on **each** environment,
`staging` and `production`:

| | |
|---|---|
| Environments | `staging`, `production` — created. Add a required reviewer to `production` to gate promotion |
| Secret `CLOUDFLARE_API_TOKEN` | Workers Scripts Edit (upload), D1 Edit (`migrations apply --remote`), Queues Edit (consumer attach), Browser Run Edit. Or the "Edit Cloudflare Workers" template |
| Secret `CLOUDFLARE_ACCOUNT_ID` | The account id, from `wrangler whoami`. Also installed as `AI_GATEWAY_ACCOUNT` on the worker |

Both secrets are held **per environment**, not at repository scope: `staging`
and `production` each carry their own `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID`. Nothing remains at repository level.

Placement is the control, and it is what makes a required reviewer on
`production` load-bearing rather than advisory. A repository secret is readable
by any job on any branch, so a token sitting there could be taken by a workflow
that never declares an environment and never meets the gate. An environment
secret can only be resolved by a job declaring that environment. Both deploy
jobs declare one and read the credentials in a single job-level `env` block; the
two jobs that declare none — `quality` and `tag-release` — need no Cloudflare
credentials, so nothing is left resolving against an empty scope. Each deploy
job asserts the credentials resolved before it does anything else, because a
missing environment secret otherwise surfaces as an opaque `wrangler` auth
error several minutes in.

The two tokens may hold the same value today, and that is sufficient: Cloudflare's
Workers, D1 and Queues permissions are account-scoped — there is no per-database
or per-script resource selector — so a staging-only token could still migrate the
production database. Distinct values would buy revocation independence and audit
attribution, not isolation, and can be introduced later by changing one secret
with no workflow change. The isolation that does exist is structural: disjoint
resource names, `--env` on every command, and `/health` asserting the deployed
`environment` matches.

Queues Edit is required because a queue *consumer* is a trigger, attached to the
queue by a separate API call after the script upload — `wrangler deploy` prints
it on its own line. It is the only binding here whose deploy mutates a second
resource.

AI and R2 need no scope: those bindings are declarations in the script metadata,
and the worker authenticates to Workers AI through the binding at runtime rather
than through this token — the same fact that makes `MODEL_API_KEY` absent by
design. Browser Run Edit (the current name for Browser Rendering) is on the
token by choice rather than requirement.

Promotion to production is a branch push, not a merge to `main`, so that a
revision has run somewhere real before it is the thing a compliance agent sees.

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

## 8a. Platform Limits That Shape the Design

*Measured against the account, not quoted from a brochure. Every one of these
changed a design decision.*

| Limit | Free | Paid | Consequence here |
|---|---|---|---|
| Browser Rendering: new instances | **1 per 20 s** | 1 per second | The binding constraint on batch throughput. Not concurrency — pacing. Setting `max_concurrency: 1` was necessary and nowhere near sufficient |
| Browser Rendering: concurrent | 3 | 120 | Never reached; the launch *rate* bites first |
| Browser Rendering: browser time | 10 min/day | usage-priced | About five full corpus runs a day, before pre-rasterisation removed the browser from the corpus path entirely |
| Workers AI | 10,000 neurons/day | + $0.011 / 1,000 | One corpus run is roughly 2,000–8,000 neurons, so the allowance is one to four runs |
| Workers AI model input | images inside `messages` as `image_url` parts | — | A sibling `image` property is **accepted and ignored** by llama-4-scout |
| Gemini free tier | a few requests | usage-priced | The key survived four calls: two probes and two batch items |
| Queue message | 128 KB | — | Content goes to R2, keys travel in the message |
| Worker isolate | 128 MB, no native modules | — | Rules out in-Worker rasterisation of a 300 DPI page |
| Outbound connections | 6 per invocation | — | Fan out across invocations, never inside one |

The two that mattered most were both **rates**, not sizes, and both were
diagnosed as something else first: browser launches were blamed on concurrency,
and inference failures on image dimensions. A ceiling measured over time looks
like a capacity problem until the clock is part of the measurement.

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
| Every submission rejected: `page size NaNxNaNpt, undefined page(s)` | `page.evaluate(source, ...args)` with a **string** first argument evaluates it as an expression and ignores the arguments — the render script was never invoked | Build the call expression explicitly (`page-script.ts`) |
| Every field returned `<text exactly as printed>`, and a compliant label's record read `Old Forester` | The image was sent as a sibling of `messages`; the model ignored it and answered from the prompt alone — echoing the template, and inventing plausible values under schema pressure | Send `image_url` content parts; guard the contract against template echoes (CT-11) |
| `provider returned an empty response` on every item, worsening after the corpus improved | Workers AI returns the answer already parsed when it is well-formed JSON; the adapter accepted only strings. The better the model read, the more reliably its answer was discarded | Read `response` as string **or** object, falling back to `choices[0].message.content` |
| `response was not valid JSON` from Gemini | A thinking model returns reasoning as parts beside the answer; joining all of them wrapped the JSON in prose | Exclude `thought` parts; disable thinking for extraction |
| Liveness probe reported a truncation on a healthy model | `ping()` asked for 8 output tokens with thinking on, so the budget went entirely to reasoning | Probe under the same settings production uses |
| 24 of 26 items failed with `429`, always the first submissions in the queue | A rate-limited item released its queue slot, so later items inherited the wait and earlier ones exhausted their attempts. Failure tracked queue position, not the artwork | Hold the item in place through the backoff (`retry.ts`) |
| The whole worklist read "Checking…" while one item ran | A deferred item stayed `RUNNING` in the ledger; with 5–40 s waits nearly every item looked active. It also stopped `attempts` incrementing, since `startItem` only transitions from `QUEUED` | `deferItem` returns it to `QUEUED` and broadcasts |
| A finished job blocked every later batch | "Running" was inferred from rows left `QUEUED`, which is also what an abandoned job looks like for ever. Starting joins a job in flight, so every new batch attached to the corpse | `POST /batch/reset`, settling both stores |
| A misconfigured deploy passed its own gate | Verification retried until it got a 200, and during propagation that 200 came from the version being replaced | Poll `/health` until the version id matches the one just deployed |
| A sound revision failed the deploy gate under Gemini | The gate matched Cloudflare's error words (`4006`, `neurons`) in a workflow that deploys whichever provider is configured | `/health` reports the provider's own `fault`; the gate acts on that |
| `models/gemini-2.5-flash-002 is not found` | An id invented to satisfy a pinning rule that assumed Google versions by suffix. It versions by omission, and retired numbered pins after 2.0 | Ask the API: `/health/models` |

---

## 10. What Is Not Yet Set Up

| Missing | Consequence |
|---|---|
| Custom domain | The `workers.dev` subdomain is the only route |
| Smoke test against the corpus | Staging is verified by health probes, not by submitting a known label and asserting its verdict. `/health/extract` is half of it: it reads a known label, but nothing compares the reading to authored ground truth |
| A corpus run that finishes | Neither provider has had the quota to complete 26 items. The exit criteria — `L01` CLEAR, `L04` DISCREPANCIES_FOUND — remain unmeasured, and every failure so far has been a platform limit rather than a verification result |
| A Durable Object test harness | `vitest.config.ts` is `environment: 'node'`; the workers pool its own comment describes is not configured, so the coordinator is exercised only by `/health/coordinator` |
| Rollback from CI | Rollback is the manual §7 command; no workflow reverts a bad deploy |
| Retention enforcement | `schema_meta.retention_policy` is `UNSET`; nothing purges the record |
| Alerting | Logs are queryable; nothing watches them |
| Authentication | Deliberate for the prototype (D14) — a gated URL fails closed for a reviewer |

Each is a stage-2 or later concern in `deployment-path.md` §8, not an oversight.
