# From Prototype to Production

*How a Cloudflare Workers prototype becomes an on-premise containerised system
without a rewrite. Supersedes D12 and D13; see D31. Companion to `design.md` §15,
which describes the target, and `batch-backend-design.md` §14, which defines the
interfaces this document depends on.*

| Field | Value |
|---|---|
| Status | Draft |
| Prototype platform | Cloudflare Workers |
| Production target | Container, on premise (§15) |

---

## 1. Position

D12 said *"ship as a single container"* and D13 chose Google Cloud Run. Both are
superseded: **the prototype deploys to Cloudflare Workers, and the container is
the production step.**

The reasoning that produced D12 still holds — production is containerised,
on premise, running a self-hosted model, for the reasons in §15.1. What changed
is the sequencing. A container adds nothing a prototype needs and costs setup a
one-day budget cannot spare; Workers reaches a public URL in one command.

**The order is not merely convenient, it is the disciplined one.** Workers'
constraints are strictly tighter than a container's: no filesystem, no threads,
no native modules, 128 MB, a 6-connection cap per invocation. Code that satisfies
those runs unmodified in a container. The reverse is not true — container-first
code reaches for temp files, worker threads and native bindings, and then cannot
go back. **Building against the tighter constraint first makes the outward port
nearly free, and it is the only direction that works.**

---

## 2. The Stages

| # | Stage | Platform | Model | Persistence | Proves |
|---|---|---|---|---|---|
| **1** | **Prototype** | Workers | Hosted API | None (N3) | The pipeline works; the design is sound |
| 2 | Portability | Container, any cloud | Hosted API | Job state only | The abstraction holds; nothing was platform-locked |
| 3 | Sovereign | Container, on premise | **Self-hosted** | Audit records retained | C5, weight provenance (§8.7.3), agency boundary |
| 4 | Production | As stage 3, accredited | Self-hosted, governed | Full retention schedule | SSO, ATO, policy approval workflow, monitoring |

**Stage 2 is the one that must not be skipped.** It is the only stage whose
purpose is to *prove the abstraction*, and it is cheap precisely because nothing
else changes at the same time — same model, same behaviour, same outputs. Run the
corpus through both and diff the results: identical verdicts mean the port is
correct. Change the platform and the model together and any divergence is
unattributable.

---

## 3. What Ports Unchanged

**The majority of the code, and all of the part that must be right.**

| Component | Why it ports |
|---|---|
| Comparison rules, warning verifier, aggregation | Pure functions. No I/O, no clock, no platform API (test-plan §17) |
| Normalisation of text, numeric and quantity parsing | Same |
| Reference data and policy configuration | Files read through an interface |
| Extraction contract and schema validation | Plain schema definitions |
| Audit record assembly | Constructs a value from values |
| The interface layer | Standard `Request`/`Response`, supported natively by Workers and by Node 18+ |
| The entire client | Static assets served by anything |

This is the payoff of §6.1. Because the model is confined to perception and every
judgment is deterministic local code, **the part of the system with compliance
consequences has no platform surface at all.** It is ordinary TypeScript that
runs in a Worker, in Node, in a container, or in a browser, and produces the same
verdict in each.

---

## 4. What Must Be Re-implemented

Five adapters, defined in `batch-backend-design.md` §14.

| Interface | Workers | Container |
|---|---|---|
| `ContentStore` | R2 | S3-compatible, or a mounted volume |
| `WorkQueue` | Queues | Redis, RabbitMQ, or a database-backed queue |
| `JobCoordinator` | Durable Object | Postgres row with advisory locking |
| `ResultStream` | WebSocket via DO, hibernating | SSE from the process |
| `Normaliser` | Container binding / Browser Rendering | **A PDF library, directly** |

**Four of the five get simpler in a container.** Only the coordinator gets
harder, and §5 explains why.

Notably `Normaliser` becomes trivial. Rasterisation is awkward on Workers — it is
the reason the design reaches for Containers or Browser Rendering at all — and in
a container it is a library call. The hardest thing about the prototype platform
is the easiest thing about the production one.

---

## 5. The Three Real Hazards

*Everything above is mechanical. These are the ways a port goes wrong.*

### 5.1 Durable Objects serialise for free; containers do not

A Durable Object is single-threaded per object. Read-modify-write on the item
ledger is safe with no locking, and *"have all 300 items finished?"* has no race.
None of that survives a move to multiple container replicas.

**The hazard is that the bug does not exist in development.** It appears under
concurrency, in production, intermittently.

**Mitigation, applied now:** `JobCoordinator` exposes only operations that are
atomic *by contract* — `claimNextItem()`, `recordResult(itemId, result)`,
`completionCount()` — never `getLedger()` followed by `putLedger()`. A DO
satisfies that contract trivially; Postgres satisfies it with a transaction. Code
written against the contract cannot depend on the free serialisation.

