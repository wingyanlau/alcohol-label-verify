# Batch Processing — Backend Design

*Extends `design.md` §8 to batch submission of complete PDF applications. Results
render in the interface specified in `ui-design.md` §9. Section references are to
`design.md` unless stated.*

| Field | Value |
|---|---|
| Status | Draft |
| Last updated | 2026-08-01 |
| Initial platform | Cloudflare Workers |
| Portability | Required — §14 |

---

## 1. What Changed

The corpus in `testdata/` established the real unit of work, and it is not what
§8 assumed.

| §8 assumed | Actually |
|---|---|
| A label **image** | A **PDF submission**: TTB F 5100.31 page 1 with the label set affixed, plus the application record |
| Application data typed by an agent | Present **inside the same artefact** |
| Batch = images + a CSV, paired by filename | Batch = a set of self-contained PDFs |

Two consequences follow, and the first is the most important decision in this
document.

### 1.1 A whole submission page must never be sent to the extractor

The submission page carries **both** the application values and the label. Sending
it to the extraction model puts the expected values in front of the model, which
is precisely what D4 forbids: a model shown the expected value tends to confirm
it, and every such error is a false *match* (§8.3.1).

**The artefact physically colocates what the architecture requires be separated.**
So the page must be divided before extraction:

```
  submission.pdf
        │
        ├── page 1, affix region ────▶ LABEL extraction      (blind)
        ├── page 1, form region  ─┐
        └── page 2, record       ─┴──▶ APPLICATION extraction (blind)
                                              │
                                              ▼
                                   deterministic comparison
```

Two extractions, **separate calls**, neither aware of the other's output. This is
§8.8.2's parallelism, now with a concrete forcing reason rather than a latency
one. Merging them into a single call to "save a round trip" would silently defeat
D4 — an optimisation that looks free and is not.

### 1.2 Batch pairing dissolves

Q4 asked how images pair with application rows. With self-contained submissions
there is nothing to pair: **one file is one unit of work.** Assumption A8
(filename matching) is withdrawn, and a whole class of intake error — unpaired
items, mismatched counts, wrong row — disappears.

---

## 2. Requirements

| ID | Requirement | Source |
|---|---|---|
| B1 | Accept 200–300 submissions in one job | NFR-9, Sarah/Janet (SRC-2) |
| B2 | First result available within 5s of submission | S2, NFR-2 |
| B3 | Results emitted progressively, never only at completion | FR-13 |
| B4 | One failing item never aborts the job | NFR-6 |
| B5 | Every item produces a stated outcome, including failure | §9.2 |
| B6 | Per-item audit record, as for single review | FR-17, FR-18 |
| B7 | Job survives client disconnection | Inferred — a 300-item job outlives a tab |
| B8 | Bounded concurrency and spend | R5, R8 |
| B9 | No retention of submission content | N3, NFR-7 |
| B10 | Deterministic comparison, identical to single review | D1, D8 |

**B10 is a constraint on the architecture, not a feature.** Batch is scheduling
over the single-item pipeline (D8). A batch-specific comparison path would drift
from the single-review path in ways only 300-item runs reveal.

---

## 3. Logical Architecture

Platform-neutral. §15 maps it to Cloudflare and to two alternatives.

```
 CLIENT
   │  submission PDFs
   ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ INTAKE            create job · validate · stage content     │
 └───────────┬─────────────────────────────────────────────────┘
             │ staged refs                    ┌──────────────┐
             ▼                                │ OBJECT STORE │ transient
 ┌─────────────────────────┐                  │  TTL-bounded │
 │ JOB COORDINATOR         │◀────────────────▶└──────────────┘
 │  item ledger            │
 │  progress               │      ┌──────────────────────────┐
 │  client fan-out         │─────▶│ SUBSCRIBERS  (SSE / WS)  │──▶ UI
 └───────────┬─────────────┘      └──────────────────────────┘
             │ one message per item
             ▼
 ┌─────────────────────────┐
 │ WORK QUEUE              │  retry · dead-letter · backpressure
 └───────────┬─────────────┘
             │
             ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ ITEM WORKER                                                 │
 │                                                             │
 │   NORMALISE ──▶ ┌─ label region ──┐                         │
 │   (§4)          │                 ├─▶ EXTRACT (parallel)    │
 │                 └─ record page ───┘        │                │
 │                                            ▼                │
 │                              COMPARE ──▶ AGGREGATE ──▶ AUDIT│
 │                              (deterministic, shared with     │
 │                               single review — D8)            │
 └───────────┬─────────────────────────────────────────────────┘
             │ result + audit record
             ▼
        JOB COORDINATOR ──▶ subscribers
```

