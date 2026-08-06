# alcohol-label-verify

A prototype that checks an alcohol beverage label against the application it was
filed with, and verifies the health warning required by 27 CFR 16.21.

An agent uploads a completed TTB F 5100.31. The system reads the label artwork
and the application record as two separate, independent readings; compares them
field by field under stated tolerances; checks the warning statement word for
word; and applies the regulations that were in force on the filing date. It
returns findings, each with its citation and the evidence behind it.

**The determination stays with the compliance agent.** This system assembles the
evidence and records what was decided against what it recommended.

The deployment is protected by a username and password. Reading one label calls
a metered inference API, so an open URL is an unbounded bill — the credential is
a cost control, not an identity check.

---

## Try it

1. Open the deployment. **Single review** is the landing screen.
2. Under *Demo examples*, download one — start with **Fully compliant**, then
   **Alcohol content genuinely differs**.
3. Upload it. The result arrives in a few seconds: each field with what the
   label said beside what the application said, the warning checked clause by
   clause, and the regulations that were applied.
4. **Batch** runs all 26 bundled submissions and streams results as they settle.
5. **Policy** and **Agents** show what governs the system: the rules in force
   with their dates and approvers, and who or what may act.
6. **Audit** re-runs the pipeline for every verdict this deployment holds,
   from the reading recorded at the time, and checks the audit chain has not
   been altered.
7. **Measurement** reports what it cost and how long it took, against the
   5-second target the brief set.

The demo examples are the real corpus — the same documents the batch runs, each
with authored ground truth for what it should produce.

---

## Governing principle

> **The model reads. The rules compare. The human decides.**

Extraction is confined to perception. Every verdict is computed by deterministic
code from versioned reference data. A model never decides whether something
complies, never sees the expected values while reading, and never selects which
rules apply.

It answers the first question a reviewer should ask — *how do you know the model
did not simply agree with the applicant?* It cannot: it is never shown what the
applicant claimed — and `CT-10` asserts it structurally, not behaviourally.

And it is **enforced, not asserted**. Every recorded act names an agent with a
kind — `human`, `model`, `system` — and the code refuses acts a kind is not
entitled to. A model cannot record a decision; neither a model nor a deployment
can enact a rule.

---

## Beyond matching

Most of an agent's work is matching, and matching is straightforward. Defending
the answer is the harder part. A verdict on a real filing needs three
properties:

- **Explainable** — which rule was applied, which values it compared, and which
  regulation it cites.
- **Reproducible** — the same inputs give the same answer years later, if the
  decision is ever disputed.
- **Attributable** — a named person made the determination, and the record shows
  who.

The hash-chained audit, the versioned reference data, the bitemporal policy
archive and the agent-kind boundary are what provide them. The comparison itself
takes under a millisecond; the rest of the system is what makes the comparison
usable.

**On scope.** A prototype did not need this much depth, and building it took
longer than a minimal version would have (documented in
[docs/exploration-session.md](docs/exploration-session.md)). A model can read a
label; the question worth spending the time on was what it would take to rely on
one for a federal determination. Authentication, COLA integration and a runtime
rule editor are deferred, each with its reasoning recorded.

Accessibility follows the same principle. The core review screen is intentionally
plain — one clear action, large type, high contrast — so the least confident
agent on a team that is half over 50 can use it. On a federal system, that is a
**Section 508** requirement, not just a design preference.

---

## Architecture

```
   agent ──▶ Worker ──▶ Browser Rendering ──▶ two blind reads ──▶ pure rules
              │           (PDF → label crop        (label │ record)      │
              │            + record crop)                                ▼
              │                                              verdict + findings
              ▼                                                          │
   Durable Object (batch ledger) · Queue · R2 · D1 ◀────────────────────┘
                                                    hash-chained audit
```

The Worker holds **no verification logic**. Every rule lives in `src/domain/**`,
which takes no clock, no I/O, no platform API and no vendor — which is why the
rules can be tested without a network and re-run years later.

Full context, container and sequence diagrams: **[docs/architecture.md](docs/architecture.md)**

### Built with

