# Toward a model that judges

*Today a model only perceives. This is what it would take to let one reason
about compliance, in what order, and what would have to be true before one is
permitted to decide anything.*

*It is written as a plan with stop conditions rather than a roadmap, because the
interesting question is not how to get there but **what result should stop us**.*

---

## 1. The idea this is built on

**The deterministic engine is the test oracle for a model-based one.**

Every submission this system has ever processed carries a rule-derived finding
per applicable rule, with the reasoning, the evidence, and the regulation it
rests on. That is a labelled corpus accruing at zero marginal cost, and it means
a model-based policy engine can be evaluated on real traffic before it touches a
single verdict.

**And the limitation of that oracle is the whole tension**, so it goes here
rather than in a footnote:

> The rules can certify the model exactly where the rules are complete — and
> those are precisely the cases where a model adds least. The value is in the
> gap, and in the gap the oracle is silent.

`L18` is the corpus case that says so: `Ky. Straight Bourbon` against
`Kentucky Straight Bourbon Whiskey`. The rules report a discrepancy. A competent
reviewer would not. The rule engine cannot grade a model on that case, because
on that case the rule engine is the one that is wrong.

So agreement with the rules measures **safety**, not **value**. Value needs human
adjudication, and §4 says how to get it without an annotation project.

---

## 2. Four stages, and the line that must not move quietly

```
  0  READS ONLY               the model perceives; rules decide          ← today
  1  RECALL                   the model retrieves regulation text for a human
  2  SHADOW                   the model proposes findings; rules still decide
  3  GATED AUTONOMY           the model decides in proven categories only
  ─────────────────────────────────────────────────────────────────────
  4  UNSUPERVISED JUDGEMENT   not proposed. See §7
```

### Stage 1 — Recall. The honest first move, and it is not a decision at all

The gap the README already names: a finding pins its regulation by digest, so
the *words* are not in the record. Producing the passage a rule rests on — with
the provisions that qualify it — is retrieval and comprehension, which is what
these models are good at and what this system has refused to use one for.

- It is **downstream of the verdict**. Nothing it produces can change an outcome.
- A human reads the output, and a wrong passage is visible as a wrong passage.
- It makes the six enacted rules reviewable rather than merely traceable, which
  is what §18.5a says an approval needs to be worth anything.

**Risk to verdicts: none.** That is why it is first.

### Stage 2 — Shadow. Where the oracle earns its keep

The model receives the same reading the rules receive and proposes findings. The
rule engine's findings are the ones that reach the verdict. Both are recorded;
divergence is the product.

Divergence has two directions and they are not symmetric:

| Direction | Meaning | What to do |
|---|---|---|
| Model **flags**, rules **pass** | Either a false flag, or the model saw something the rules cannot express (`L18`) | Human adjudicates. The interesting queue |
| Model **passes**, rules **flag** | Candidate false pass — the dangerous direction | Human adjudicates. Every one, not a sample |

**Shadow mode is a two-way audit.** It measures the model against the rules and
surfaces the rules' blind spots at the same time, and the second is arguably
worth more: a divergence the human resolves in the model's favour is a rule that
needs rewriting, and that improves the deterministic engine whether or not the
model ever ships.

Nothing about this stage requires a new decision boundary. The model is an agent
of kind `model`, and `checkAgentMay` already refuses it `decision.recorded`.

### Stage 3 — Gated autonomy, by category

The model decides *only* where it has demonstrated it can, and the gate is
per-finding-category rather than global:

- **Never** for a `blocking` severity finding.
- **Never** for `UNREADABLE` — that is a perception judgement, and the whole
  design routes uncertainty to a person.
- **Only** where the measured false-pass rate clears §5 for that category.
- With continuous sampling: a fixed fraction still goes to a human, forever, or
  the measurement stops the day it is most needed.

---

## 2a. Every stage here goes on the asynchronous side

A constraint on all of the above, and the reason it can be built at all without
making the product worse.

Each stage adds work per submission: retrieval is a call, shadow mode is a
second opinion, a critic is a third. **None of it may land on the path where a
person is waiting.** The system checks filings as they arrive, so the pipeline
can grow while what an agent experiences stays the time to load a prepared
result.

Where a stage genuinely must be synchronous — an agent asking, right now, why a
rule fired — it is bounded and stated, and it is a request the agent chose to
make rather than a cost imposed on every review.

The failure this avoids has a precedent in this project's own brief: the vendor
pilot was abandoned because agents waited. A system that gets more thorough and
slower with each release fails the same way, however good its findings are.

---

## 3. What would have to change in the code — and the friction is deliberate

Promoting a model to decide is **not a configuration change**:

```ts
export function mayDecide(agent: Agent): boolean {
  return agent.kind === 'human'
}
export const DECIDING_ACTIONS = ['decision.recorded', 'policy.rule.enacted']
```

That function is the boundary. Letting a model past it means editing code, under
review, in a commit somebody signs — not flipping a flag. **That is the correct
amount of friction for the act of letting a machine decide**, and it is why the rule
was built as an invariant rather than a setting.

