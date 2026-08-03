# Exploration Session

*A record of the first working session: what the brief actually asked, how the
problem was interrogated, and what was settled before any application code was
written. Kept because how a design was arrived at is itself evidence — and
because the next session should not have to reconstruct it.*

| Field | Value |
|---|---|
| Session | Exploration |
| Dates | 2026-07-30 to 2026-08-02 |
| Outcome | Design settled, foundations built, application not completed |
| Branch at close | `feature/batch-poc` at parity with `main` |

---

## 1. The Problem as Presented

The brief asks for a prototype that checks alcohol label artwork against its TTB
application and verifies the mandatory health warning. It is written as four
interview transcripts plus a short technical section — **not as a specification**.

That shape is the first real problem. The requirements are distributed through
conversation, and several of the binding ones appear only as asides:

| Requirement | Where it appears |
|---|---|
| Results within about five seconds | Sarah, recalling why the previous vendor pilot failed |
| Batch upload, 200–300 items | Sarah, relaying a request from a colleague in Seattle |
| Tolerate `STONE'S THROW` against `Stone's Throw` | Dave, as an example of needing judgment |
| The warning must be exact, header in capitals | Jenny, describing a rejection she made |
| The network blocks outbound ML endpoints | Marcus, describing why the last pilot half-worked |

**Reading the brief as a feature list would have missed most of what governs the
design.** A requirement stated as an anecdote is still a requirement.

### What was genuinely ambiguous

Three things the brief does not settle, and which change what gets built:

1. **What "matches" means.** `STONE'S THROW` and `Stone's Throw` must match;
   `Old Tom` and `Old Tom Distillery` must not. The boundary is the product.
2. **What happens to a discrepancy.** Reject? Flag? Return? The brief does not
   say, and the answer determines whether the tool decides anything at all.
3. **Where the application data comes from.** The brief implies a form; it does
   not say what carries it.

All three were resolved during the session — the third by reading the actual TTB
form, which turned out not to contain three of the four fields under comparison.

---

## 2. How the Problem Was Worked

*The method mattered more than any individual decision, so it is recorded as
method rather than as a list of outcomes.*

### 2.1 Building was refused until the thinking existed

The session opened with a request to look at the brief and build a web
application. The agent responded by asking which model provider, which host, and
which input format. That was rejected, and a second round of implementation
questions was cut off:

> *"we are far from building yet"*

The direction given instead:

> *"I think we need to build a project plan first, starting with a proper
> software design template, so we have a guideline to make sure we cover all the
> concerns"*

The agent drifted back toward implementation twice more and was stopped both
times. A working spike was written and deleted. **The discipline had to be
enforced repeatedly rather than stated once**, which is worth recording honestly:
the pull toward code is strong and does not go away after one correction.

### 2.2 Premature decisions were challenged, not answered

Asked to choose a deployment platform in the first exchange, the response was not
a choice:

> *"why we need to decide on deployment platform so early?"*

That was correct. The only architectural coupling was runtime-specific APIs, and
avoiding those cost nothing. Deployment was deferred by roughly a week of
elapsed decisions and settled later on evidence — a measured 3,375 ms
rasterisation round trip — rather than on preference.

**Auditing whether a question should have been asked is a different move from
answering it, and it removed a decision that would have had to be revisited.**

### 2.3 Claims were interrogated until they were precise

Two exchanges changed the design.

**On blind extraction.** The agent asserted that the extractor must never see the
expected values, without justification. The response:

> *"why the extractor is never shown the expected values?"*

That produced §8.3.1 — anchoring biases toward *agreement*, so every anchored
error is a false **match**, which means a non-compliant label passing review,
silently, in the direction nobody audits.

**On what that actually claims.** The follow-up caught a real imprecision:

> *"so, are you saying if we tell the agent what to look for, it will hulucinate
> to say the infomation is on the label?"*

The agent had been conflating two different things — telling a model *which
fields to look for* (necessary) and telling it *what values to expect*
(forbidden). Separating them produced §8.3.2 on **schema pressure**: asking for a
field at all creates pressure to fill it, independent of any expected value.
That is why `UNREADABLE` and `MISSING_ON_LABEL` are first-class verdict states
rather than error cases.

**Neither section would exist without the question.** The first claim was
under-argued; the second was imprecise. Both survived only because they were
challenged.

### 2.4 Basic questions were asked without hedging

> *"what does rasterise mean?"*

Asked mid-design, by the person directing it. The answer led directly to
understanding why resolution is a decision at all, and the rasterisation approach
was settled on a measurement rather than deferred as a detail.

### 2.5 Architecture was contributed, and correction accepted

Several proposals came from the prompter rather than the agent:

