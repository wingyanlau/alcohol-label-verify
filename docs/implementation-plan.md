# Implementation Plan

*Per-milestone stories, requirement traces, and exit criteria. Expands
`design.md` §11.1, which lists the milestones but states only a one-line
definition of done.*

| Field | Value |
|---|---|
| Status | Current |
| Milestones | M0 – M10 |

---

## How to read this

Every milestone has a **beneficiary** — the person who is better off when it
lands. Where a milestone has no direct beneficiary it says so rather than
inventing an "as a developer I want…" story, which describes a task rather than
a need.

**Exit criteria are checkable by someone who did not do the work.** They are what
makes a milestone reviewable without a conversation, and — while this is built
autonomously — what replaces approval.

### Definition of done, common to every milestone

- [ ] `npm run quality-check` green — lint, typecheck, tests, coverage
- [ ] Nothing skipped without a written reason
- [ ] New requirements reflected in test-plan §12
- [ ] Decisions a reviewer might question are in the decision log
- [ ] Committed with the reasoning, not just the change

---

## M0 — Reference data verified

> **As a compliance agent,** I need the warning-statement check measured against
> the actual regulation, **so that** a pass or fail reflects the law rather than
> a transcription error nobody noticed.

| | |
|---|---|
| Beneficiary | Compliance Agent |
| Traces to | FR-5, FR-6, D3, Q1a |
| Entry | `config/warning-statement.json` exists |

**Exit criteria**

- [ ] Text compared against at least two independent renderings of 27 CFR 16.21
- [ ] Any discrepancy resolved, and `configVersion` incremented if the text changed
- [ ] `verificationStatus` set to `CONFIRMED`, **or** left `UNCONFIRMED` with an
      explicit record of which sources were reachable and which were not
- [ ] Q1a closed in `design.md` §12.2, or restated with what remains

**Not done by** asserting the text looks right. FR-5 is word-for-word; a single
wrong word invalidates every warning verdict the system will ever issue.

---

## M1 — Comparison core with unit tests

> **As a compliance agent,** I want differences judged by rules I can read and
> predict, **so that** I can defend a finding to an applicant and trust that
> trivial variance will not be flagged at me.

| | |
|---|---|
| Beneficiary | Compliance Agent — Dave's objection specifically |
| Traces to | FR-4, FR-7, FR-8, FR-10, FR-11, D1, D5 |
| Entry | M0 |

**Exit criteria**

- [ ] `src/domain/` contains normalisation, parsing, field comparison, warning
      verification, aggregation
- [ ] Every case in test-plan §3 exists as a test, with the test ID in its name
- [ ] The six guard tests pass: `UT-G03`, `UT-G04`, `UT-W05`, `UT-W12`,
      `UT-N08`, `CT-10`
- [ ] Coverage on `src/domain/**` ≥ 95% lines, ≥ 90% branches
- [ ] No file in `src/domain/` imports a platform API, a clock, or randomness
- [ ] Every verdict carries the rule that produced it (FR-10)
- [ ] `UT-A06` and `UT-Q07` are `todo` with Q7 cited, or implemented if M0
      resolved the tolerance question

**Verify:** `npm run quality-check` and `grep -rE "cloudflare:|Date\.now|Math\.random" src/domain/` returns nothing.

---

## M2 — Extraction behind the contract

> **As a compliance agent,** I want the system to read the label rather than
> guess at it, **so that** a value it reports is one it actually saw.

| | |
|---|---|
| Beneficiary | Compliance Agent |
| Traces to | FR-3, D4, §8.3, §8.3.1, §8.3.2 |
| Entry | M1 |

**Exit criteria**

- [ ] Extraction contract defined and schema-validated at the boundary
- [ ] A malformed or schema-invalid response is a **dependency failure**, never
      a verdict
- [ ] `absent` and `unreadable` are first-class, equally-weighted responses
      (§8.3.2 — schema pressure)
- [ ] Workers AI adapter implements the contract; no vendor concept appears
      above it
- [ ] **`CT-10` holds: the extraction call site has no access to application
      data**, enforced by type or structure rather than by convention