`policy.rule.enacted` should stay human-only regardless of how good the model
becomes. A model proposing a rule and a model enacting it are different acts, and
the second has no plausible safety story.

---

## 4. Training, and why fine-tuning is probably not the first move

**Most of the gap is context, not weights.** Before touching a training run:

1. **Retrieval over the CFR.** The model currently reasons about a regulation it
   was never shown. Stage 1 builds that pipeline anyway.
2. **Prompt and decomposition.** One finding per call, with the rule text and the
   observed value, is a different task from "assess this label".
3. **Only then**, if failures are *consistent* rather than random, is a fine-tune
   justified — random failures mean the task is under-specified, and training on
   an under-specified task teaches the noise.

### Where the labelled data comes from — no annotation project

| Source | Already accruing |
|---|---|
| Rule-derived findings | Every submission, every applicable rule |
| **Human decisions against recommendations** | `decision.recommended_outcome` beside `decision.decision` — agreement is already measurable |
| Adjudicated divergences | Stage 2's output, which is exactly the hard cases |
| Authored ground truth | The 26-item corpus, including the adversarial ones |

The third row is the valuable one and it is the only one that costs anything: a
human resolving a disagreement between two engines is producing a labelled hard
case, which is the sample that improves a model and the sample you cannot buy.

### Two rules for any training run

**A fine-tune creates a new agent.** `provider:model:promptVersion` is the
identity, so a tuned model is a different reader and every prior verdict
correctly cites the old one. The archive already handles this; nothing needs
inventing.

**The evaluation set is held out and includes the adversarial cases.** `L13`
carries injected instruction text beside a real mismatch; `L11` affixes an
invoice bearing plausible numbers. A model tuned to agree with the rule engine
will learn the easy cases first, and those two are where a regression would hide.

---

## 4a. The perception gap is instrumentation, not model quality

§4 argues most of the *reasoning* gap is context rather than weights. The same
holds one layer down, and the §16.22 formatting checks (D53) are the worked
example: five things the system could not establish, which looked like a case
for a stronger vision model and mostly were not.

**Pixels have no units.** A model asked whether the warning statement is at
least 2 mm is being asked to do metrology by eye. A larger model does it more
confidently and no more correctly, because the information is absent from its
input — the millimetre lives in the PDF's coordinate space, not in the image.
That is the shape of most perception gaps here: not "the model cannot tell",
but "nobody gave it the scale".

So the levers, cheapest and most reliable first:

| Lever | What it is | Where it applies |
|---|---|---|
| **1. Deterministic instrumentation** | No model at all. Raster scale from PDF points, luminance sampling for contrast, counting characters per inch | Type size, characters per inch, contrast ratio |
| **2. A skill the reader may call** | The model does not need to be better — it needs to **return geometry**. A bounding box for the warning block, per-line boxes, then arithmetic outside the model | Anything needing *where* and *how big* |
| **3. A stronger vision model** | Genuinely better perception | **Bold only.** Relative stroke weight is perception, not measurement, and no instrument supplies it |

The ordering matters because it is the reverse of the instinct. The expensive,
least certain lever was the first one reached for, and it is the right answer to
exactly one of the five.

### What a "skill" means here, concretely

The `ExtractionProvider` seam already abstracts vendors. A skill is a tool the
reader may invoke whose **output is recorded as an observation like any other** —
which keeps it inside the governing principle: the model reads, the rules
compare. A geometry skill returns a box; the rules turn the box into millimetres
and compare it against §16.22(b). The model never learns what the threshold is,
so D4 survives.

Two obligations come with it, and skipping either would undo the record:

- **A tool is a reader, so it is fingerprinted like one.** D29 requires fully
  qualified model identifiers because a floating alias silently changes what
  produced a verdict. A tool version changes it identically. `provider:model:
  promptVersion` becomes `provider:model:promptVersion:toolset`, or the archive
  claims reproducibility it no longer has.
- **A tool's output is evidence and must be as inspectable as a reading.** A
  bounding box that is quietly wrong produces a confident millimetre figure that
  is wrong in a way nothing catches — worse than the model declining, because it
  arrives with the authority of arithmetic.

### Two limits, and only one of them is permanent

**What today's model cannot do is not a property of models.** Everything above
describes one prototype reader — a single vision model, one prompt version, no
tools. Stroke weight and spatial geometry are things a *different* model may
well do well, and nothing here has measured whether one does. `B-Q4` already
records that five vision models are available and that which reads best is a
measurement not yet made; this section adds what to measure them on.

So read the preceding tables as a **requirements list and a baseline**, not a
verdict on the technology:

| Capability required | Baseline today | Graded against |
|---|---|---|
| Report relative stroke weight (bold vs not) | Not attempted | Corpus item 8 — warning body set in bold, authored ground truth |
| Return a bounding box for the warning block | Not attempted | Measured mm vs the label as authored |
| Return per-line boxes and character counts | Not attempted | §16.22(a)(4) — 40 / 25 / 12 cpi |