| Component | Responsibility | Must not |
|---|---|---|
| Intake | Create the job, validate each file, stage content, enqueue | Process anything |
| Object store | Hold submission bytes for the life of the job | Outlive the job |
| Job coordinator | Own the item ledger, count progress, fan results out | Contain verification logic |
| Work queue | Distribute, retry, dead-letter, apply backpressure | Know what an item means |
| Item worker | The single-review pipeline, unchanged | Have a batch-specific path (B10) |
| Normaliser | PDF → page raster → cropped regions | Interpret content |

---

## 4. Document Normalisation

The layer §8 did not need, and the one with the most platform variance.

### 4.1 What it does

| Step | Detail |
|---|---|
| Parse | Page count, dimensions, encryption, validity |
| Rasterise | Page → bitmap at a resolution that preserves the smallest required text |
| Region crop | Extract the affix region and the record region separately (§1.1) |
| Condition | Downscale to the smallest size that keeps text legible (§9.1) |

### 4.2 Resolution is set by the warning statement

The government warning is the smallest text under verification — §16.22 permits
1 mm characters on containers up to 237 mL. On a Legal page reproduced at 1:1
that is roughly 3 pt.

| Rendering | Affix region | Legibility of ~4–5 pt text |
|---|---|---|
| 150 DPI | ~1177 × 620 | Marginal |
| **300 DPI** | **~2354 × 1241** | **Adequate — the working default** |
| 600 DPI | ~4708 × 2482 | Better, and 4× the input cost |

**Cropping to the affix region pays twice**: it enforces blind extraction (§1.1)
*and* removes roughly two-thirds of the pixels, so 300 DPI on the crop costs less
than 150 DPI on the page. The privacy-motivated split and the cost optimisation
are the same action.

**Resolution is configuration, not a constant.** It is recorded in the audit
record alongside the conditioning transform (§8.7.1), because a verdict of
`UNREADABLE` may be an artefact of the rasterisation rather than of the artwork —
and an auditor must be able to tell which.

### 4.3 Region maps are per form version

The affix region is at `[24.6, 28.9, 589.4, 326.8]` **on TTB F 5100.31 (04/2023)**.
That is a property of one revision of one form.

```
  form version  ──▶  { labelRegion, recordSource, pageCount }
```

This is policy configuration (§8.6.1), version-recorded like any other rule. A
form revision is a config change, not a code change.

**Failure mode to design for:** an unrecognised form version. The system must
report *"this does not appear to be a form I know"* rather than cropping a fixed
rectangle out of an unknown document and extracting whatever lands inside. Silent
mis-cropping produces confident nonsense — the worst failure class in this system.

### 4.4 Where normalisation runs

| Option | Cost | Trade-off |
|---|---|---|
| **Client** — PDF.js in the browser | Zero server CPU | Heavy for 300 files; output is untrusted and must be re-validated |
| **Server, container** — a real PDF library | Predictable, fast | Requires a runtime that permits native code |
| **Server, headless browser** | No container needed | Session overhead and rate limits per page |

**Chosen: server-side, behind an interface**, with the client path available for
single review where one file is already being conditioned (§9.1).

*Why not client-side for batch.* Rasterising 300 PDFs at 300 DPI in a browser tab
is minutes of main-thread work on the machines this audience actually uses — half
the team is over 50 on government hardware, and the requirement is that the tool
be *faster* than eyeballing. It also makes the client's output an input to a
compliance decision, which would need re-validation server-side anyway.

---

## 5. Job Model

### 5.1 States

```
  job:   CREATED ──▶ INGESTING ──▶ PROCESSING ──▶ COMPLETE
                          │              │
                          └──────────────┴──▶ CANCELLED
```

