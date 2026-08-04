# alcohol-label-verify

Checks alcohol beverage label artwork against its TTB application record, and
verifies the statutory health warning.

It produces **evidence for a compliance agent**. It does not approve or reject.

**Live (staging):** https://alcohol-label-verify-staging.wing-lawrence.workers.dev

---

## The governing principle

> **The model reads. The rules compare. The human decides.**

Extraction is confined to perception — what is printed on the artwork. Every
verdict is then computed by deterministic code from versioned reference data. A
model never decides whether something complies, never sees the expected values
while reading, and never selects which rules apply.

Most of the design follows from that one sentence. It is also the answer to the
question a reviewer of this system would ask first: *how do you know the model
did not simply agree with the applicant?* It cannot, because it is never shown
what the applicant claimed (D4, guarded by `CT-10`).

**It is now enforced rather than asserted.** Every recorded act names the agent
that performed it, with a kind — `human`, `model` or `system` — and the code
refuses an act the kind is not entitled to: a model cannot record a decision,
and neither a model nor a deployment can enact a rule (design §19, D46). Until
that landed the principle lived in one validation and a lot of prose, and prose
does not fail a build. It found a real hole on its first run.

---

## What it does, end to end

| Layer | What it produces |
|---|---|
| **Read** | Two blind extractions — label artwork and application record — neither shown the other's values |
| **Compare** | Field verdicts against the application, and the health warning against the statute, word for word |
| **Check compliance** | Findings against a versioned, effective-dated policy set: each with its citation, the check as applied, and the regulation text it rests on |
| **Recommend** | An outcome and a sentence that never says *approved* — only *ready for your approval* |
| **Decide** | A person approves, rejects or returns. Recorded against what was recommended, so agreement can be measured |
| **Audit** | A hash-chained trail; any verdict re-derivable from the record without calling a model |

The last three arrived late and are the part worth reading: `docs/design.md`
§18 (the verification layer), §18.8 (the policy archive as a bitemporal record)
and §19 (the agent).

---

## Running it

Requires Node 22+ and a Cloudflare account with Workers, D1, R2, Queues,
Durable Objects and Browser Rendering.

```bash
npm ci
npm run quality-check     # lint, typecheck, 361 tests with coverage
npm run dev               # local worker; D1, R2 and queues are simulated
```

The comparison logic — the part that decides verdicts — has no platform
dependency and runs entirely under `npm test`. You can evaluate the rules
without deploying anything.

### Deploying

```bash
npm run migrate:staging && npm run deploy:staging
```

Migrations run **before** the deploy, never after. Secrets are set with
`wrangler secret put` and never appear in `wrangler.jsonc`:

| Secret | Needed when |
|---|---|
| `MODEL_API_KEY` | `MODEL_PROVIDER=gemini`. Workers AI authenticates via its binding |
| `AI_GATEWAY_ACCOUNT` | routing inference through AI Gateway |
| `AI_GATEWAY_TOKEN` | only if the gateway is authenticated |

Pushing to `main` migrates, deploys and health-checks staging automatically.

### Trying it

Open the URL and press **Check the 26 test submissions**. The bundled corpus
covers matches, genuine discrepancies, unreadable fields, the health-warning
cases, and an injection attempt.

Useful endpoints:

| | |
|---|---|
| `/health` | configuration, bindings, model, retention policy |
| `/health/inference` `/health/raster` | dependencies, with round-trip latency |
| `/audit/verify` | recompute the hash-chained history |
| `/audit/replay` | re-derive recent verdicts from the record |
| `/reference/<code>` | find a review from the code an agent quoted |

---

## Approach

**Two blind extractions, never one.** The label and the application record are
read by separate calls, in parallel. Merging them would save a round trip and
silently defeat blind extraction — the model would see the expected values
beside the artwork, and anchoring produces false *matches*. Every false match
is a non-compliant label passing review.

**Label artwork is read from pixels, never a PDF text layer.** A text layer can
disagree with what the page displays, and compliance concerns what a consumer
sees.

**Legibility is measured, not asked.** Shown an illegible warning statement, a
model returns the statute verbatim from memory and reports success — two
renderings differing only in `birth defect` versus `birth defects` produced
byte-identical transcriptions. So legibility is computed from the pixels
(edge energy) against a configured floor. *Anything a model could know without
looking cannot be verified by asking it.*