Each row is a candidate model's entrance exam. A model that clears them moves
work off the checklist; one that does not is why the checklist exists. That is a
measurement anyone can re-run, not a judgement about model quality.

**What no model changes** is a different kind of limit, and it is worth keeping
separate so a future capability is not mistaken for closing it:

- **No threshold exists.** §16.22(a)(1) requires "readily legible" on a
  "contrasting background" and names no number. A contrast ratio is computable
  to three decimal places and still cannot say whether the regulation is met.
  Precision is not authority, and a figure judged against an invented bar is the
  failure this design refuses.
- **It is not in the artwork.** §16.22(c) firmly-affixed is a property of the
  physical article. No reader, however good, can see it.

And per D53 the *determination* stays with a person on all of them regardless,
because TTB states it does not routinely review them either. A better model
changes what evidence the agent is handed — not who decides.

---

## 5. Metrics that would justify release — and accuracy is not one

A single accuracy number is the wrong instrument, because the two errors differ
by orders of magnitude in cost:

| | Cost | Gate |
|---|---|---|
| **False pass** — non-compliant label reported clear | A non-compliant product reaches market | **Upper confidence bound on the rate, per category, on a stratified sample.** Not the point estimate — the bound |
| **False flag** — compliant label reported as a discrepancy | Five minutes and a unit of trust. Dave abandons tools that waste his time | A budget, not a bar. Traded against value |

### And three more that a headline accuracy figure hides

**Calibration.** Of the cases it declined to judge, what fraction would have been
errors? A model that abstains on exactly the cases it would have got wrong is far
more useful than a more accurate model that abstains at random.

**Stability.** Same input, N runs, measured variance. Perception is
non-deterministic (`determinism-and-replay.md`) and a *judging* model inherits
that. The variance must be measured and bounded, not assumed away by setting
temperature to zero.

**Drift.** A vendor repointing a stable name changes the reader without changing
its name. The per-job fingerprint and the recorded served version already detect
this; a deciding model would need that check as a release gate rather than a
diagnostic.

### The stop condition

Stated in advance, because a metric without one is a formality:

> **A single confirmed false pass on a blocking finding halts the rollout** and
> returns that category to the rules, pending an explanation of *why* — not a
> retrain, an explanation. A rate is a property of a distribution; the first
> confirmed instance is evidence that the distribution was misjudged.

---

## 6. Multi-agent, and what already supports it

The concept exists and is enforced. What a multi-agent service needs:

| Needed | Status |
|---|---|
| A stable identity per agent | **Built** — `Agent{kind, id, display}`, fully qualified |
| Attribution of every act | **Built** — `audit_event.actor_kind` / `actor_id` |
| Entitlements per agent | **Partial** — `mayDecide` and `DECIDING_ACTIONS` are the control surface, but entitlements are code, and human roles are data. A fleet needs them as data |
| Multiple readers behind one contract | **Built** — two vendors already sit behind `ExtractionProvider` |
| Inter-agent provenance | **Missing** — the record says an agent acted; it does not say *which agent's output fed which*. A retrieval agent feeding a judging agent needs that edge, or a wrong passage becomes an unattributable wrong finding |
| Per-agent measurement | **Deliberately withheld** for people. For models it is measurement, not surveillance, and the split is already in the schema |

Plausible fleet, all of kind `model`, none permitted to decide:

```
   reader  ─────▶  the label and the record            (built)
   recall  ─────▶  the regulation a finding rests on   (stage 1)
   proposer ────▶  candidate findings                  (stage 2, shadow)
   critic  ─────▶  tries to refute the proposer        (would need §6's missing edge)
                          │
                          ▼
              the rules compare · a human decides
```

**The critic is the one worth building early.** An adversarial agent whose only
job is to refute a proposed finding costs one more call and turns a single
opinion into a disagreement a human can arbitrate — which is the shape this whole
system already takes.

---

## 6a. The audit regime is the other half

Everything above is about letting a model do more. The counterweight is what
checks it, and the prototype now demonstrates the mechanism: a person examines
one determination against re-derived and re-read evidence, concludes, and the
conclusion is recorded in the history it examined.

**That mechanism is what a model-based engine would be released into.** Shadow
mode produces divergences; somebody has to adjudicate them, and an adjudication
nobody recorded is not evidence. The same table applies — an authenticated
auditor, independence from the decider, sampling rather than selection — and
each becomes more load-bearing, not less, once a model's output is what is being
audited.

---

## 7. Why stage 4 is not proposed

Unsupervised model judgement on a regulatory decision is not a technical
milestone this document is withholding for later. It is a governance question
with a different owner, and three things would have to be true first that no
metric establishes: that an agency is willing to defend a machine-made
determination to an applicant, that a records schedule treats it as a federal
record, and that somebody is accountable for it by name.

The prototype's position is that **the human decides** — and every stage above is
built so that remains true while the model gets progressively more useful.