```
  item:  QUEUED ──▶ RUNNING ──▶ ┌─ COMPLETED   (a verdict, including INCOMPLETE)
                                ├─ FAILED      (could not process — cause recorded)
                                └─ REJECTED    (intake refused it — never queued)
```

**`COMPLETED` includes `INCOMPLETE`.** A label that could not be read is a
*verdict* (D5), not a processing failure. Conflating the two would let an
unreadable label be reported as a system error and quietly re-tried, which is how
a non-compliant submission slips through.

### 5.2 The ledger

The coordinator holds one row per item: identifier, source filename, state,
attempt count, and — once resolved — the result and audit record.

**It never holds submission content.** Content lives in the object store under a
key the ledger references, and is deleted when the job completes (§10).

### 5.3 Processing starts before ingestion finishes

B2 requires a result within 5 seconds. A 300-file upload does not complete in 5
seconds, so **items are enqueued as they arrive**, not when the last one lands.

```
  file 1 uploaded ──▶ enqueued ──▶ processing        t ≈ 1s
  file 2 uploaded ──▶ enqueued ──▶ processing        t ≈ 1.4s
  ...                                                first result ≈ 4.5s
  file 300 uploaded                                  t ≈ 90s
```

A design that waited for the complete upload could not meet B2 at any batch size,
and would reproduce the failure that ended the previous vendor pilot.

---

## 6. Concurrency and Rate Limiting

### 6.1 The binding constraint is the model provider

| Limit | Typical ceiling |
|---|---|
| Platform worker invocations | Hundreds concurrent |
| Coordinator throughput | Thousands of writes/sec |
| **Model provider rate limit** | **Tens of requests/sec — the real ceiling** |

Concurrency is therefore governed at the extraction boundary, not by how many
workers the platform will start.

### 6.2 Fan-out comes from many invocations, not parallel calls inside one

Serverless runtimes commonly cap *simultaneous outbound connections per
invocation* — on Cloudflare it is **6** (§15.1). Two of those are already spent
on the parallel extractions in §1.1.

**Consequence:** an item worker handles **one** submission. Batch concurrency
comes from the queue running many workers, not from one worker looping over
items. A design that batched 50 items into one invocation would serialise on the
connection limit and defeat B2.

### 6.3 Admission control

| Control | Purpose |
|---|---|
| Queue concurrency ceiling | Caps simultaneous extractions |
| Token bucket per provider | Smooths bursts against the provider's window |
| Batch size cap | Bounds worst-case spend per job (R8) |
| Account spend cap at the provider | The backstop that actually limits loss |

**Cost is shown before the job starts.** *"300 submissions, about £X"* — a
confirmation step, because the honest failure mode of an unauthenticated batch
endpoint is a bill, not a breach.

### 6.4 Wall-clock estimate

At 300 items, ~3.5 s per extraction pair, concurrency *C*:

| C | Wall clock |
|---|---|
| 10 | ~105 s |
| 25 | ~42 s |
| 50 | ~21 s |

All satisfy B2, which concerns the *first* result. The choice of *C* is governed
by the provider's rate limit and by cost pacing, not by total duration.

---

## 7. Progress and Result Streaming

### 7.1 Event stream

| Event | Carries |
|---|---|
| `job.accepted` | Job id, expected item count |
| `item.queued` | Item id, filename |
| `item.started` | Item id |
| `item.completed` | Verdict summary, per-field states, audit reference |
| `item.failed` | Cause class, whether re-submittable |
| `job.progress` | Counts by outcome |
| `job.completed` | Final tallies |

`item.completed` carries a **summary**, not the full record. The interface's
worklist (`ui-design.md` §9) needs filename, outcome and a one-line reason; the
full result and audit record are fetched when a row is opened. At 300 items that
is the difference between a stream a browser can keep up with and one it cannot.

### 7.2 Reconnection

Subscribers may attach at any time and receive a **snapshot then a delta**: the
current ledger state, followed by subsequent events. This satisfies B7 and makes
the connection disposable — a closed laptop lid does not lose a job.

### 7.3 Ordering

