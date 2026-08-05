# The record — D1 schema and why it is shaped this way

*Twelve tables, four triggers, sixteen indexes, eleven migrations. The schema is
not storage for an application; **it is the audit record**, and almost every
column exists because a specific question would otherwise be unanswerable. This
document gives the intention behind each one — the design rationale a `CREATE
TABLE` cannot carry.*

*Live schema version: **11**, recorded in `schema_meta` and reported by `/health`.*

---

## 1. The shape

```
   job ──┬── submission ──┬── extraction   (one per region, two per submission)
         │                │
         │                └── verdict ──┬── field_verdict     (one per compared field)
         │                              ├── warning_verdict   (one per warning clause)
         │                              ├── policy_finding    (one per rule applied)
         │                              └── decision          (a person, afterwards)
         │
         └──────────────────────────────────────────────────────────────┐
                                                                        │
   policy_rule    bitemporal archive, append-only ───────────────────────┤
   audit_event    hash-chained, append-only ────────────────────────────┘
   schema_meta    what this deployment says about itself
```

Two tables sit outside the job hierarchy on purpose. `policy_rule` is the
**rules as they stood**, not as they stand; `audit_event` is **what happened**,
not what is true now. Both are histories, and a history that can be edited is a
claim rather than a record — hence the triggers in §6.

---

## 2. Intake — `job`, `submission`

| Column | Intention |
|---|---|
| `job.kind` | `'batch'` or `'single'`. Added in 0006 because a single review inserted its own job and the batch screen then showed *that* as the current job — an empty worklist replacing 26 results. A screen asking "the newest job" got the wrong answer; the fix was to make the question answerable |
| `submission.content_digest` | Identifies the bytes, not the file. Two identical filings under different names are one document |
| `submission.reference_code` | What an agent quotes back. Deliberately not the primary key: a UUID is unreadable over a phone, and a human-quotable code must not become an identifier other systems join on |
| `submission.content_key` | Where the staged PDF lives in R2, and **what the retention sweep keys off**. Left NULL by the single-review path for a while, which meant those uploads were never collected — a retention policy the deployment stated and did not apply |
| `submission.content_purged_at` | The deletion is recorded, not merely performed. A results screen can then say *"the artwork was deleted on this date under the retention policy"* rather than failing to load an image and looking broken |
| `submission.attempt_count` | Retries are visible. An item that succeeded on the fourth attempt is not the same evidence as one that succeeded immediately |

**No applicant identifier**, and that is a known gap (`Q-INT-06`). Three
identifiers exist and none is the agency's: our UUID, our reference code, and a
digest of the bytes. An auditor or an applicant would quote a TTB ID, and nothing
here holds one.

---

## 3. Perception — `extraction`

One row per region, so two per submission. **This is the boundary between what a
model produced and what the system concluded**, and it is the reason a verdict
can be re-derived at all.

| Column | Intention |
|---|---|
| `region` | `'label'` or `'record'`. Two blind reads, never one over the whole page |
| `method` | CHECK-constrained to `'vision'` or `'text-layer'`. The label is **always** pixels: a PDF text layer can disagree with what the page displays, and compliance concerns what a consumer sees |
| `raw_response` | Retained **verbatim**. Simultaneously the provenance record and the test fixture — the same artefact serves both, which is why a replay needs no model |
| `model_id` | Fully qualified, never a floating alias. "gemini" would name two different readers identically and call the difference a trend |
| `prompt_version`, `sampling` | A model is not a stable agent: version, prompt and sampling all move, and each changes what it produces. Identifying the reader means identifying the whole tuple |
| `raster_dpi` | An `UNREADABLE` may be an artefact of the resolution *this system chose*, not of the artwork. Without it the finding is unattributable |
| `latency_ms` | Present since 0001 |
| `prompt_tokens`, `completion_tokens`, `total_tokens` | Added in 0011. **Nullable, and NULL means *not reported*** — a zero would claim a read was free, and a column of invented zeroes sums to something that looks like a measurement |

---

## 4. Judgement — `verdict` and its children

`verdict` is wide because a verdict is only defensible if everything it depended
on is pinned to it.

### The version set — what it was judged by

`ruleset_version` · `reference_data_version` · `policy_version` ·
`aggregation_version` · `policy_set_version`

Without these a verdict is not re-derivable and NFR-13 fails. They answer *which
code and which data* produced this.

### The bitemporal binding — added in 0008

| Column | Question it answers |
|---|---|
| `submitted_on` | When was this filed? |
| `valid_on` | Which day's rules govern it? |
| `as_of` | What did this deployment know when it judged? |
| `selected_rule_ids` | Which rules were actually applied |
| `selection_inputs` | **What selection ran on** |

