# What is deterministic here, and what is not

*The claim this system makes about generative AI, stated precisely enough to
survive being argued with — and the demonstration that it holds.*

---

## 1. The claim people reach for is wrong

The tempting sentence is *"our AI produces deterministic results."* It is not
true and a reviewer will say so in one line: a language model asked to read the
same label twice can transcribe it differently, and no amount of temperature-zero
makes that a guarantee.

The claim worth making is narrower and much stronger:

> **Perception is non-deterministic. Judgement is deterministic. The boundary
> between them is recorded.**

The model reads. What it read is captured verbatim as evidence. Every conclusion
drawn from that reading is computed by code that takes no clock, no randomness
and no network — so the same reading and the same rules produce the same verdict,
today and in five years.

That is the difference between *"trust the model"* and *"here is what the model
said, and here is the arithmetic from there."*

---

## 2. Where the line sits

```
   ┌──────────────────────────────┐
   │  the label, the record       │   NON-DETERMINISTIC
   │            ↓                 │   the model may read this differently
   │  a model reads them          │   on a second attempt
   └──────────────┬───────────────┘
                  │
   ═══════════════╪═══════════════   ← the line, and it is WRITTEN DOWN
                  │                     raw response · model id · prompt
                  ▼                     version · sampling · digest
   ┌──────────────────────────────┐
   │  compare · tolerance         │   DETERMINISTIC
   │  warning verification        │   pure functions of (reading, rules)
   │  rule selection              │   no clock, no I/O, no model
   │  aggregation → outcome       │
   └──────────────┬───────────────┘
                  ▼
   ┌──────────────────────────────┐
   │  a person decides            │   HUMAN, and recorded as such
   └──────────────────────────────┘
```

**What is stored at the line** is what makes the rest reproducible: the raw
response exactly as the vendor returned it, the fully-qualified model id, the
prompt version, the sampling parameters, and a digest of the reading committed to
the audit chain.

**What is enforced below it**: `src/domain/**` imports no provider, no `fetch`
and no clock. That is not a convention — the coverage gate applies to that
directory and the modules there could not reach a network if they tried.

---

## 3. Two questions, and they are different

The Audit screen answers both, and conflating them is the commonest mistake in
talking about audit trails.

| Question | Answered by | What a failure means |
|---|---|---|
| **Has the history been altered?** | The hash chain. Each event is hashed with the digest of the event before it | A row was changed after the fact. The record is untrustworthy |
| **Does the recorded reading still produce the recorded verdict?** | Replay. The whole pipeline re-run from the model's stored output onwards — same contract, same rules, same aggregation | The rules moved, or the stored reading did. Both are serious and they are distinguished |

Neither implies the other. A perfectly intact chain can hold a verdict that no
longer re-derives, because the *rules* changed underneath it. A verdict that
re-derives perfectly proves nothing about whether the events around it were
edited.

### The statuses are kept apart on purpose

`identical` · `differs` · `record-altered` · `not-comparable` ·
`not-re-derivable`

Summing them would be easier and useless. Verdicts recorded before an input was
captured can *never* re-derive — if those counted as failures the number would
never reach zero, the gate would be permanently red, and a permanently red gate
is an ignored gate.

---

## 4. The demonstration

On **5 August 2026** six rules were enacted: `policySetVersion` 3 → 4, six
`policy.rule.superseded` events, fifteen rules in force where there had been
nine.

Twenty-five verdicts already existed, every one of them judged under version 3.
The deploy's own replay gate reported:

```
checked 25 · identical 25 · differs 0 · not-comparable 0 · not-re-derivable 0
```

**The rules changed and no past verdict moved.**

> **This is a dated event, not the current state of the deployment.** Staging
> was reset afterwards to clear an unrelated defect, so the verdicts above no
> longer exist and the Audit tab shows only what has been checked since. The
> evidence is the CI run for that deploy, which is where the numbers came from.
> Any future policy change re-demonstrates it, because the property is
> structural rather than a property of those particular rows.

That is not luck, and it is not because the change was small. It is the
bitemporal archive doing the one thing it exists for. Selection asks two
questions of every rule:

```sql
WHERE recorded_at    <= :asOf      -- what this deployment knew, then
  AND (effective_from IS NULL OR effective_from <= :validOn)   -- what governed
                                                               -- that filing
```

The six new rules are *valid* for those filings — 27 CFR 4.36 and 7.63–7.70 have
been law for decades, so their `effective_from` is unbounded. But they were
`recorded_at` on 5 August, and each of those verdicts was judged before that. The
transaction timeline makes them invisible to a judgement made earlier, without
anyone having to remember.

**Under a version-numbered policy the same change would have made every prior
verdict permanently incomparable** — the reason rule identity became a date range rather than a
version number.

---

## 5. What replay is, exactly — and the check it is not

**Replay re-runs the whole pipeline from the recorded reading onwards.** The
stored raw response is parsed through the same extraction contract, compared by
the same rules, checked against the same warning reference, and aggregated the
same way. Only one thing is substituted: the provider, which returns what the
model said at the time instead of asking it again.

So "no model is invoked" is true, and stating it as though it were the
achievement misleads. It is a **limit**:

| | Replay | Re-reading |
|---|---|---|
| Tests | The judgement | The perception |
| Substitutes | The provider, with the recorded response | Nothing — the model is asked again |
| Answers | *Do these rules still produce this verdict?* | *Does this model still read this label the same way?* |
| Cost | Nothing | One model call, on demand |
| Where | The Audit tab, across every verdict | A button on the verdict itself |