Events are emitted in completion order. **The interface sorts, not the server**
(`ui-design.md` §9: problems first). Sorting server-side would require buffering
until enough results exist to rank, which contradicts B3.

---

## 8. Failure Isolation and Retry

| Failure | Handling | Retry |
|---|---|---|
| Unreadable/invalid file | `REJECTED` at intake, before queueing | No — deterministic |
| Unknown form version (§4.3) | `REJECTED` with a specific message | No |
| Normalisation failure | `FAILED`, cause recorded | Once |
| Provider timeout | `FAILED` after bounded retry | Yes — 3, exponential backoff |
| Provider rate limit | Re-queued with delay | Yes — does not count against the attempt budget |
| Schema-invalid extraction | `FAILED` — a dependency failure (§8.3) | Once |
| Label unreadable | **`COMPLETED` / `INCOMPLETE`** | **Never** — it is a verdict |
| Worker crash | Message redelivered | Bounded, then dead-letter |

**Retry is permitted here and forbidden on the interactive path** (§9.2). On a
single review a silent retry doubles worst-case latency against a 5 s budget. In
batch the agent is not waiting on any individual item, so a bounded retry is
invisible and worth having.

**Retries are recorded in the audit record.** An item that succeeded on attempt
three is a different fact from one that succeeded immediately, and a rising retry
rate is the earliest signal of provider degradation.

**Dead-letter, not discard.** Items exceeding the attempt budget move to a
dead-letter path and surface as `FAILED` with a cause. B5 admits no silent loss.

---

## 9. Idempotency

Item identity is the digest of the submission content **plus** the versioned
identity set (§9.4.6): model, prompt, ruleset, policy, reference data.

| Property | Consequence |
|---|---|
| Redelivery is safe | The same message twice produces one result |
| Re-running a job is cheap | Unchanged items need no re-extraction |
| A version change invalidates correctly | New model version → new key → genuine re-run |

**Result caching across jobs is deliberately not enabled in the prototype.** A
cache keyed by content digest is a retention mechanism, however short-lived, and
N3 says store nothing. It is a legitimate production option once a retention
policy exists (§15.3 of the design document) — recorded here so the choice is
visible rather than assumed.

---

## 10. State, Retention, and N3

Batch cannot be stateless: a 300-item job outlives any single request. The
reconciliation is the same as the audit record's (§8.7.4) — **separate what must
exist from what must be kept.**

| Data | Held | Lifetime | Rationale |
|---|---|---|---|
| Submission bytes | Object store | Job duration, then deleted; TTL as a backstop | Workers must fetch it; nothing needs it afterwards |
| Rasterised regions | In memory only | The item's processing | Never written down |
| Item ledger | Coordinator | Job duration + a short collection window | The client must be able to reconnect (B7) |
| Results and audit records | Coordinator | Same | Delivered, then dropped |
| Extracted values | Inside the result | Same | Evidence for the agent (FR-10) |
| Logs | Log store | Short | Identifiers and timings only, never content (D20) |

**Deletion is a job step, not a sweeper.** Completion deletes staged content
explicitly; the TTL exists for jobs that never complete. Relying on TTL alone
means an abandoned job retains submissions for its full window.

**This is a widening of N3 and it should be stated as such.** The prototype's
"store nothing" posture becomes "store nothing durable, and only what the job
needs while it runs." The privacy claim in the README must say that precisely
rather than repeating a stronger claim than the system delivers.

---

## 11. Security

Everything in §9.3 applies. PDFs add a distinct surface.

| Threat | Response |
|---|---|
| Decompression / render bomb | Page count, page dimension, and output pixel caps enforced **before** rasterising |
| Embedded JavaScript / actions | Never executed. Rasterisation only, in a renderer with scripting disabled |
| Encrypted or password-protected PDF | Rejected at intake with a clear message |
| Malformed PDF exploiting the parser | Parsing isolated from the coordinator; a crash fails one item |
| Injected instruction text in the artwork | Unchanged from §9.3 — extraction output is schema-constrained and verdicts are deterministic. **The corpus tests this at L13** |
| Job identifier guessing | Identifiers are unguessable; possession is the only capability |
| Batch endpoint abused for free inference | §6.3 caps plus provider spend cap. The dominant real risk (R8) |