- [ ] Contract tests `CT-01` – `CT-10` pass
- [ ] Model identity, prompt version and sampling parameters are returned with
      every extraction

**The one that matters:** `CT-10`. If application data can reach the extractor,
anchoring produces false *matches*, and every one is a non-compliant label
passing review.

---

## M3 — Single-label path end to end

> **As a compliance agent,** I want to submit one application and see which
> fields disagree, within about five seconds, **so that** using the tool is
> faster than checking by eye.

| | |
|---|---|
| Beneficiary | Compliance Agent |
| Traces to | UC-1, FR-1, FR-2, FR-9, NFR-1, S1, B-D1 |
| Entry | M2 |

**Exit criteria**

- [ ] A submission PDF is accepted, normalised, and split into label and record
      regions **before** extraction (B-D1)
- [ ] Two blind extractions run **in parallel**, never as one call over the page
- [ ] Comparison and aggregation run on the results
- [ ] Corpus `L01` returns `CLEAR`; `L04` returns `DISCREPANCIES_FOUND` on
      alcohol content
- [ ] Latency measured and recorded in `design.md` §16.4 — **the measured
      figure, whatever it is**
- [ ] `L13` does not return `CLEAR`

**Not done by** hitting 5 s. It is done by *measuring* and recording the number.
§16.6 forbids revising a target after measuring it.

---

## M4 — Audit record and correlation identity

> **As an auditor,** I need to know what produced a verdict — which model, which
> rules, which reference data — **so that** the decision can be re-derived and
> defended later.
>
> **As a compliance agent,** I need a reference code on screen **so that** when I
> report a wrong result, someone can find it.

| | |
|---|---|
| Beneficiary | Auditor, Compliance Agent |
| Traces to | FR-17, FR-18, NFR-13, NFR-14, D21, D32, §11.2.1 |
| Entry | M3 |

**Exit criteria**

- [ ] Every review produces an audit record carrying the fields in §11.2.1
- [ ] The record persists to D1: `submission`, `extraction`, `verdict`,
      `field_verdict`, `warning_verdict`
- [ ] `audit_event` rows are appended and hash-chained; the chain verifies
- [x] A correlation identifier is generated per review and **surfaced in the
      response** — a quotable code (`7K2M-4QX9`, ui-design §10) at the foot of
      every result, derived from the submission id rather than allocated, so
      every review ever processed has one and always had it. `GET
      /reference/<code>` resolves it; without a lookup the code would be
      decoration
- [x] **Replay test passes**: a stored extraction re-compared yields a
      bit-identical verdict (NFR-13) — `GET /audit/replay/:submissionId`,
      re-derived through the same `verifySubmission` via a provider that
      returns recorded readings. Writing it found the requirement already
      broken: the legibility rule made the verdict depend on a measurement
      taken from pixels and nothing stored it, so a replay recomputed `CLEAR`
      where the record said `INCOMPLETE`. Migration 0002 records the decision
      on the verdict row. **Verdicts written before that migration are not
      re-derivable** and the endpoint reports them as disagreements, which is
      the honest answer rather than a defect
- [x] Submission content is purged from R2 (B-D10) — after a stated **review
      window**, not at completion. Completion is when the content starts being
      needed: the review screen shows the label crop and the submission as
      filed, so purging then would leave a reviewer two broken panels. A daily
      sweep deletes both objects `RETENTION_WINDOW_DAYS` after the job starts
      (configuration, shipped as 14 — it is a records decision, not a
      constant), marks the
      record, and appends `content.purged` to the chain. The policy is recorded
      in `schema_meta` and reported by `/health` beside the constant the sweep
      enforces. See B-D10, which was rewritten rather than merely ticked

---

## M4a — Replay rebuilt around a stored input set *(deferred)*

> **As an auditor,** I need re-derivability to fail loudly and specifically
> **so that** "cannot check" is never mistaken for "checked and sound".

| | |
|---|---|
| Beneficiary | Auditor |
| Traces to | NFR-13, NFR-14, D32 |
| Entry | M4 |
| Status | **Deferred until the MVP is end to end** — see `design.md` §17.3 |