`selection_inputs` is the subtle one and it was a real bug. Rebuilding the
application from `field_verdict` alone loses `productType` — it is not one of
`FIELDS`, so no field row carries it — and every replay then selected no rules
and re-derived `CLEAR_CONFIRM_POLICY`. **The verdict binds the selection inputs, not just the
policy version — for exactly this reason.**

### `warning_legible` — added in 0002

Stored because the verdict depends on it and it **cannot be recomputed**: the
measurement is taken from pixels that are transient. A replay reading only the
record would default to legible and reach a different verdict than the one it is
supposed to reproduce. Verdicts predating this column report themselves
`not-re-derivable` rather than quietly passing.

### `supersedes` / `superseded_by`

A correction supersedes rather than overwrites (UC-3). The original verdict and
what replaced it are both part of the history.

### `extract_ms`, `compare_ms`, `total_ms` — added in 0011

Computed on every verification since M1 and persisted nowhere, so §16's stated
p95 target went unmeasured. They cover the **domain's** stages only —
rasterisation and queue wait are outside them — so what they report is a floor on
what an agent experiences, and the Measurement screen says so rather than
labelling itself "total".

### `field_verdict`, `warning_verdict`

`expected` and `observed` are stored **side by side**, per field. That is FR-10
in the schema: an agent adjudicates against two values, and a verdict that
recorded only its conclusion would make them reopen the artwork.

`warning_verdict` is per **clause**, not per statement. `UT-W07` — one word
altered — must localise to `clause_1`, and a boolean over the whole warning
could not.

### `policy_finding` — the snapshot

| Column | Intention |
|---|---|
| `requirement`, `citation`, `quote`, `check_params`, `approved_by` | **The rule as applied, copied at the time.** Resolving these live against today's archive means a dropped rule yields nothing and a moved regulation yields the wrong section. Evidence that depends on a live lookup is not evidence, and the lookup fails precisely when it matters |
| `regulation_digest`, `regulation_issued` | Added in 0010. Pins the source text exactly. A digest cannot be paraphrased the way a copied fragment can |
| `policy_row_id` | Which archive row, so the finding joins back to the rule's own history |

---

## 5. The human — `decision`

| Column | Intention |
|---|---|
| `decided_by` | A name. **Declared, not authenticated** — this deployment has no accounts, so the record is evidence of *what*, never of *who* |
| `recommended_outcome` | What the system suggested, stored **beside** what the person chose |
| `decision` | `APPROVED` / `REJECTED` / `RETURNED`. Returning for better artwork is distinct from rejecting: it is not a finding against the applicant |

Storing the recommendation next to the decision is what makes **agreement**
measurable — the only ground truth this system will ever have about its own
usefulness. It is also the input a future model-based engine would be evaluated
against (see `toward-llm-policy.md`).

---

## 6. The two histories, and the triggers that defend them

### `audit_event` — hash-chained

| Column | Intention |
|---|---|
| `seq` | Order, monotonic |
| `prev_digest`, `digest` | Each event commits to the one before it. Change a row and nothing after it reproduces its own digest |
| `detail` | Identifiers, classifications, versions — **never content**. A history that cannot be redacted must never carry anything requiring redaction |
| `actor_kind`, `actor_id` | Added in 0009. `human` / `model` / `system`, with a qualified identity |

`actor_kind` and `actor_id` are **deliberately outside the digest**. The chain
protects what was recorded when it was recorded; adding fields to an existing
event's hash input would have invalidated every prior link.

### `policy_rule` — bitemporal, append-only

Two timelines, and one cannot substitute for the other:

| | Answers |
|---|---|
| `effective_from` / `effective_to` | Which **filing dates** this rule governs |
| `recorded_at` / `retired_at` | When **this deployment** held it |

One timeline cannot distinguish *the law changed* from *we were wrong about the
law*, and an audit asks both. Dating a correction from today asserts the wrong
rule legitimately governed earlier filings; backdating it asserts verdicts used a
rule they never saw. Neither is true.

`body` holds the whole rule as JSON and `body_digest` fingerprints it, so a
reconciliation can tell a changed rule from an unchanged one without comparing
fields — and an edited comment does not supersede a rule, because `$`-prefixed
annotations are excluded from the digest.

### The four triggers

```
audit_event_no_update   audit_event_no_delete
policy_rule_no_delete   policy_rule_close_only
```

`RAISE(ABORT, 'audit_event is append-only')`. Not a convention, not a code path
somebody must remember — the database refuses. `policy_rule_close_only` permits
exactly one mutation: closing a window. A rule is superseded or retired, never
edited, or the verdicts citing it lose the thing they were judged by.