**One threat is new and specific to this design.** A submission whose *form
region* carries injected text now reaches the **application-data** extractor —
a path that did not exist when application data was typed by an agent. The
mitigation is structural and already present: both extractions are blind, output
is schema-validated, and comparison is deterministic. Injected text can appear as
an extracted value shown to the agent; it cannot become a verdict.

---

## 12. Observability

Extends §9.4. All logging remains payload-free (D20).

| Signal | Why |
|---|---|
| Per-stage timing: stage, normalise, extract, compare | Attributes a missed budget to a stage (§9.1) |
| Queue depth and age | Backpressure; the earliest sign of provider slowdown |
| Retry rate by cause | Provider degradation before it becomes failure |
| Items per second | Capacity planning against the 200–300 requirement |
| **Verdict distribution per job** | §9.4.4 — a batch is a natural cohort. A job that is 100% clear when peers run 15% discrepancies is a signal, and it costs one counter |
| Dead-letter count | Must be zero; anything else is silent loss |
| Cost per job | R8, and the number Sarah will actually ask for |

All dimensioned by the versioned identity set (D28), so a change in verdict mix
can be attributed to a model change rather than merely observed.

---

## 13. Latency Budget

**B2 governs the first result, not the job.**

| Stage | Budget | Note |
|---|---|---|
| Upload of first file | ~600 ms | Overlaps subsequent uploads |
| Intake validation | < 100 ms | Cheap checks only; no rasterising |
| Enqueue and dispatch | < 200 ms | |
| Fetch staged content | < 100 ms | |
| **Normalise: parse, rasterise, crop** | **~800 ms** | New, and the least predictable term |
| **Extraction, two calls in parallel** | **~3.0 s** | Parallel, so one call's latency (§1.1) |
| Compare, aggregate, audit | < 50 ms | Deterministic |
| Emit and render | < 150 ms | |
| **Total** | **~5.0 s** | No reserve — see below |

**This budget is tighter than single review and has no slack.** Normalisation is
new cost that §9.1 never had. Two levers exist if measurement shows it missing:

1. **Rasterise the affix region first** and start label extraction before the
   record region is processed. The label extraction is the long pole; the record
   extraction is over faster.
2. **Reduce resolution** and accept more `UNREADABLE` verdicts on small text —
   an honest degradation, since `UNREADABLE` is a first-class outcome, but one
   that trades away exactly the check that matters most (FR-5).

**Lever 1 first.** Lever 2 trades correctness for speed and should be a last
resort, decided deliberately and recorded.

---

## 14. Portability

D12 required no dependence on one host's proprietary runtime. Batch introduces
six platform capabilities; each is consumed through an interface.

| Capability | Interface | Cloudflare | AWS | GCP | Self-hosted |
|---|---|---|---|---|---|
| Object staging | `ContentStore` | R2 | S3 | Cloud Storage | MinIO / filesystem |
| Work distribution | `WorkQueue` | Queues | SQS | Pub/Sub | Redis / RabbitMQ |
| Job coordination | `JobCoordinator` | Durable Object | DynamoDB + Lambda | Firestore + Cloud Run | Postgres row + advisory lock |
| Client streaming | `ResultStream` | WebSocket via DO / SSE | API Gateway WS | Cloud Run SSE | SSE from the app |
| PDF rasterisation | `Normaliser` | Container / Browser Rendering | Lambda + layer | Cloud Run + poppler | Container with poppler |
| **Inference brokerage** | **the gateway seam** | **AI Gateway** | **Bedrock** | **Vertex AI** | **LiteLLM / Envoy** |

### 14.1 Inference brokerage

*The capability added last, and only because its absence was felt.*

A day's inference allowance was spent without anyone being able to say on what.
Usage was visible as "it worked" or as a 429, and the accounting afterwards had
to be reconstructed by reading the code for call sites. That is not an
observability gap — it is a missing layer, and every platform has one because
every platform's users hit the same wall.

What the layer provides, and what the provider adapters must therefore **not**:

| Concern | Belongs to the broker | Why not the adapter |
|---|---|---|
| Usage and cost accounting | ✓ | Per-vendor totals are meaningless when two vendors serve one workload |
| Caching | ✓ | A cache in an adapter is invisible to the audit record |
| Rate limiting and spend caps | ✓ | A spend bound enforced in code is a bound one deploy from being removed |
| Credential brokerage | ✓ | Optional. It moves the vendor key out of the application entirely |
| Request and response shape | ✗ | The vendor's contract; the broker forwards it unchanged |
| Fault classification | ✗ | Only the vendor knows what its own 429 means (D37) |

**The seam is a base URL and a header, not an abstraction.** Cloudflare's AI
Gateway, Vertex AI and Bedrock all keep the underlying vendor's request and
response schema and change only where the request is sent — which is why the
Gemini adapter needed one field, `baseUrl`, and no logic. An interface that
tried to unify their *management* APIs would be a second abstraction with no
caller.

**Two properties are not optional, whatever the platform.**

*Absence must degrade, not fail.* An unconfigured or half-configured broker
falls back to talking to the vendor directly. An observability layer that can
take the service down is worse than none — but the fallback must be **visible**,
or a deployment silently stops being measured while appearing healthy. `/health`
reports whether inference is routed, and why not when it is not.

*Payload logging is off by default.* Brokers store request and response bodies
as a matter of course, and this system's are label artwork and the values read
from it — content, which logs must never carry (D20). Enabling a broker for its
metrics would otherwise persist applicant artwork to a third party as a side
effect. Metrics, token counts, latency and errors survive the restriction; only
the artwork and the readings are withheld.

**The coordinator is the one to watch.** Durable Objects give single-threaded
per-job serialisation for free; on other platforms the same guarantee needs
explicit locking or conditional writes. An implementation that leans on DO's
concurrency model without stating the assumption will develop races when ported.

**The interfaces are load-bearing, not decorative.** Item workers reach the
queue, the store and the coordinator only through them, so a port replaces five
adapters and touches no verification logic.

---

## 15. Cloudflare Implementation

*Limits below were retrieved on 2026-08-01. They change; verify before relying on
them.*

### 15.1 Constraints that shape the design

| Limit | Value | Design consequence |
|---|---|---|
| **Simultaneous outbound connections per invocation** | **6** | Fan-out comes from many invocations, not parallel fetches (§6.2) |
| Worker memory | 128 MB per isolate | **Rules out in-Worker rasterisation** of a 300 DPI page |
| Worker CPU | 5 min max (30 s default), paid | Ample per item; irrelevant to the memory problem |
| Queue message size | **128 KB** | Content cannot travel in messages — R2 keys do |
| Queue consumer concurrency | 250 push-based | Well above the provider's ceiling; not binding |
| Consumer wall clock | 15 min | One item per invocation is far inside it |
| Queue retries | Up to 100, with dead-letter | §8's budget of 3 is a policy choice, not a limit |
| DO requests | ~1,000/s soft, per object | One coordinator per job is comfortable at 300 items |
| DO SQLite storage | 10 GB per object | Ledger and results fit with room to spare |
| DO outbound connections | 6 per request | Coordinator must not fan out; it delegates |
| Browser Rendering | 120 concurrent, ~10 new/s | Viable for rasterisation, rate-limited at scale |
| Containers | Beta; 2–3 s cold start; no autoscaling | Fastest rasterisation, with operational caveats |

### 15.2 Mapping

| Role | Service |
|---|---|
| API and intake | Worker |
| Content staging | R2, with a lifecycle rule as TTL backstop |
| Work distribution | Queues, with a dead-letter queue |
| Job coordination and ledger | Durable Object, one per job, SQLite-backed |
| Client streaming | WebSocket to the job's DO, hibernating between events |
| Item processing | Queue consumer Worker |
| Rasterisation | Container (primary) or Browser Rendering (fallback) |
| Extraction | Provider adapter over `fetch` |
| Comparison | Shared library — the same code as single review (D8, B10) |

### 15.3 Why a Durable Object per job

A batch job is exactly the shape DOs exist for: a single logical entity with
serialised state and connected subscribers.

- **Single-threaded per object** — the ledger needs no locking, and "have all 300
  finished?" has no race