Replay works and is tested. Two of its mechanisms are convention rather than
data: digests are parsed out of an audit detail string, and whether a verdict
predates the legibility decision is inferred from a migration filename. Both
degrade silently to "cannot check", which reads as fine.

**Exit criteria**

- [ ] `verdict.replay_inputs` holds a canonical document of every input the
      comparison consumed, and the chain commits to it
- [ ] Replay reads that document; no audit string is parsed for data
- [ ] Re-derivability is a schema check that **names the missing input**,
      not a date comparison against a migration
- [ ] A new non-reproducible input is added in one place, and older records
      report themselves incomplete without further code

---

## M11 — Verification layer and the automation path *(designed, not built)*

> **As a compliance agent,** I want the submission checked against the rules
> that actually apply to it **so that** the result is a compliance finding and
> not merely "these two documents disagree".

| | |
|---|---|
| Beneficiary | Compliance Agent, Auditor |
| Traces to | FR-10, D25, D26, D27, D30, §8.8.1 layer 3a |
| Entry | M5 |
| Status | **Designed in `design.md` §18. Nothing built.** The current code is aligned to permit it, not to anticipate it |

**Exit criteria**

- [ ] Policy set is versioned, approved data (`config/policy-set.json`), with
      rules superseded rather than deleted
- [ ] Checks are a closed vocabulary implemented in code; no expression
      language and no evaluator
- [ ] Rule selection is a deterministic query over the application record, and
      the verdict binds the selection **inputs**, not only the version
- [ ] `UNDETERMINED` is a first-class finding — a check that cannot be judged
      from artwork never reports satisfied
- [ ] The recommendation never reads as an approval
- [ ] `decision.recorded` captures what the agent decided against what was
      recommended — the only source of real ground truth

**Not done by** adding rules to `compare.ts`. The point is that the rule set is
data someone other than a developer can own, version and approve.

---

## M5 — Results presentation

> **As a compliance agent,** I want the label visible beside the verdicts with
> both values shown, **so that** I adjudicate against the artwork rather than
> against the tool's opinion.

| | |
|---|---|
| Beneficiary | Compliance Agent — all facets |
| Traces to | FR-9, FR-10, G4, G8, NFR-3, NFR-4, ui-design §4–§7 |
| Entry | M4 |

**Exit criteria**

- [ ] Single-review screen per ui-design §4, with the strings in §4.10
- [ ] Outcome banner renders all three outcomes; `INCOMPLETE` cannot read as a pass
- [ ] Field rows show field, status **with icon and words**, both values, and the
      rule applied
- [ ] **The rule line appears only when a rule was exercised** (ui-design §6.3)
- [ ] The label image remains visible while results scroll (§6.4)
- [ ] Warning block shows the deviation, not merely that one exists
- [ ] Advisory checklist present (FR-6a), and never fails the verdict
- [ ] Correlation code shown at the foot
- [ ] Keyboard operable; focus moves to the outcome on completion; status is
      never colour-only

---

## M6 — Error handling

> **As a compliance agent,** I want to be told what went wrong and what to do
> next, **so that** I never record a rejection for a system fault.

| | |
|---|---|
| Beneficiary | Compliance Agent |
| Traces to | NFR-5, NFR-6, NFR-8, §9.2, §9.3, ui-design §10 |
| Entry | M5 |

**Exit criteria**

- [ ] Every failure class in §9.2 produces its stated message
- [ ] Intake limits enforced **server-side**: size, page count, pixel bounds,
      content-sniffed type
- [x] `ADV-02` – `ADV-06` pass: oversized, decompression bomb, corrupt,
      mislabelled type, over-cap batch. `ADV-06` had no implementation at all —
      `MAX_BATCH_ITEMS` was configured, validated at startup and reported by
      `/health`, and nothing consulted it
- [ ] Service-unavailable copy includes *"nothing is wrong with your label"*
- [ ] No raw exception, stack trace, or blank state reaches a user
- [x] Corpus `L26` (truncated PDF) is rejected at intake with a clear cause —
      a PDF that does not end with `%%EOF` is incomplete, which is a different
      fact from damaged and needs a different action. The test that claimed to
      cover this truncated a stub to 12 bytes and was caught by the zero-pages
      check; the real file keeps its page markers and passed everything