| Proposed | Outcome |
|---|---|
| Three agent services — extract, match, verify compliance | **Decomposition kept, engines changed.** An LLM matcher cannot be deterministic, and determinism was a stated requirement (D23) |
| A knowledge graph to ground compliance decisions | **Partly adopted.** Retrieval grounds the *input*; it cannot make the *output* reproducible. Retrieval informs a human; it does not decide (§8.8.3) |
| Numeric typing in the JSON schema to help the model compare | **Instinct correct, conclusion inverted.** Typed *extraction* with comparison in code — which is the deterministic comparator already specified |
| Statutory text as an updatable configuration file | **Adopted wholesale** (D3) |
| Pin model version per decision, tied to observability | **Adopted, and extended** — versions became metric dimensions, not just record fields (D28) |
| D1 for structured data and transaction history | **Adopted, with a documented reversal** — it superseded "store nothing" (D32) |

Where the agent disagreed it said so and explained why; where the reasoning held,
the correction was taken without re-litigation. **The three-layer decomposition
survived every one of these exchanges — only what runs each layer changed.**

### 2.6 State was audited rather than trusted

Progress reports were not taken at face value. Each of the following questions
found a real gap:

| Question asked | What it found |
|---|---|
| *"do we have the current design and deployment committed?"* | Uncommitted tooling; nothing pushed |
| *"is each milestone has clear user story requirement and exit criteria?"* | **No.** Eleven milestones with one-line definitions of done, not checkable by anyone else |
| *"did we setup the claude.md for this repo properly?"* | **No.** No `CLAUDE.md`, no test framework, no coverage config |
| *"what else need to be address before implementation?"* | Five gaps, including a document section cited by two committed files but never written, and rasterisation still undecided |
| *"are we ready to deploy a PoC?"* | **No** — and it exposed that M8 had been called done while its own exit criterion was unmet |

This is the single highest-yield behaviour in the session. **Every one of those
was found by asking, not by the agent noticing.**

### 2.7 House standards were supplied, not invented

> *"/Users/winglau/source/club as reference, there are setup in that repo"*

The TDD workflow, the required-test-categories table, the `quality-check` gate
and the pre-push hook all derive from an existing repository rather than from the
agent's preferences. Two things were adapted rather than copied: the test
categories were rewritten for this domain, and coverage was scoped to
`src/domain/**` instead of a repository-wide percentage.

### 2.8 Governance was externalised before autonomy was granted

Autonomy was requested — *"can you do M0 to M10 with option to not making me
answer question or approval"* — and the agent's response was that exit criteria
are the mechanism that replaces approval. The instruction that followed was to
write them first.

That ordering is deliberate and worth preserving: `CLAUDE.md`, the implementation
plan and the deployment runbook exist **so the work can survive the absence of
the person directing it.**

---

## 3. What Was Aligned On — Understanding

Findings established during the session that the brief does not contain, and
which changed the design.

### 3.1 TTB does not reject — it returns for correction

An application TTB cannot approve is returned as **`Needs Correction`, with a
list of the corrections required** and thirty days to fix them. Only then does it
become `Rejected`.

This resolved the ambiguity in §1 and validated the design's central posture: the
agent's normal action is neither approval nor rejection. **The tool's output is,
almost exactly, the correction list an agent has to write.**

### 3.2 The form does not carry three of the four fields

TTB F 5100.31 has fields for brand name and fanciful name. It has **no field for
class/type designation, alcohol content, or net contents** — Item 15 asks for
such information only where it is embossed on the container and absent from the
labels.

So the brief's *"ABV is correct? Check"* cannot be a form-versus-label comparison.
Either COLAs Online captures structured data the paper form does not, or the
brief simplified. This is why the test corpus models an electronic record on a
second page, and it remains a question for the business owner.

### 3.3 TTB does not routinely check what the design chose not to check

> *"TTB does not routinely review submitted labels for compliance with
> applicable requirements for mandatory label information regarding type size,
> characters per inch, or contrasting background."* — TTB F 5100.31 §II.C

The prototype defers exactly what TTB itself defers. That is a far stronger
justification for the advisory-only formatting checks than "image metrics are
unreliable."

### 3.4 No tolerance applies to the comparison being performed

27 CFR 5.65 and 5.37 govern *actual contents* against a printed claim. Comparing
a printed value against an application value has no tolerance provision, because
both are statements of the same intended figure. **Exact numeric comparison is
correct**, with a citation rather than an assumption.

A separate and narrower tolerance was later added for *unit conversion only* —
`25.4 fl oz` is 751.2 mL — because that imprecision comes from the conversion,
not from any permitted variance.

### 3.5 The complete label set is affixed to one page

The form instructs applicants to affix the **complete set** of labels. This
substantially reduces the back-label risk: ingesting the whole submission page
captures the warning statement wherever it sits. The risk survives only where the
tool is handed a cropped front-label image instead of the submission.

---

## 4. What Was Aligned On — Decisions

Thirty-three decisions are logged in `design.md` §13. Seven are marked one-way —
reversing them would be a redesign rather than a change.