- **Hibernating WebSockets** — a job running 90 seconds with a connected browser
  costs nothing while idle
- **Colocated storage** — ledger reads are local, not network round trips
- **Natural identity** — the job id *is* the object id

**And the failure mode to respect:** the DO is a single point of serialisation.
It must stay a coordinator — recording state and fanning out — and never fetch,
rasterise, or extract. Its 6-connection limit and per-object throughput make that
a hard boundary, not a stylistic preference.

### 15.4 Rasterisation: Containers or Browser Rendering

| | Containers | Browser Rendering |
|---|---|---|
| Throughput | High; a real PDF library | ~10 new instances/s |
| Cold start | 2–3 s | Session setup per page |
| Maturity | **Beta, no SLA** | Generally available |
| Cost shape | Per running instance | Per browser-hour |
| Fit for 300 items | Good | Rate-limited |

**Recommendation: Containers, behind the `Normaliser` interface, with Browser
Rendering as the fallback.** Containers are the better fit and carry beta risk;
the interface makes that risk survivable — if Containers disappoint, the fallback
is an adapter swap rather than a redesign.

Neither should be in the request path for single review. There, the client
already conditions the image (§9.1) and adding a container hop would spend the
latency reserve for nothing.

---

## 16. Decisions

| ID | Decision | Rejected | Why | Reversibility |
|---|---|---|---|---|
| B-D1 | Label and application regions are extracted by **separate blind calls** (§1.1) | One call over the whole page | The artefact colocates expected and actual values; a single call defeats D4 and every resulting error is a false match | **One-way** — a correctness property |
| B-D2 | Batch is scheduling over the single-item pipeline | A batch-specific path | D8 — prevents divergence that only 300-item runs reveal | Costly |
| B-D3 | Items are enqueued as they upload, not after ingestion completes (§5.3) | Wait for the full batch | B2 is unachievable otherwise at any batch size | Easy |
| B-D4 | One item per worker invocation (§6.2) | Many items per invocation | The 6-connection cap would serialise extractions | Easy |
| B-D5 | Bounded retry in batch; none on the interactive path | Uniform policy | The agent waits on a single review and not on any one batch item | Easy |
| B-D6 | `INCOMPLETE` is a completed verdict, never a failure (§5.1) | Treating unreadable as a processing error | Otherwise an unreadable label is retried and can be reported as a system fault | **One-way** — D5 |
| B-D7 | Rasterisation runs server-side behind an interface (§4.4) | Client-side for batch | 300 files at 300 DPI is minutes of browser work, and client output would need re-validation anyway | Costly |
| B-D8 | Region maps are per form version, in configuration (§4.3) | A fixed crop rectangle | An unknown form must be rejected, not cropped blindly and extracted | Easy |
| B-D9 | Result cache across jobs is not enabled (§9) | Caching by content digest | A digest-keyed cache is retention; N3 forbids it without a policy | Easy |
| B-D10 | Content is deleted as a job step, with TTL only as a backstop (§10) | TTL alone | An abandoned job would otherwise retain submissions for the full window | Easy |
| B-D11 | Cost is estimated and confirmed before a job starts (§6.3) | Silent processing | The honest failure of an open batch endpoint is a bill | Easy |
| B-D12 | The coordinator never performs I/O beyond its own storage (§15.3) | A coordinator that also fetches | Its connection cap and throughput make delegation mandatory | Costly |
| B-D13 | The bundled corpus ships **pre-rasterised**; only an upload takes the browser path (§4.4) | Rasterising the corpus on every run | The corpus is fixed, and its pixels were already rendered at build time — the generator shoots the label artwork to PNG and embeds it in the PDF, after which the runtime launched a browser to extract the same pixels back. At one new browser per 20 seconds that cost more than the extraction it fed. The label raster is the **affixed, degraded** view, not the artwork: L09's rotation and L10's blur live on the page, so shipping the embedded PNG would have handed the model pristine artwork for the two cases that exist to test degraded input | Easy — but the region map and PDF parsing are no longer exercised by the corpus, and B-Q4 becomes a build-time question |
| B-D14 | A rate-limited item **keeps its queue slot** and waits in place (§8) | Returning it to the queue with a delay | Releasing the message releases the slot, so the next submission takes the turn. Over a corpus that produced bias, not delay: the first eight submissions exhausted their attempts against a saturated ceiling and failed for their position in the queue, while later items succeeded because those failures had thinned the contention. The two the exit criteria name are first in line | Easy |
| B-D15 | An exhausted allowance **abandons the job**; every remaining item settles with the same cause, in both the ledger and the durable record (§8) | Failing items individually | It does not clear by waiting, so continuing rediscovers the same dead end once per submission and leaves a reviewer with a screen of failures that look like a broken tool rather than a spent budget. Settling the durable record matters as much as the ledger: rows left `QUEUED` make the job read as running for ever, and because starting joins a job in flight, every later batch attaches to the corpse | Easy |
| B-D16 | Inference brokerage is a platform capability in its own right, behind a base URL rather than an abstraction (§14.1) | Metrics gathered inside the adapters; or a unified broker interface | Two vendors serving one workload make per-vendor totals meaningless, and a spend bound written in code is one deploy from being removed. Every platform has this layer — AI Gateway, Vertex AI, Bedrock — and all of them keep the vendor's own request and response schema, so the seam is a destination, not a translation. A unifying interface would abstract management APIs that nothing calls | Easy |
| B-D17 | A broker that is absent or half-configured falls back to calling the vendor directly, and `/health` says so (§14.1) | Failing closed when the broker is unreachable | An observability layer that can take the service down is worse than none. But a silent fallback is worse than either: the deployment stops being measured while appearing healthy, which is the failure the layer was added to prevent | Easy |
| B-D18 | Payload logging at the broker is off unless deliberately enabled (§14.1) | Accepting the broker's default | Brokers store request and response bodies as a matter of course. Here those are label artwork and the values read from it — content, which logs must never carry (D20). Turning on a broker for its metrics would otherwise persist applicant artwork to a third party as a side effect of wanting a request count | Easy |