| | | Why this one |
|---|---|---|
| Language | TypeScript 5.9, strict | `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` — the second is what keeps "not asked" and "asked, nothing there" from collapsing into one value in the record |
| Runtime | Cloudflare Workers, Node 22 for tooling | Deploys in seconds and the free tier carries a prototype; §15 states what changes for a government tenancy |
| Platform | D1 · R2 · Queues · Durable Objects · Browser Rendering | One vendor, and `deployment-path.md` §6 records what each would cost to leave |
| Inference | Two adapters behind one seam — Workers AI and Gemini | Neither vendor is in the domain. Swapping one is a constructor argument, which is how the corpus can be run under both as a controlled comparison |
| Testing | Vitest, `@cloudflare/vitest-pool-workers` | The rules are pure, so most of the suite needs no account and no network |
| Linting | Biome 2 | One tool for format and lint; `quality-check` gates every commit |
| Corpus | Python + headless Chrome, build-time only | 26 submissions with authored ground truth, including adversarial ones. Not a runtime dependency |

---

## Code layout

The layout follows one rule: the verification logic is kept apart from the
platform, so the rules can be tested offline and re-run years later.

```
src/
  domain/            the pure verification core — comparison, warning check,
                     aggregation, policy evaluation. No I/O, no clock, no vendor.
  providers/         the inference seam — two vendor adapters (Workers AI,
                     Gemini) behind one contract. The model reads here, nowhere else.
  normalise/         filed PDF → two rasterised regions (label crop, record crop),
                     via a headless browser + pdf.js, with byte-level intake guards.
  batch/             job orchestration: intake, fan-out, pipeline, persistence,
                     replay, retention.
  job-coordinator.ts the Durable Object ledger — atomic claim, progress, abort.
  policy/            the bitemporal policy archive, reconciled from the reviewed file.
  audit/             the hash-chained event stream, replay, and re-reading.
  agents/            who or what may act (human / model / system).
  review/            the single-review path; shares every rule with batch.
  metrics/           cost and latency, read from the record.
  ui/                the landing page and the gated single-page app.
  gate.ts            the shared-credential cost control.
  index.ts           the Worker entry point — routes, persists, reports. No rules.

config/              reviewed reference data: warning text, policy set, approved
                     models, user register, class/type taxonomy.
migrations/          D1 schema, with an append-only audit table.
testdata/            the 26-submission corpus, with authored ground truth.
docs/                the specification — worked before the code.
```

The dependency direction is one-way: the edges (`index.ts`, `ui/`, `batch/`)
depend on `domain/`, and `domain/` depends on nothing platform-specific. That is
what lets the whole rule set run under `npm test` with no account and no network,
and it is enforced by coverage thresholds that apply to `src/domain/**` and
nowhere else.

---

## What is built

Twenty stories across four priorities — **[docs/personas-and-stories.md](docs/personas-and-stories.md)**
has each one with its evidence.

| | Built | Partial | Not built |
|---|---|---|---|
| P1 — core review | 7 | 1 | 0 |
| P2 — batch, Janet's case | 4 | 0 | 0 |
| P3 — governance and audit | 4 | 0 | 0 |
| Other | 0 | 1 | 3 |

**The three deliberate omissions have one cause.** Sign-in, in-app rule approval,
and correcting a filing all depend on the same missing prerequisite: an
authenticated identity. Every *Must* requirement maps to a passing test; the
matrix is in `test-plan.md` §12.

---

## Cost and latency

From a corpus run on 2026-08-05, reported by the system's own Measurement
screen. Full analysis: **[docs/value-case.md](docs/value-case.md)**.

| | |
|---|---|
| Tokens per submission | **3,175** — near-constant between a clean label and a degraded one |
| Cost per submission | **$0.0073** at published rates; ≈$1,100/year for TTB's 150,000 filings |
| Verification, p50 | **2.30 s** |
| Verification, p95 | 11.30 s — and the tail is provider queueing, not work |
| Comparison alone | **sub-millisecond**. All the time is inference; none is our code |

**The slow reads are not the degraded scans.** Two record reads one token apart
took 15.2 s and 3.9 s — the same work at four times the latency. That points to a
metered free tier rather than the design, and 25 samples cannot settle a p95
either way.

**What a person waits for is kept separate from what the pipeline does.** This is
a structural choice. The checking will get longer over time, but the agent's wait
is only the time to load a prepared result, and new pipeline stages run on the
asynchronous side. A predictable three seconds is more useful here than a time
that is usually fast and occasionally fifteen.

