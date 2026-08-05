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

## Try it in three minutes

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

## The governing principle

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
can enact a rule. It found a real hole on its first run.

---

## Why a matcher carries this much machinery

Most of what an agent does is matching, and matching is the easy part. The hard
part of a compliance *determination* is not comparing two strings — it is being
able to defend the answer. A verdict that lands on a real filing has to be
**explainable** (which rule, which values, which citation), **reproducible** (the
same inputs give the same answer years later, in a dispute), and **attributable**
(a named person decided, and the record says so). Remove those and this is a
demo; keep them and it is evidence a compliance division could stand behind.

So the hash-chained audit, the versioned reference data, the bitemporal policy
archive and the agent-kind boundary are not gold-plating — they are the
difference between matching labels and producing evidence for a legal
determination. The matching itself is sub-millisecond; the machinery is what
makes the matching *usable*.

**The scope was drawn deliberately.** A prototype did not strictly need this
depth, and building it cost the schedule — recorded plainly in
[docs/exploration-session.md](docs/exploration-session.md). It was chosen because
the interesting question is not *can a model read a label* (it can) but *what
would it take to trust one on a federal determination* — which is answered by the
parts usually skipped. What was left out is named, not overlooked: authentication,
COLA integration and a runtime rule editor are absent by decision, each with its
reasoning beside it.

The same discipline reaches the interface. The core review screen is deliberately
plain — one obvious action, large type, high contrast — for the least confident
agent on a team half over 50; on a federal system that is a **Section 508**
obligation before it is a design preference.

---

## Architecture at a glance

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

---

## What is built, and what is not

Twenty stories across four priorities — **[docs/personas-and-stories.md](docs/personas-and-stories.md)**
has each one with its evidence.

| | Built | Partial | Not built |
|---|---|---|---|
| P1 — core review | 7 | 1 | 0 |
| P2 — batch, Janet's case | 4 | 0 | 0 |
| P3 — governance and audit | 4 | 0 | 0 |
| Other | 0 | 1 | 3 |

**The three deliberate omissions share one shape.** Sign-in, in-app rule
approval, and correcting a filing are the same missing prerequisite — an
authenticated identity — wearing three hats. Every *Must* requirement maps to a
passing test; the matrix is `test-plan.md` §12.

---

## Measured, not estimated

From a corpus run on 2026-08-05, reported by the system's own Measurement
screen. Full analysis: **[docs/value-case.md](docs/value-case.md)**.

| | |
|---|---|
| Tokens per submission | **3,175** — near-constant between a clean label and a degraded one |
| Cost per submission | **$0.0073** at published rates; ≈$1,100/year for TTB's 150,000 filings |
| Verification, p50 | **2.30 s** |
| Verification, p95 | 11.30 s — and the tail is provider queueing, not work |
| Comparison alone | **sub-millisecond**. All the time is inference; none is our code |

**The tail is not what it looks like.** The slowest reads are not the degraded
scans: two record reads one token apart took 15.2 s and 3.9 s. Same work, four
times the latency. That points at a metered free tier, not at the design — and
25 samples cannot settle a p95 either way, which the value case says rather than
declaring the target failed.

**What a person waits for is decoupled from what the pipeline does** — a
structural rule, not an optimisation. The checking will get longer; the agent's
wait is the time to load a prepared result, and new pipeline stages go on the
asynchronous side. Stability matters more than speed here: a predictable three
seconds is a better tool than one usually fast and occasionally fifteen.

**And these numbers gate an agent on only one of the two paths.** The
five-second requirement came from a vendor pilot that took 30–40 seconds *while
an agent sat waiting*. The answer is not a faster model; it is that batch checks
a filing **as it arrives**, so an agent opens a worklist of prepared
recommendations and never waits for inference at all. Single review is for the
case in front of them right now, and there the target applies literally. This
assumes filings are recorded on arrival — see the assumptions below.

---

## Assumptions that matter

Five that would change the product if wrong. All nine, with impact:
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

## Limitations, stated

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

**The recall gap is the honest headline.** What the system decided is fully
recoverable; what it decided *by* is only partly so. The rules are now readable
on screen, but a finding pins its regulation by digest rather than quoting it,
and the nine original rules carry no source quote — the six enacted on
5 August do. Producing the passage a rule
rests on — with the provisions that qualify it — is a retrieval problem, which is
exactly what a model is good at and exactly what this system has refused to use
one for. It assists *review of the rules* rather than deciding compliance, so it
sits on the right side of the principle. That is the direction this prototype
points at and deliberately did not take.

---

## The path to production

A prototype earns its keep by making the next decision cheaper. This one is built
so the move to production is a set of substitutions at named seams, not a rewrite
— and so the parts that are hard to get right are the parts already worked out.

**Inference behind the firewall.** TTB's network blocks outbound ML endpoints —
the constraint that half-broke the last vendor pilot. This prototype reaches a
hosted model because it is standalone and off that network; production moves
inference on-premise, or to a FedRAMP-authorised endpoint, behind the same
`ExtractionProvider` seam with everything above it unchanged. Self-hosting was
weighed and its trade-offs recorded (D10).

**A record of authority.** The application data is assumed to arrive as
structured data — yet the paper form carries only one of the four compared fields,
found by building against it. Production reads the COLA record, which is the first
integration question to put to TTB.

**A verified identity.** The shared credential is a cost control, not a login,
and is described as exactly that. Sign-in, in-app rule approval and correcting a
filing are one missing prerequisite — a verified identity — wearing three hats,
and are the first thing production adds; attribution then moves from *declared* to
*verified*.

**Retention as policy.** The system already treats retention as an obligation
rather than a bucket setting — content purged on a stated schedule, the durable
record kept. Production sets the window to TTB's own policy; the machinery is in
place.

**Measured accuracy.** No accuracy figure is claimed, because the corpus is
synthetic. Production's first task is a labelled sample of real labels — and the
deterministic rule engine is the test oracle for it, since every finding is a
labelled example produced on real traffic at no extra cost.

**The interface carries forward; the way in changes.** The review-and-decide
experience — upload, the two readings side by side, the warning checked clause by
clause, the determination recorded against the recommendation — is
production-intended and reused nearly as-is. What is evaluation scaffolding, and
is replaced: the guided landing page, the demo corpus, and the single flat
navigation that lets a reviewer see every surface without signing in. In
production the reference surfaces — Audit, Policy, Agents, Measurement — separate
by role behind authentication, because each already serves a different user
(auditor, policy owner, operator) that the prototype deliberately collapses into
one tour.

Full sequencing: [docs/integration-and-delivery.md](docs/integration-and-delivery.md),
with the production target architecture in [design.md §15](docs/design.md).

---

## Running it

Node 22+, and a Cloudflare account with Workers, D1, R2, Queues, Durable Objects
and Browser Rendering.

```bash
npm ci
npm run quality-check     # lint, typecheck, 819 tests with coverage
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

## The documents

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
| [design.md](docs/design.md) | requirements, verification logic, provenance, 52 logged decisions |
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