**This is the single most valuable thing to get right in the prototype**, because
it is the one hazard that a passing test suite will not reveal.

### 5.2 Concurrency shape inverts

Workers fan out by running **many invocations**, each holding few connections
(the 6-connection cap, B-D4). A container fans out by running **one process**
holding many connections.

Both satisfy the same requirement — bounded extraction concurrency governed by
the provider's rate limit — but the mechanism is opposite. Keep the limit as
configuration (`EXTRACT_CONCURRENCY`) consumed by the queue adapter, not as an
assumption baked into the item worker. The worker handles one submission and
knows nothing about how many peers exist.

### 5.3 The model boundary moves at stage 3, not stage 2

Self-hosting is a stage 3 change, deliberately separated from containerisation.
It brings its own work — model lifecycle, a regression corpus, GPU capacity, and
a latency budget that may no longer hold (§15.3). Bundling it with the platform
port would make every divergence ambiguous.

**One prototype decision protects this:** the provider adapter (§8.3) is the seam
a self-hosted model substitutes at. It exists in stage 1 with a single
implementation, which is what makes stage 3 an adapter rather than a redesign.

---

## 6. Rules for the Prototype

*Cheap now, expensive to retrofit. Each maps to a hazard above.*

| # | Rule | Protects |
|---|---|---|
| R1 | No platform global outside an adapter. Domain code never sees `env` | §4 |
| R2 | HTTP handlers take a standard `Request` and return a standard `Response` | §3 |
| R3 | `JobCoordinator` exposes atomic operations only — never read-then-write | **§5.1** |
| R4 | Verification logic stays pure: no clock, no randomness, no I/O | §3, test-plan §17 |
| R5 | Clock and identifier generation are injected | Determinism in tests |
| R6 | Concurrency limits are configuration, never structural assumptions | §5.2 |
| R7 | Reference data and policy are read through an interface, not imported from a path | Portability of configuration |
| R8 | One submission per worker invocation | §5.2, B-D4 |
| R9 | No filesystem writes anywhere | Workers forbids it; keeps the container honest |

**R3 is the one to enforce hardest.** The others announce themselves at compile
time or in the test suite. R3 fails silently, in production, under load, on the
platform where the guarantee was never there.

---

## 7. Verifying the Port

Stage 2 has an objective pass condition, and the corpus provides it.

```
  same 26 submissions
  same model version, same prompt version, same ruleset version
        │
        ├── Workers      ──▶ results-workers.json
        └── Container    ──▶ results-container.json
        │
        ▼
   verdicts must be IDENTICAL
```

**Verdicts must match exactly**, because comparison is deterministic (D1) — the
same extraction yields the same verdict on any platform. Extraction output may
differ slightly, since hosted inference is not deterministic (D11); that is why
the comparison is run over **recorded extractions** (test-plan §5) rather than
live calls. Replay the same fixtures through both platforms and any divergence is
a porting defect, not model variance.

That test is worth writing during stage 1, when it costs nothing and passes
trivially.

---

## 8. What We Deliberately Do Not Build Now

| Deferred | Until | Why not now |
|---|---|---|
| Container image and orchestration | Stage 2 | Adds no capability the prototype needs |
| Durable persistence, retention policy | Stage 3 | Requires a records-management decision (Q-PRV-02) |
| Identity and SSO | Stage 4 | N2, D14 — a gated URL fails closed for an evaluator |
| Self-hosted inference | Stage 3 | Does not fit the prototype budget; likely breaches S1 on commodity hardware |
| Policy approval workflow | Stage 4 | Needs a policy owner and a governance process (D27) |
| Multi-region, HA | Stage 4 | Not a prototype concern |

**None of these is a gap.** Each is a stage with an entry condition, and the seam
each substitutes at exists from stage 1.

---

## 9. Effort, Honestly

| Stage | Rough effort | Dominated by |
|---|---|---|
| 1 → 2 | Days | Writing five adapters and standing up a container image |
| 2 → 3 | **Months** | Model hosting, GPU capacity, latency re-validation, retention policy |
| 3 → 4 | **Months to a year** | ATO, SSO integration, accessibility conformance, governance |

**The jump from 1 to 2 is small and the jumps after it are not**, and it is worth
saying so rather than implying a smooth ramp. Marcus's account of the FedRAMP
process — eighteen months of paperwork — is the honest scale for stage 4.

What the prototype's architecture buys is that **stage 2 is days rather than a
rewrite**, and that stages 3 and 4 are dominated by process and procurement
rather than by engineering rework. That is the whole return on §6.1 and on the
interfaces in §14.