**These numbers apply to one of the two paths.** The five-second
requirement came from a vendor pilot that took 30–40 seconds *while an agent sat
waiting*. The fix is not a faster model: batch checks a filing **as it arrives**,
so an agent opens a worklist of prepared recommendations and never waits for
inference. Single review is for the case in front of them right now, and there
the target applies literally. This assumes filings are recorded on arrival — see
the assumptions below.

---

## Assumptions

Six that would change the product if wrong. All ten, with impact:
`docs/design.md` §4.2.

| | If it is wrong |
|---|---|
| The application record is available as structured data | **Three of four fields cannot be compared.** The paper form has no box for class/type, alcohol content or net contents — discovered by building (`Q-INT-08`), and the first question to ask TTB |
| Product type arrives as data, not inferred | The wrong body of regulation is applied, and every finding still looks ordinary |
| One submission carries every field under review | Fields spread across documents are invisible; the most consequential assumption in the design (A2) |
| The agent is trusted at the network perimeter | No record here is evidence of *who* — attribution is declared, not verified |
| A vision model is reachable from the deployment | The system cannot function. Marcus's firewall blocked the last vendor's endpoints |
| **Filings are recorded on arrival, so they can be checked before an agent opens one** | The five-second target collapses back onto inference latency — the agent waits for the model, which is exactly how the previous vendor pilot was abandoned |

---

## Limitations

**No accuracy percentage is claimed.** The corpus is synthetic and was authored
alongside the system, so a percentage from it measures agreement with my own
expectations. It is also crisper than reality — vector text at known DPI, not
photographs.

**Attribution is declared, not verified.** `decided_by` is a name typed into a
box.

**Two checks, and they answer different questions.** *Replay* re-runs the
pipeline from the recorded reading — same contract, same rules, same
aggregation — so it proves the judgement is reproducible and reproduces a
misreading faithfully rather than catching it. *Re-reading* puts the artwork
back to the same model and compares, which is the only way to see whether
perception is stable. Both are in the product; neither proves the reading was
*correct*, which needs a labelled sample the corpus cannot supply. The claim is not that generative AI is deterministic; it is that
**perception is non-deterministic, judgement is deterministic, and the boundary
between them is written down** — see
[determinism-and-replay.md](docs/determinism-and-replay.md).

**How much of the reasoning is recoverable.** What the system decided is fully
recoverable; what it decided *by* is only partly so. The
rules are now readable on screen, but a finding pins its regulation by digest
rather than quoting it, and the nine original rules carry no source quote (the six
enacted on 5 August do). Producing the passage a rule rests on, with the
provisions that qualify it, is a retrieval problem: the kind of task a model is
good at, and the one this system does not use a model for. It would assist
*review of the rules* rather than decide compliance, so it stays on the right
side of the principle. It is not built.

---

## Path to production

Moving to production means replacing components at defined seams rather than
rewriting the system. What would change:

**Inference behind the firewall.** TTB's network blocks outbound connections to
ML endpoints, which is what broke much of the last vendor pilot. This prototype
uses a hosted model because it runs standalone, off that network. Production would
move inference on-premise, or to a FedRAMP-authorised endpoint, behind the same
`ExtractionProvider` seam, with the rest of the system unchanged. Self-hosting
was considered, and its trade-offs are recorded (D10).

**The application record.** The system assumes application data arrives as
structured data, but the paper form carries only one of the four compared fields
(found while building against it). Production would read the COLA record instead.
This is the first integration question to raise with TTB.

**Authenticated identity.** The shared credential is a cost control, not a login.
Sign-in, in-app rule approval, and filing correction all depend on the same
missing piece: a verified identity. It is the first thing production would add,
and attribution would then move from declared to verified.

**Retention policy.** The system already treats retention as a policy obligation
rather than a storage setting: content is purged on a stated schedule, and the
durable record is kept. Production would set the retention window to TTB's own
policy. The mechanism is already built.

**Measured accuracy.** No accuracy figure is claimed here, because the corpus is
synthetic. Production's first task would be to test against a labelled sample of
real labels. The deterministic rule engine can serve as the test oracle for that,
since every finding it produces is a labelled example drawn from real traffic.