---

## M7 — Payload-free logging with stage timings

> **As an operator,** I want to see where time goes and what is failing, without
> label artwork appearing in a log file, **so that** I can diagnose the system
> without creating a privacy incident.

| | |
|---|---|
| Beneficiary | Operator |
| Traces to | D20, D28, §9.4.3, §9.4.4, §9.4.6, §16.4 |
| Entry | M6 |

**Exit criteria**

- [ ] Structured logs carry identifiers, classifications, versions and timings
- [ ] **No log line contains artwork, application values, or extracted values**
- [ ] Per-stage timings emitted: normalise, extract, compare, total
- [ ] The versioned identity set appears as log dimensions (D28)
- [ ] Errors classified by the §9.2 taxonomy
- [ ] A grep for known corpus values across captured logs returns nothing

---

## M8 — Deployment

> **As the evaluator,** I want a URL that works, **so that** I can test the thing
> rather than read about it.

| | |
|---|---|
| Beneficiary | Evaluator |
| Traces to | NFR-11, NFR-12, D31 |
| Entry | M7 |

**Exit criteria**

- [ ] Public URL serves the full pipeline, not only health probes
- [ ] `/health` returns `ok` with every binding `true`
- [ ] Binding table checked in the deploy output — **a deploy can succeed with a
      binding silently missing**
- [ ] A real submission verified end to end against the live URL
- [ ] `deployment-runbook.md` §1 matches the account

---

## M9 — Batch

> **As Janet in the Seattle office,** I want to submit a peak-season filing and
> start triaging problems while the rest is still processing, **so that** three
> hundred applications do not mean staring at a progress bar.

| | |
|---|---|
| Beneficiary | Compliance Agent — the batch facet |
| Traces to | UC-2, FR-12, FR-13, NFR-2, NFR-6, NFR-9, B1–B10 |
| Entry | M8 |

**Exit criteria**

- [ ] A job accepts multiple submissions and returns a job identifier
- [ ] Items are enqueued **as they arrive**, not after ingestion completes (B-D3)
- [ ] Results stream progressively; the first arrives before the last is uploaded
- [ ] Worklist shows problems first and keeps them there
- [ ] One failing item does not abort the job (NFR-6)
- [ ] A subscriber attaching late receives a snapshot then deltas
- [ ] The full 26-submission corpus runs, and the outcome is scored against
      `manifest.json`

---

## M10 — README and documentation

> **As the evaluator,** I want to understand the approach, the assumptions, and
> what does not work, **so that** I can judge the engineering rather than guess
> at it.

| | |
|---|---|
| Beneficiary | Evaluator |
| Traces to | Brief deliverable 1; §16.5, §16.6 |
| Entry | M9 |

**Exit criteria**

- [ ] Setup and run instructions that work from a clean clone
- [ ] Approach, tools, and assumptions stated
- [ ] Limitations stated, each with its test ID where one exists
- [ ] **The privacy claim is corrected** — D32 means "stores nothing" is no
      longer true
- [ ] **No accuracy percentage is claimed** from a synthetic corpus (§16.5)
- [ ] §16.4 measurement table filled in, including any target that was missed
- [ ] "With more time" section derived from the §11.2 cut ladder

**The honesty criteria are the point.** A reviewer who finds one unsupported
number discounts every other one.

---

## Order and dependencies

```
  M0 ─▶ M1 ─▶ M2 ─▶ M3 ─▶ M4 ─▶ M5 ─▶ M6 ─▶ M7 ─▶ M8 ─▶ M9 ─▶ M10
```

Strictly sequential, and three of the orderings are deliberate rather than
incidental:

| | |
|---|---|
| **M1 before M2** | The deterministic core is tested before anything probabilistic exists, so a later disagreement is unambiguously in extraction rather than in the rules |
| **M4 before M5** | The audit record is assembled from values the pipeline already holds. Building it after the interface invites reconstructing provenance from whatever ended up on screen |
| **M8 before M9** | A deployed narrow system beats an undeployed broad one — the URL is a stated deliverable, batch is a *Should* |

If time runs short, cut from M9 backwards using the ladder in §11.2 — never from
the middle.