**Re-provisioning an environment drops these tables and rebuilds them, which is a
different act from editing rows inside one** (`scripts/reset-staging.sh` says so
at length). An operator with credentials can always destroy an environment; what
the triggers guarantee is that nothing quietly alters a record within one.

---

## 7. `schema_meta` — what the deployment says about itself

`schema_version` and `retention_policy`. `/health` reports the stated policy
alongside the window the sweep actually enforces, **and a mismatch fails the
deploy gate**: a retention promise that has drifted from the deletion schedule is
a false statement about somebody's data.

---

## 8. Indexes, and what each one is for

Sixteen, and every one serves a query the system actually makes:

| Index | Query |
|---|---|
| `submission_by_reference` | An agent quotes a code |
| `submission_by_digest` | Have we seen these bytes before? |
| `extraction_by_model` | Which reader produced this — the basis of B-Q4 |
| `verdict_by_outcome` | Worklist triage |
| `decision_by_agreement` | Did the person agree with the recommendation? |
| `policy_rule_current` | The bitemporal selection in `ruleSetAsAt` |
| `audit_by_subject`, `audit_by_actor`, `audit_by_time` | The three ways a history is read: about a thing, by an agent, in a window |

---

## 9. What the schema deliberately does not hold

| | Why |
|---|---|
| Label artwork or extracted values in logs | Content lives in R2 and in `extraction`, both purgeable; logs are not |
| An applicant identifier | Not available (`Q-INT-06`). Inventing one would create a false join |
| Per-agent productivity counters | The data to compute them exists; withholding the measure is the decision |
| User accounts | A `users` table would imply an authentication this prototype does not perform |

---

## 10. Does the schema actually support an audit?

*Tested rather than asserted. Re-reading a verdict (`POST /audit/reread`) tries
to reconstitute the conditions of the original run from the record alone, and
reports each one as restored or not. It is a probe for schema completeness, and
it found two gaps.*

| Condition | Recorded as | Restorable? |
|---|---|---|
| Which model read it | `extraction.provider`, `extraction.model_id` | **Yes** — the provider is rebuilt for the recorded model, if a credential for that vendor is still configured |
| Which regulations applied | `verdict.valid_on`, `as_of`, the bitemporal archive | **Yes** — `ruleSetAsAt` rebuilds the rule set as it stood |
| What selection ran on | `verdict.selection_inputs` | **Yes** |
| At what resolution | `extraction.raster_dpi` | **Yes** |
| Whether the warning was legible | `verdict.warning_legible` | **Yes** — stored because it cannot be recomputed |
| **Which instruction was used** | `extraction.prompt_version` | **No** — the version *identifies* the prompt; it does not *contain* it |
| **With what parameters** | `extraction.sampling` | **Stored, not applicable** — each adapter uses a compiled-in constant and nothing accepts them back |

### The two gaps, and what they cost

**A superseded prompt cannot be rebuilt.** `label-extract@2` names an
instruction that exists only in the deployed source. Re-reading a verdict
produced under `@1` compares two different questions, and the endpoint says so
rather than presenting the comparison as a stability measurement. Closing it
means storing the prompt *text* — or its digest against a versioned store —
not just the label.

**Sampling parameters are recorded and cannot be re-applied.** Smaller: the
adapters set temperature to zero in both cases, so the practical divergence is
nil. But "recorded" and "reproducible" are different claims and the record
currently supports only the first.

**Neither gap affects replay**, which needs no model at all. They affect the
stronger claim — *put the same filing to the same reader under the same
conditions and see what comes back* — and that is precisely why the exercise was
worth running against the schema rather than reasoning about it.

---

## 11. Migration history

| | |
|---|---|
| 0001 | Core record, audit chain, append-only triggers |
| 0002 | `warning_legible` — a verdict input that cannot be recomputed |
| 0003 | `reference_code` — something an agent can quote |
| 0004 | Retention policy, stated in the record |
| 0005 | The policy layer; rebuilt `verdict` for a CHECK constraint (**the rebuild order is load-bearing**) |
| 0006 | `job.kind` — single review displacing the batch worklist |
| 0007 | The bitemporal policy archive |
| 0008 | Verdicts bind both dates and their selection inputs |
| 0009 | Agent kind and identity |
| 0010 | Regulation digest and issue date on each finding |
| 0011 | Token counts and stage timings |

Every migration after 0001 exists because a question turned out to be
unanswerable. That is the honest summary of this schema: it grew where the record
was found to be thinner than the claims being made about it.