**Both are now available**, and the second is the one a reader intuitively
expects. `POST /audit/reread/<submissionId>` takes the submission as filed,
produces the two regions again, puts **both** back to the model at the recorded
prompt version, and compares field by field with the readings the verdict was
built on.

Three things it is careful about:

- **A difference is not a verdict on the verdict.** Perception is
  non-deterministic; two readings of the same pixels may legitimately differ.
  What a difference establishes is that the verdict rests on a reading the model
  does not reproduce — a fact for the person deciding, not a finding.
- **It says when the reader has changed.** If the deployment has been
  reconfigured or the prompt revised, the two readings come from different
  agents, and a difference then says the reader changed rather than that
  perception drifted. Reporting the comparison without that would attribute a
  configuration change to the model.
- **It reproduces the pixels the verdict was read from, not merely similar
  ones.** A bundled corpus item was read from rasters rendered at build time —
  the record page at 150 DPI — while re-rendering the PDF produces 300. Feeding
  the model a different image and calling the difference *drift* would report a
  false positive on all twenty-six. So it takes the same branch the item worker
  took: shipped rasters where they exist, a fresh rasterisation otherwise. An
  upload has no shipped raster and is genuinely re-rendered, normalisation
  included.
- **Retention ends it.** Once the submission has been purged the answer is
  `410` with the reason. Impossible by design rather than broken — and replay,
  which needs no pixels, still works.

**Why the record region can be re-read at all**, given that its crop is not
retained: the *filing* is. The label crop is kept for the results panel and the
record crop is not, but the PDF the whole verdict came from is in object storage
for the retention window, so both regions can be produced again from it.

It also detects the one thing `model_id` cannot: a vendor repointing a stable
name at new weights. §5 of `toward-llm-policy.md` makes stability a release gate
for any model that judges, and this is where it would be measured.

### What follows from that

**It does not prove the reading was correct.** If the model misread `45%` as
`40%`, replay reproduces that misreading faithfully and reports `identical`. The
verdict is reproducible; the perception behind it is not re-examined.

**It does not prove the rules are right.** It proves they were applied
consistently, and that the ones applied are the ones a named person approved.
Whether `27 CFR 5.65` was interpreted correctly is a matter for a compliance
expert, and the citation and digest are there so one can check.

**It does not prove who acted.** Names on decisions are declared, not
authenticated. The record is evidence of *what*, not of *who*.

---

## 6. Auditing a record, as an act

The checks above are **evidence**. An audit is a person examining them for one
determination and concluding something — and a conclusion nobody recorded is a
conversation rather than a finding. The Audit screen is built as that act:

1. **Records ready for audit** — the determinations a person actually decided. A
   verdict nobody acted on is an opinion; a verdict somebody approved affected an
   applicant, and that is what an auditor asks about.
2. **Run the checks** — history unaltered, verdict re-derived, and the recorded
   outcome shown **side by side** with the re-derived one. A status word is a
   conclusion; an auditor is entitled to the two things being compared.
3. **Optionally ask the model again** — a second, paid step, kept separate
   because it costs a call.
4. **Conclude** — *holds up* / *holds up, with something to explain* / *does not
   hold up*. Three, because a reservation and a failure send a reader to
   different places, and collapsing them teaches people to stop recording
   reservations.
5. **Recorded** against the verdict, with the auditor's name, the note, **and
   the evidence as it stood**. Stored rather than referenced: an audit is a
   statement about a moment, and re-running the checks a year later may
   legitimately answer differently — a purged artwork makes a re-read
   impossible. An audit that silently re-evaluated its own basis would be
   unreadable as history.

**The system never awards the result.** `audit.recorded` sits alongside
`decision.recorded` in the actions only a human agent may perform; a model
attempting one is refused by the same function that stops it deciding a
submission. A machine signing off on the soundness of its own record is
precisely what an audit exists to withhold.

The audit is itself appended to the hash-chained history it examined.

### What this signals for production

The prototype demonstrates the mechanism; it does not pretend to be an audit
regime. What a real one would need next, in the order it would be needed:

| | |
|---|---|
| **An authenticated auditor** | The name is declared, like every other name here. An audit trail whose auditor cannot be established is the same gap as a decision whose decider cannot |
| **Independence** | Nothing stops the person who decided a submission auditing it. Separation of duty exists for policy approval and not yet for this |
| **Sampling rather than selection** | An auditor choosing which records to examine measures the auditor. A production regime samples, and records what was sampled from |
| **A retention schedule that follows the determination** | Re-reading expires with the artwork. If re-reading is part of the audit, retention must outlive the decision rather than the job |
| **Findings that go somewhere** | A recorded `FAILED` currently informs nobody. It should open something |

---

## 7. Where to see it

| | |
|---|---|
| **Audit** tab | Chain integrity and replay across every verdict, live |
| `GET /audit/verify` | The chain, with its head digest |
| `GET /audit/replay?limit=100` | Re-derivation, by status |
| `GET /reference/<code>` | One verdict, from the code an agent quoted |
| CI, every deploy | The same replay runs as a deploy gate — a rule change that silently rewrites history fails the pipeline rather than surfacing in an audit |

The last row is the one worth noticing. This is not a report somebody runs when
asked; it runs on every deployment, and a regression in the comparison rules
shows up within seconds of the deploy that caused it.