**Reusing the interface.** The review-and-decide experience — upload, the two
readings shown side by side, the warning checked clause by clause, and the
determination recorded against the recommendation — is production-intended and
would be reused largely as-is. The evaluation scaffolding would be replaced: the
guided landing page, the demo corpus, and the single flat navigation that lets a
reviewer see every screen without signing in. In production, the reference screens
(Audit, Policy, Agents, Measurement) would be separated by role behind
authentication, since each already serves a different user (auditor, policy owner,
operator) that the prototype currently combines into one view.

Full sequencing is in
[docs/integration-and-delivery.md](docs/integration-and-delivery.md), and the
production target architecture in [design.md §15](docs/design.md).

---

## Running it

Node 22+, and a Cloudflare account with Workers, D1, R2, Queues, Durable Objects
and Browser Rendering.

```bash
npm ci
npm run quality-check     # lint, typecheck, ~940 tests with coverage
npm run dev               # local worker
```

**The rules run without any of that.** Comparison, warning verification and
aggregation are pure, so `npm test` evaluates the part that decides verdicts
with no account and no deployment.

### Deploying

```bash
npm run migrate:staging && npm run deploy:staging
```

Migrations run **before** the deploy, never after. Pushing to `main` does both
and then verifies the version it just deployed, reconciles the policy archive
from the reviewed file, and re-derives every stored verdict.

| Secret | Needed when |
|---|---|
| `MODEL_API_KEY` | `MODEL_PROVIDER=gemini`; Workers AI uses its binding |
| `POC_USER_ONE` / `_PASSWORD` | gating the deployment (two pairs supported) |
| `AI_GATEWAY_ACCOUNT` / `_TOKEN` | routing inference through AI Gateway |

Useful endpoints: `/health` · `/health/inference` · `/health/raster` ·
`/audit/verify` · `/audit/replay` · `/measurement` · `/reference/<code>` ·
`/events` — the chained event stream, filterable and paged, with the digests so
a consumer can verify it rather than trust it (`format=ndjson` for a log
pipeline)

---

## Documents

Worked before the code, and the specification rather than background.

**Start here**

| | |
|---|---|
| [architecture.md](docs/architecture.md) | how it is built — context, containers, both request paths |
| [personas-and-stories.md](docs/personas-and-stories.md) | who it is for, and what is built vs not |
| [determinism-and-replay.md](docs/determinism-and-replay.md) | what is deterministic here and what is not — and the demonstration |
| [record-schema.md](docs/record-schema.md) | the D1 record, column by column, and why each one exists |
| [toward-llm-policy.md](docs/toward-llm-policy.md) | what it would take to let a model judge, and what should stop us |
| [value-case.md](docs/value-case.md) | what it costs, what it saves, what it refuses to claim |
| [integration-and-delivery.md](docs/integration-and-delivery.md) | what a real integration needs, and in what order |
| [engineering-practices.md](docs/engineering-practices.md) | TDD, CI/CD, security, observability — with the artefact for each claim |

**The specification**

| | |
|---|---|
| [design.md](docs/design.md) | requirements, verification logic, provenance, 51 logged decisions |
| [test-plan.md](docs/test-plan.md) | §3 is the executable spec: ~130 cases with inputs and expected outcomes |
| [ui-design.md](docs/ui-design.md) | screens, states, every string |
| [batch-backend-design.md](docs/batch-backend-design.md) | job orchestration and platform mapping |
| [project-reference.md](docs/project-reference.md) | stakeholders, verified TTB context, open questions |
| [deployment-runbook.md](docs/deployment-runbook.md) | every resource, step, verification, rollback |
| [deployment-path.md](docs/deployment-path.md) | Workers → container → sovereign, and what breaks where |
| [exploration-session.md](docs/exploration-session.md) | how the problem was worked — read if picking this up cold |
| [implementation-plan.md](docs/implementation-plan.md) | per-milestone exit criteria |

The statutory warning text in `config/warning-statement.json` was confirmed byte
for byte against the eCFR versioner API — 283 characters, compared
programmatically with no model interpreting it. The corpus cannot catch an error
there, because the corpus is generated from that same file.
