# CLAUDE.md

This file provides guidance to AI assistants when working with
alcohol-label-verify.

Prototype that checks alcohol label artwork against its TTB application and
verifies the statutory health warning. It produces evidence for a compliance
agent — it does not approve or reject.

**Live:** https://alcohol-label-verify.wing-lawrence.workers.dev

## Required Reading

Before making changes, review these documents. **They are the specification, not
background.** When code and a document disagree, one of them is wrong — resolve
it, do not leave both.

- **[docs/exploration-session.md](docs/exploration-session.md)** — how the
  problem was worked and what was settled. Read this first if you are picking
  the work up cold
- **[docs/design.md](docs/design.md)** — requirements, architecture, verification
  logic, provenance, 32 logged decisions
- **[docs/test-plan.md](docs/test-plan.md)** — **§3 is the executable spec**:
  ~130 enumerated unit cases with inputs and expected outcomes
- **[docs/ui-design.md](docs/ui-design.md)** — screens, states, every string
- **[docs/batch-backend-design.md](docs/batch-backend-design.md)** — job
  orchestration, document normalisation, platform mapping
- **[docs/deployment-path.md](docs/deployment-path.md)** — Workers → container.
  **§6 rules are binding**
- **[docs/implementation-plan.md](docs/implementation-plan.md)** — per-milestone
  stories and **exit criteria**; check these before calling a milestone done
- **[docs/deployment-runbook.md](docs/deployment-runbook.md)** — every resource,
  every step, verification, rollback, teardown
- **[docs/project-reference.md](docs/project-reference.md)** — stakeholders,
  verified TTB context, open questions

## The Governing Principle

> **The model reads. The rules compare. The human decides.**

Extraction is confined to perception. Every verdict is computed by deterministic
code from versioned reference data. Most of the design follows from that one
sentence. If a change would blur it, the change is wrong.

## Critical Rules

1. **TDD ALWAYS**: write tests BEFORE code — and here they already exist on
   paper (see below)
2. **No `any` types**: use explicit types or `unknown`
3. **Keep the core pure**: comparison, warning verification and aggregation take
   no clock, no randomness, no I/O, no platform API
4. **The extractor never sees expected values** (D4) — anchoring produces false
   *matches*, and every one is a non-compliant label passing
5. **Label artwork is read from pixels, never a PDF text layer** — a text layer
   can disagree with what the page displays
6. **`UNREADABLE` outranks every other verdict** (D5)
7. **Logs carry identifiers and timings, never content** (D20)
8. **Model identifiers are fully qualified, never floating** (D29)
9. **Coordinator operations are atomic by contract** (deployment-path R3)
10. **Quality check**: run `npm run quality-check` before commits

## TDD Workflow

Every change follows: RED → GREEN → REFACTOR → COMMIT

```
┌─────────────────────────────────────────────────────────────┐
│  1. RED    → Write a failing test first                     │
│  2. GREEN  → Write minimum code to pass (ugly is OK)        │
│  3. REFACTOR → Clean up while tests stay green              │
│  4. COMMIT → Only commit when tests pass                    │
└─────────────────────────────────────────────────────────────┘
```

**The tests are already written — on paper.** `test-plan.md` §3 enumerates the
unit cases with inputs and expected outcomes, derived from requirements before
any code existed. So the loop starts by *transcribing the catalogue*, not by
inventing cases. That is stronger than ordinary test-first discipline: the cases
cannot have been shaped to fit an implementation that did not exist.

For any comparison rule:

1. Find its cases in test-plan §3 (`UT-N`, `UT-A`, `UT-Q`, `UT-W`, `UT-G`)
2. Write them as tests, with the test ID in the name
3. Watch them fail
4. Implement
5. Confirm the requirements matrix (§12) still holds

**TDD checklist (before each commit):**
- [ ] I wrote the test BEFORE the implementation
- [ ] The test failed initially (proved it tests something real)
- [ ] I wrote only enough code to make it pass
- [ ] I refactored without breaking tests
- [ ] `npm run quality-check` passes

## Six Guard Tests

These protect stated correctness properties. They must never fail, and must
never be deleted to make a suite green. CI checks they are still present.