**Every verdict names the rule that produced it**, so an agent can defend a
finding to an applicant rather than relaying a machine's opinion.

**`UNREADABLE` outranks everything.** A submission with an unreadable field can
never aggregate to a clear result, whatever else matched.

### Stack

Cloudflare Workers, D1, R2, Queues, Durable Objects, Browser Rendering.
TypeScript 5.9 strict. Two inference adapters behind one seam — Workers AI and
Gemini — chosen by configuration, so the same corpus can be read by either and
compared. Vitest, Biome. The test corpus is generated by Python and Chrome at
build time, not at runtime.

---

## What it costs, measured

Not estimated. Taken from a full corpus run on staging (26 submissions,
Gemini via AI Gateway, pre-rasterised corpus):

| | |
|---|---|
| Per submission, median | **3.2 s** end to end |
| Fastest | 2.7 s |
| Slowest | 142 s — one item, waiting out a Browser Rendering rate limit |
| Whole corpus | ~90 s of work, serialised at one item in flight |

The slow item is the corrupt-PDF case, the only submission that cannot use the
pre-rasterised corpus and so needs a live browser. The free plan admits one new
browser every 20 seconds, and the item waits it out rather than surrendering its
queue slot — releasing it made failure track queue position rather than the
submission.

---

## What it stores, precisely

The prototype's early claim was "stores nothing". **That is no longer true, and
saying so would be the kind of overstatement this system exists to avoid.**

| Data | Kept | For how long |
|---|---|---|
| Submission PDF, label crop | R2 | `RETENTION_WINDOW_DAYS` from the job's start — ships as 14 — then deleted by a nightly sweep that records the deletion |
| Verdicts, extractions, audit chain | D1 | Indefinitely, pending a records schedule (Q-PRV-03) |
| Logs | Cloudflare | Identifiers, classifications, versions and timings only — never artwork or values read from it (D20) |

The deployment states its own policy in `schema_meta.retention_policy`, and
`/health` reports that alongside the window the sweep actually enforces. A
mismatch between the two fails the deploy gate: a retention promise that has
drifted from the deletion schedule is a false statement about someone's data.

Content is kept for a *review window* rather than deleted at job completion,
because review happens after a job finishes and reads the artwork. The window
is measured from the job's start so that an abandoned job is purged too.

---

## Limitations

Stated with the test that pins each, where one exists.

**No accuracy percentage is claimed.** The 26-submission corpus is synthetic
and was authored alongside the system, so a percentage computed from it would
measure agreement with my own expectations, not real-world accuracy. What can
honestly be said: on the most recent full run, **24 of 26 outcomes matched the
authored expectation**, and both disagreements are understood —

- `L11` (a shipping label affixed instead of artwork) produced
  `DISCREPANCIES_FOUND` where `INCOMPLETE` was expected. Both are non-passes;
  the system found the right problem and classified it differently.
- `L26` (a truncated PDF) settled as `FAILED` rather than `INTAKE_ERROR` on
  that run. It is now refused at intake as incomplete, which is the same
  judgement in the system's own vocabulary (`REJECTED`).

**The corpus is crisper than reality.** The labels are vector text rendered at
known DPI, not photographs. Accuracy measured here overstates what a real scan
would give; only `L09` (skew and glare) and `L10` (out of focus) approximate a
degraded submission.

**Known defects and gaps**

| | |
|---|---|
| `ADV-07` (concurrency) untested | Cross-request state isolation is asserted by design, not by a test |
| Attribution is declared, not verified | This deployment authenticates nobody. `decided_by` is a name typed into a box, so no record here is evidence of *who* — only of *what* (design §19.5) |
| The policy cannot be read out of the system | The archive holds 15 rules with their windows, citations and approvers, and nothing exposes them. `/health/policy` returns counts. You can review the rules only in the reviewed file |
| The enforced rules carry no provenance | The nine rules in force hold no source quote; the six drafts do. A finding pins its regulation by digest and issue date instead, which is traceable but not *reviewable* (§18.5a) |
| Durable Object has no test harness | `vitest.config.ts` runs on Node; the coordinator is exercised only end to end |
| No reviewer gate on production | The `production` GitHub environment has no required approver, and the `prod` branch does not exist |