---

## 17. Open Questions

| ID | Question | Blocks | Default |
|---|---|---|---|
| B-Q1 | Does a real COLAs Online export carry class/type, ABV and net contents, or must they be extracted from the record page? | Whether application extraction is needed at all in production | Extract, as the corpus models |
| B-Q2 | Do real submissions arrive as one PDF per application, or as archives? | Intake design | One PDF per application |
| B-Q3 | What is the provider's sustained rate limit at the chosen tier? | Concurrency ceiling (§6) | Conservative: 10 concurrent |
| B-Q4 | Is 300 DPI sufficient for the smallest compliant warning text? | §4.2, and FR-5 correctness | 300 DPI, measured against corpus L01 and L10 |
| B-Q5 | Should a job be resumable across days, or expire with the session? | Retention window (§10) | Expire in hours; N3 favours the shorter window |
| B-Q6 | Must batch results be exportable (FR-15)? | Whether results outlive the browser | Cut ladder item 2 — not in the prototype |

**B-Q4 is the one to resolve early.** It is measurable against the existing
corpus, it sets the cost and latency of every item, and getting it wrong produces
`UNREADABLE` verdicts on the check that matters most.

---

## 18. Prototype Scope

Batch is cut-ladder items 5 and 6 (§11.2) — the first substantial thing to go if
the day runs short. What follows is what "batch is built" means.

| Built | Deferred |
|---|---|
| Job creation, ledger, progressive results | Job resumption across sessions |
| One item per worker, bounded concurrency | Adaptive concurrency from provider signals |
| Per-item retry and dead-letter | Automatic re-submission of dead-lettered items |
| Server-side rasterisation, one form version | Multiple form versions; version detection |
| Per-item audit records, scoped per §11.2.1 | Rule-set binding and approval references |
| Payload-free logs with stage timings | Dashboards and alerting |
| Batch size cap and spend cap | Cost estimation UI (B-D11 as a design position only) |
| Explicit deletion on completion | Retention policy and its enforcement |

**The seams that must exist even if batch is cut entirely:** the `Normaliser`
interface (§4.4), because PDF submissions are now the real input shape for single
review too; and the split extraction of §1.1, which is a correctness property of
*any* pipeline that ingests a complete submission, batch or not.
