# How this was built

*Every claim here names the artefact that proves it. "We practised TDD" is an
adjective; "CI fails if this named test is absent, at `quality.yml:36`" is
checkable. Where a practice was partial, this says so — a practices document
that claims uniform virtue is the least trustworthy page in a repository.*

---

## 1. Test-driven, and specifically *catalogue-first*

The ordinary claim is that tests were written before code. The stronger and
verifiable one is that **the test catalogue was written before the code
existed**: `test-plan.md` §3 enumerates ~130 unit cases with inputs and expected
outcomes, derived from requirements during design. The loop therefore starts by
*transcribing a catalogue*, not by inventing cases — which means the cases
cannot have been shaped to fit an implementation that did not yet exist.

| | |
|---|---|
| Tests | **812**, across 52 test files |
| Executable spec | `test-plan.md` §3 — `UT-N`, `UT-A`, `UT-Q`, `UT-W`, `UT-G`, `CT` |
| Completeness gate | `test-plan.md` §12 — every *Must* requirement maps to a passing test |
| Coverage | 95% lines / 90% branches on `src/domain/**` only |

**No repository-wide coverage target, deliberately.** A global percentage
rewards testing plumbing and says nothing about whether the rules are correct.
The gate is the requirements matrix.

### Six guard tests CI refuses to lose

Coverage cannot express "this must never start passing". Six tests protect
stated correctness properties, and `quality.yml` greps for each **by name** so
they cannot be quietly deleted to make a suite green:

```
for id in UT-G03 UT-G04 UT-W05 UT-W12 UT-N08 CT-10; do
  grep -rq "$id" src/ || { echo "::error::guard test $id is not present"; exit 1; }
done
```

`UT-W12` (a meaning-preserving paraphrase of the warning must fail) and `CT-10`
(the extraction call site cannot reach application data) are the subtle two: if
either starts *passing* when it should fail, a boundary has been crossed
silently.

### Where the discipline was partial, and where it paid

Not every line was written test-first; some of the later UI work was
test-alongside. Rather than claim purity, here are three defects the tests
caught **before they shipped**, each of which would have been invisible in a
green run:

| Caught | What would have happened |
|---|---|
| An em dash in the `WWW-Authenticate` realm | A header value must be a ByteString, so it threw on construction — the gate would have answered **500 to every unauthenticated request** instead of 401 |
| A dropped `recordRegion` argument | The render script is invoked through a built string, so a missing argument arrives as `undefined` → crop the whole page → **the record read would see the label and every field would match itself** |
| A source-scanning test that stripped string literals | It desynced on an apostrophe and deleted half the file, leaving a test that passed *because there was nothing left to match* |

The third is the important one: it is a test that was **wrong while green**, and
it is in this list because that failure mode is invisible unless someone goes
looking.

---

## 2. Iterative delivery — scoped honestly

**What is true:** milestones M0–M12 with written exit criteria
(`implementation-plan.md`), working software deployed to staging on every merge,
and changes driven by *using* the deployment rather than by planning. Recent
examples, all from feedback on the running system:

- the batch worklist read as stalled when starting a second run — the old
  results stayed on screen while the new job was created;
- a fixture labelled "a real filing" implied the other twenty-six were not;
- a demo sample was showing the system at its weakest and was withdrawn.

**What is not true:** there were no sprints, no backlog grooming, no
retrospectives, no pairing, and no demo to a stakeholder. This was built solo
over days.

**And the gap that matters most: no compliance agent has ever used it.** The
personas are drawn from interview notes in the brief. Interview notes are not
observed use, and one hour with Dave would be worth more than another week of
building.

---

## 3. CI/CD

Four workflows. The parts worth noting are the ones that run *after* the deploy.

```
 push to main
     │
     ├─ quality.yml ── lint · typecheck · 812 tests · coverage · guard-test presence
     │
     └─ deploy-staging.yml
            ├─ migrate D1            (before the deploy, never after)
            ├─ push secrets          (before, or the version check waits for a dead version)
            ├─ deploy
            ├─ verify THE VERSION JUST DEPLOYED
            ├─ reconcile the policy archive from the reviewed file
            ├─ verify the archive matches what was reviewed
            ├─ verify inference reachable
            ├─ verify rasterisation reachable
            └─ verify stored verdicts still re-derive   ← replay, in CI
```