**What the audit record proves, and does not.** A stored verdict can be
re-derived exactly from the record, without re-invoking the model
(`/audit/replay`, NFR-13) — and each reading's digest is committed to the hash
chain, so an altered reading is reported as an altered *record* rather than as
a rule that moved. It does **not** prove the reading was correct; that is a
question about the model, which the corpus addresses and cannot settle.
Verdicts written before the legibility decision was recorded report themselves
as not re-derivable rather than quietly passing.

---

## With more time

In the order I would actually do them.

0. **Expose the policy for reading.** The archive is built, populated and
   audited, and nothing can display it. Until a reviewer can see the six
   proposed rules beside their citations and quotes, none of them can be
   approved — you cannot review what you cannot read. Smallest item here and
   the prerequisite for the next one.
1. **Enact a rule, and watch a past verdict survive it.** Six drafts wait on a
   named approval. Enacting one is the experiment worth running: verdicts
   recorded before the change must still replay `identical`, because the
   archive rebuilds the rules as they stood. Under a version-numbered policy
   the same change would have made every prior verdict permanently
   incomparable.
2. **Answer B-Q4 with a measurement.** Two adapters, one instruction, one
   prompt version, one corpus: which model reads a 4.5pt warning statement best
   is a controlled comparison this system is already built for, and nobody has
   run it.
3. **Rebuild replay around a stored input set** (see `docs/design.md`). The
   current implementation recovers digests by parsing an audit string and
   infers schema capability from a migration filename — it works and is tested,
   but three parts of it are convention where they should be data.
4. **An authenticated identity.** Everything attributed here is a name someone
   typed. Until that changes, no record is evidence of *who*, which is the
   single largest gap between this and something an auditor could rely on.
5. **Retention driven by a records schedule** rather than a number I chose.

### The recall gap, which is the honest headline

**What the system decided is fully recoverable. What it decided *by* is not.**

A verdict can be called up by the code an agent quoted, and it answers
completely: which rules were applied, what each required, what was observed,
who decided, and a replay that re-derives the outcome from the stored readings
without calling a model. On the current record that is `identical` for every
verdict written since the archive existed.

The policy behind it is reachable only through the file in git:

| | |
|---|---|
| **No way to read the rules out** | The archive holds them — both time windows, citations, approvers, and the six unapproved drafts — and no endpoint exposes any of it. This is the next thing to build, and it is small |
| **The regulation text is not stored** | A registered regulation holds a digest, a length and an issue date. That pins the source exactly and cannot be paraphrased, but recalling *the words* means fetching eCFR |
| **The enforced rules have no quote** | Adding one means asserting who read the regulation, which is a governance act rather than a schema change (§18.5a, D46). The diff is small; it needs a person's name on it, not mine |

**Where an LLM would earn its place.** Recall is exactly the shape of problem
these models are good at and this system currently refuses to use them for:
given a finding, produce the passage it rests on, the neighbouring provisions
that qualify it, and the ones a reviewer would want to have seen. Nothing about
that touches a verdict — the model would be assisting *review of the rules*,
not deciding compliance — so it sits cleanly on the right side of the governing
principle. The agent concept (§19) is what would make it accountable: such a
model is an agent of kind `model`, its work attributable, and structurally
incapable of deciding anything.

That is the direction this prototype is pointed at, and deliberately did not
take: the reading layer was kept narrow so that everything downstream of it
could be deterministic and defensible first.

---

## The documents

The design was worked before the code and is the specification, not background.

| | |
|---|---|
| [docs/exploration-session.md](docs/exploration-session.md) | how the problem was worked and what was settled — read first if picking this up cold |
| [docs/design.md](docs/design.md) | requirements, architecture, verification logic, provenance, the decision log |
| [docs/test-plan.md](docs/test-plan.md) | §3 is the executable spec: ~130 enumerated cases with inputs and expected outcomes |
| [docs/ui-design.md](docs/ui-design.md) | screens, states, and every string |
| [docs/batch-backend-design.md](docs/batch-backend-design.md) | job orchestration and platform mapping |
| [docs/deployment-runbook.md](docs/deployment-runbook.md) | every resource, step, verification and rollback |
| [docs/implementation-plan.md](docs/implementation-plan.md) | per-milestone exit criteria |
| [docs/project-reference.md](docs/project-reference.md) | stakeholders, verified TTB context, open questions |

The statutory warning text in `config/warning-statement.json` was confirmed
byte for byte against the eCFR versioner API — 283 characters, compared
programmatically with no model interpreting it. The corpus cannot catch an
error there, because the corpus is generated from that same file.