| Test | Guards |
|---|---|
| `UT-G03`, `UT-G04` | An unreadable field can never aggregate to a clear result |
| `UT-W05` | Title-case `Government Warning:` fails |
| `UT-W12` | A meaning-preserving **paraphrase** of the warning fails |
| `UT-N08` | `Old Tom` does not match `Old Tom Distillery` |
| `CT-10` | The extraction call site has no access to application data |

`UT-W12` and `CT-10` are the subtle ones. If either starts *passing* when it
should fail, a boundary has been crossed silently.

## Required Test Categories for Verification Paths

Coverage % alone hides quality gaps — every branch can be "covered" by a
happy-path test while real failure modes go untested. For any change to a
verification path, every applicable category below needs at least one explicit
test:

| Category | What it asserts | Why it catches real bugs |
|---|---|---|
| **Happy path** | A compliant submission produces `CLEAR` with no false discrepancy | Confirms the feature works at all |
| **Genuine discrepancy** | A real mismatch is reported, on the right field, with the rule named | Catches over-permissive matching |
| **Tolerance boundary** | The case that *should* match (`STONE'S THROW`) and the neighbouring case that should *not* (`Old Tom` vs `Old Tom Distillery`) | Catches tolerance applied in the wrong direction — which produces false passes |
| **Degraded input** | An unreadable field yields `UNREADABLE`, never a value | Catches fabrication under schema pressure (§8.3.2) — the dangerous failure |
| **Dependency failure** | Provider timeout or schema-invalid response → item `FAILED`, no verdict issued | Catches a malformed response being parsed into a finding |
| **Adversarial** | A label carrying injected instruction text alongside a real mismatch still reports the mismatch | Catches injection reaching a verdict |
| **Aggregation ordering** | `UNREADABLE` present alongside any other state still yields `INCOMPLETE` | Catches a non-compliant label passing because the system was blind to it |

If a change touches a verification path without a test in each applicable
category, ask which was deliberately omitted and why. **Do not ship a
verification rule tested only on the happy path.**

## Tech Stack

- Runtime: Cloudflare Workers, Durable Objects, Queues, R2, D1
- Language: TypeScript 5.9 (strict, `noUncheckedIndexedAccess`)
- Inference: **two adapters behind one seam** — Workers AI (binding-authed) and
  Gemini (API key). `MODEL_PROVIDER` selects; each vendor answers for its own
  credential requirement, floating-alias rule and fault classification (D33)
- Testing: Vitest, `@cloudflare/vitest-pool-workers`
- Linting: Biome 2.x
- Test corpus: Python + Chrome (generation only, not runtime)

## Project Structure

```
alcohol-label-verify/
├── src/
│   ├── index.ts             # Worker entry, health probes, queue consumer
│   ├── job-coordinator.ts   # Durable Object: ledger, progress, fan-out
│   └── domain/              # Pure verification logic — coverage enforced here
├── migrations/              # D1 schema (append-only audit_event)
├── config/                  # Reference data: statutory warning text (D3)
├── testdata/                # 26 submissions + authored ground truth
├── docs/                    # The specification
└── .github/workflows/       # CI
```

## Commands

```bash
npm run dev              # Local worker
npm test                 # Full suite
npm run quality-check    # Lint + typecheck + tests with coverage
npm run lint:fix         # Auto-fix
npm run deploy:staging   # Or :production — there is no bare `deploy`
npm run migrate:staging  # D1, --remote. Runs before a deploy, never after
npm run tail:staging     # Live logs
npm run corpus           # Rebuild the 26 test submissions
npm run docs:pdf         # Combined design PDF
```

## Testing Coverage Targets

| Scope | Target | Why |
|---|---|---|
| `src/domain/**` | **95% lines, 90% branches** | Pure, free to test, and it *is* the product |
| Everything else | No threshold | Covered by contract tests, not line count |

**No repository-wide percentage, deliberately.** A global target rewards testing
plumbing and says nothing about whether the rules are correct. The real gate is
test-plan §12: every Must-priority requirement maps to a passing test.

## Common Pitfalls

*Every one below was paid for. See `deployment-runbook.md` §9 for the full log.*

**Diagnosis**

- **An error message must say what was observed, not what was inferred.**
  "Provider returned an empty response" described a failed type check; the
  model was reading the label perfectly, and the wrong sentence cost three
  rounds. When a message and reality disagree, suspect the message — you wrote
  it (D38)