Three of these were paid for:

- **Verifying the deployed *version*, not just a 200.** Cloudflare serves the
  previous worker for seconds after upload, so a check that retries until it
  gets a healthy response can certify the version it was replacing. It did.
- **Replay in CI.** Every stored verdict is re-derived from its own record on
  every deploy. A change to a comparison rule that silently alters history fails
  the pipeline rather than being discovered in an audit.
- **Archive reconciliation.** The policy rows are derived from a reviewed file;
  CI proves they agree, so the rules being enforced are the ones somebody
  reviewed.

Husky runs the quality check pre-push, so the pipeline is a backstop rather than
the first place a failure appears.

---

## 4. Secure by design

The threat model is specific: the input is an untrusted document, one dependency
is a language model, and the output is evidence used in a regulatory decision.

| Control | Where | Threat |
|---|---|---|
| **Blind extraction** | `ExtractionRequest` has no field for expected values; `CT-10` asserts it structurally | A model shown what to find tends to find it. Every such error is a false *match* — a non-compliant label passing |
| **Injection is data, never instruction** | `L13` carries injected text beside a real mismatch; reporting `CLEAR` means it worked | Prompt injection reaching a verdict |
| **Guards run on bytes, before decoding** | `checkIntake` — magic number, page count, pixel budget, `%%EOF`, `/Encrypt` | A decompression bomb must be refused before it is rendered |
| **The label is read from pixels, never a text layer** | Rule 5; the text layer is used only for the record | A PDF text layer can disagree with what the page displays |
| **Logs carry identifiers, never content** | D20; `emit()` | Applicant content leaking into a log that cannot be redacted |
| **Whitelist, not sanitiser** | `sampleFileFor` refuses any id not on the curated list | An id that reaches an asset path is a path taken on trust |
| **Append-only audit** | SQL triggers; hash-chained events | Silent edit of a decision record |
| **Secrets never in config** | `wrangler secret put`; the Gemini key travels in a header, not a URL | A URL is captured by anything that logs one |

### What is *not* secure, stated plainly

- **No authentication** (D14). Names on decisions are declared, not verified.
- **The staging gate is not a login** (D49). One shared credential, protecting
  cost. It establishes that the caller was given a credential and nothing about
  who they are.
- **The record page we store contains applicant PII** — name, address, phone,
  email, signature. It is purged by the retention sweep; in the demo corpus it
  is synthetic.

A "secure by design" section that omitted those three would be the least
trustworthy page here.

---

## 5. Observability

Three layers, and one deliberate refusal.

| Layer | What it gives |
|---|---|
| **Structured events** | `emit()` — identifiers, classifications, timings. Never content (D20) |
| **Health probes** | `/health`, `/health/inference`, `/health/raster`, `/health/coordinator`, `/health/policy`, plus `/health/extract` and `/health/models` for diagnosing a reader — CI asserts on them rather than printing them |
| **Measurement** (D52) | Token counts per read and per model; stage timings per verdict; reported against the stated p95 target |
| **AI Gateway** | Per-request analytics from the vendor side, with payload logging **off** — the request body is a label image |

**The refusal:** nothing counts what a *person* did. Per-agent throughput is
deferred (D47) for three reasons that still stand — throughput is not
effectiveness; the costs of a wrong pass and a wrong flag are not symmetric, so
averaging them would recommend automating exactly the wrong work; and measuring
named employees is a labour-relations question before a technical one
(`Q-INT-07`). The data to build it exists. Withholding the measure is the
decision.

### An error message must say what was observed

*"Provider returned an empty response"* described a failed type check. The model
was reading the label perfectly. The wrong sentence cost three rounds of
debugging, and D38 came out of it: an error names what was observed, not what
was inferred. `ExtractionContractError` carries the raw response on a property
that never reaches a log, for exactly this.

---

## 6. What I would do differently

- **Get a real agent in front of it sooner.** Everything above is process; none
  of it substitutes for one hour of observed use.
- **Persist stage timings from the start.** They were computed on every
  verification and thrown away until D52, so the latency target went unmeasured
  for most of the build.
- **Capture token usage from the first provider call.** Same shape of mistake:
  the numbers were in every response and discarded, and the cost question stayed
  unanswerable longer than it needed to.