| | Decision | Why it cannot be reversed cheaply |
|---|---|---|
| D1 | The model reads; deterministic code compares | Every verdict's explainability and reproducibility rests on it |
| D4 | The extractor never sees expected values | Anchoring produces false matches — the dangerous direction |
| D5 | `UNREADABLE` outranks every other verdict | Prevents a label passing because the system was blind to the problem |
| D11 | Determinism claimed for the decision layer only | Hosted inference is not deterministic; the claim could not be honoured |
| D17 | Uploaded documents are authority, never a rule source | A model-generated rule makes the deterministic layer model output |
| D22 | Rule correctness and end-to-end accuracy reported separately | Merging lets weak evidence borrow strong evidence's authority |
| B-D1 | The submission page is split before extraction | The artefact colocates what the architecture requires be separated |

**Two decisions were reversed during the session, and both are recorded as
reversals rather than edited away.** D12/D13 (single container on Cloud Run) were
superseded by D31 once Workers was chosen for the prototype. N3, NFR-7 and D6
("store nothing") were superseded by D32 once a durable record was required —
which also means the privacy claim in any README has to change, since "stores
nothing" stopped being true.

---

## 5. What Was Aligned On — Artefacts

| Artefact | What it is |
|---|---|
| `design.md` | The specification. 17 sections, 33 decisions, every requirement traced to a named source |
| `test-plan.md` | ~130 enumerated unit cases with inputs and expected outcomes — the executable specification |
| `ui-design.md` | Screens, every state, every string. Personas consolidated to one Compliance Agent |
| `batch-backend-design.md` | Job orchestration, normalisation, concurrency, platform mapping |
| `deployment-path.md` | Workers → container, with the nine rules that keep the port cheap |
| `deployment-runbook.md` | Every resource and command, verification, rollback, teardown |
| `implementation-plan.md` | Per-milestone stories and exit criteria |
| `project-reference.md` | Stakeholders, verified TTB context, ~50 open questions |
| `testdata/` | 26 submissions on the real TTB form, with authored ground truth |

**The test corpus is worth singling out.** It carries a defect that was found and
fixed during the session: the labels were initially rendered as text, so a
text-layer reader would have scored 100% without calling a model. **The corpus
validated nothing until the label artwork was rasterised.**

---

## 6. What Was Aligned On — Foundations

| Component | State |
|---|---|
| Comparison, warning verification, aggregation | Complete, pure, 200 tests, 99% statements |
| Extraction contract | Complete. CT-10 enforced by the type — the request has no slot for expected values |
| Workers AI adapter | Complete, with provenance and prompt versioning |
| Normaliser and region maps | Complete. An unrecognised form is rejected, never cropped on assumption |
| Verification pipeline | Complete. Two blind extractions, concurrent |
| Cloudflare infrastructure | Deployed and healthy — Worker, R2, D1, Queues, Durable Object, Workers AI |
| Batch API, queue worker, UI | **Not built** |

---

## 7. What Remains Open

| | |
|---|---|
| **M0** | The statutory warning text is unverified against the primary source. FR-5 rests on it |
| **B-Q4** | Whether a model can read a 4.5 pt warning at 300 DPI. Measurable against the corpus, but only with a live deploy |
| Model selection | Five vision models available; which reads small text best has not been measured |
| Retention | `schema_meta.retention_policy` is `UNSET`. D32 made retention a real obligation |
| Batch demonstration | M9 not started |

---

## 8. What This Session Cost

The design ran long. At the point a working batch demonstration was asked for,
the repository held eight documents, roughly four thousand lines, thirty-three
decisions — and **no verification code at all**.

The recovery was fast once building started: the comparison core and extraction
contract landed with 200 tests inside an hour, precisely *because* the test plan
had already enumerated the cases. The front-loading paid back, but not inside the
original one-day budget.

An attempt to continue the build on a remote instance failed — the agent stalled
after one line of output and produced nothing.

**The honest summary: this session produced an unusually defensible design and an
unusually well-documented process, at the cost of the working artefact the brief
asks for first.** Whether that trade was right depends on what a reviewer weights.
The "here is one day's work, and here is what I would do with more" framing —
chosen early, once the timeline collapsed from a week to a day — is what makes it
defensible either way.

---

## 9. Where a Build Session Starts

Construction, not design. The specification exists, the exit criteria exist, and
`CLAUDE.md` carries the rules.

```
  M3 (finish)  →  M4  →  M9  →  M5  →  M6  →  M7  →  M10
```

| Order | Why |
|---|---|
| **M0 first** | Fifteen minutes, and FR-5 rests on it |
| M3 → M4 before M9 | The audit record is assembled from values the pipeline already holds; building it later invites reconstructing provenance from whatever ended up on screen |
| M9 before M5 | The batch worklist and the single-review view share one results design |

**The first deploy answers B-Q4**, and that answer may change the resolution, the
model, or both. Expect the first real run to reveal something rather than to
confirm everything.