- **Dump the wire before theorising.** Every failure today that was reasoned
  about took rounds; every one where the actual request or response was printed
  resolved immediately
- **A test that has never failed proves nothing.** A scripted edit whose pattern
  did not match wrote no test at all, and the suite went green
- **Read the file after a scripted edit.** A second replace matched too little
  and left dead logic below the new code; both ran, and the old path won

**Providers**

- Images go **inside `messages`** as `image_url` parts. A sibling `image`
  property is accepted and silently ignored, and the model then answers from
  the prompt alone — echoing the schema or inventing a plausible value
- The answer is not always a string: Workers AI returns it already parsed when
  it is well-formed JSON. Read `response` as string or object, then
  `choices[0].message.content`
- A thinking model returns reasoning as parts beside the answer. Join only the
  parts without `thought: true`, and switch thinking off — extraction is
  perception, not deliberation
- Ask, do not guess, which models exist: `/health/models`
- What counts as a floating alias differs by vendor. Cloudflare floats with a
  `-latest` suffix; Google floats by *omitting* a version

**Rates and limits**

- The binding constraints are **rates**, not sizes: Browser Rendering admits one
  new browser every 20 s on the free plan, and a 429 arrives in 40 ms, so an
  immediate retry is refused before it could have cleared
- A rate limit clears by waiting; an exhausted daily allowance does not. Confuse
  them and you either abandon a batch that needed ninety seconds or spend the
  whole queue proving the same dead end (D37)
- A rate-limited item must keep its queue slot, or failure tracks queue position
  rather than the submission (B-D14)

**Deployment**

- `process.env` does not exist in Workers → use the `env` argument
- **A deploy can succeed with a binding silently missing** — always check the
  binding list that `wrangler deploy` prints
- **Verify the version you just deployed.** Cloudflare serves the previous
  worker for seconds after upload, so a check that retries until it gets a 200
  can certify the version it was replacing — it did
- `wrangler secret put` publishes a new version, so set secrets **before**
  deploying or the version check waits for one that is no longer live
- An account condition — spent quota, rate limit — is not a defect in the
  revision. Warn; do not fail the deploy
- Cloudflare propagation lags a few seconds after deploy; retry before
  diagnosing a failure
- Queue messages cap at 128 KB → content goes to R2, keys go in the message
- 6 simultaneous outbound connections per invocation → fan out across
  invocations, never inside one
- The coordinator must never fetch, rasterise, or extract (B-D12)
- Don't generate `.md` files unless asked
- No magic numbers → named constants

## Deployment

- **Staging is `main`**: every merge migrates, deploys and health-checks
  `alcohol-label-verify-staging`. Production is a push to `prod`
- Environments are disjoint — separate worker, D1, R2 bucket and queues — so a
  staging run can never write to the production record
- Manual fallback: `npm run migrate:<env> && npm run deploy:<env>`, in that order
- Health: `/health`, `/health/inference`, `/health/coordinator`,
  `/health/raster`. CI asserts on these rather than printing them, including
  `bytes > 0` on the raster probe; `modelApiKey: false` is correct under
  Workers AI and is excluded from the binding assertion
- Secrets via `wrangler secret put`, never in `wrangler.jsonc`. This deployment
  currently holds none
- Full detail: [docs/deployment-runbook.md](docs/deployment-runbook.md) §6

## Open, and Worth Knowing

| | |
|---|---|
| **M0** | The statutory warning text is **unverified** against ecfr.gov. FR-5 rests on it |
| **B-Q4** | Is 300 DPI enough to read the warning? Measurable against the corpus; sets cost and latency per item |
| Model choice | Five vision models available; which reads small text best is a measurement not yet made |
| Retention | `schema_meta.retention_policy` is `UNSET`. D32 made retention a real obligation |
| Gemini | Wired and working — reads the corpus correctly. The key's quota is tiny: it survived four calls before a persistent 429 |
| B-Q4 | Now answerable. Two providers, one instruction, one prompt version — a corpus run under each is a controlled comparison (D34). Neither has quota today |
| Corpus fidelity | The labels are crisp vector text, not photographs. Accuracy measured here overstates real-world reading, and only L09/L10 approximate a degraded scan |
