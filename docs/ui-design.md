# User Interface Design

*Companion to `design.md` §5. Realises the interaction principles in §5.3.
Section references are to that document unless stated.*

| Field | Value |
|---|---|
| Status | Draft |
| Last updated | 2026-07-31 |
| Primary persona | Compliance Agent (§2.1) |
| Benchmark | "Sarah's mother", 73 — a test criterion, not a user (§2.2) |

---

## 1. The Bar

Sarah set a specific and unusually clear standard: *"something my mother could
figure out — she's 73 and just learned to video call her grandkids."* Half the
team is over 50. Dave prints his emails.

That is more demanding than "clean". It rules out things that are ordinary in
modern web applications: progressive disclosure, icon-only controls,
hover-revealed actions, multi-step wizards, and anything requiring a user to know
that a region is scrollable, clickable, or draggable.

**The test is NF-U** (test-plan §9.3): one untrained person completes a review
without asking a question. Not "finds it attractive". Completes it.

---

## 2. Personas and Surfaces

### 2.1 The Compliance Agent — the only persona the prototype serves

Every named user in the source material performs the same task: compare an
application against label artwork and act on the difference. They are one
persona, **the Compliance Agent**, with traits drawn from each individual.

| Trait | From | Design consequence |
|---|---|---|
| Sceptical of modernisation; will abandon a tool that wastes time | Dave, 28 yrs (SRC-4) | Verdicts must show evidence and name the rule applied (FR-10). A false mismatch costs more trust than a missed match |
| Expects tolerant judgment — `STONE'S THROW` is `Stone's Throw` | Dave (SRC-4) | Tolerance is exercised *and visibly reported* (§6.3) |
| Works from a printed checklist; wants exactness on the warning | Jenny, 8 mths (SRC-5) | Results follow checklist order; warning failures are specific and printable (§7) |
| Handles bulk importer filings, 200–300 at once | Janet, Seattle (SRC-2) | Batch mode (§9) — same results component, different entry |
| Mixed technical confidence; half the team over 50 | Sarah (SRC-2) | Large type, high contrast, one obvious action (§11) |
| Under time pressure; five-second threshold | Sarah (SRC-2) | The wait is explained and bounded (§4.6) |

**Consolidating them is deliberate.** These are not five interfaces. They are one
task at five tolerance points, and treating them separately would produce variants
where the correct answer is a single screen satisfying the strictest constraint on
each axis.

**What consolidation must not lose** is the tension between the traits. Dave's
demand for visible reasoning and Sarah's demand for an uncluttered screen pull
against each other. §6.3 resolves that explicitly rather than averaging it away.

Sarah is included as a source of requirements, not as a daily operator. Her
interests that are *not* interface requirements — throughput, adoption, backlog —
appear in §2.3 under the sponsor role.

### 2.2 The benchmark is not a persona

**"Sarah's mother" will never use this system.** She is the calibration point for
NF-U and a proxy for the least confident real agent.

The distinction has practical consequences. Designing *for* her would produce a
tool that patronises Dave — oversimplified, slow to operate, thin on the evidence
a 28-year veteran needs. Designing *to pass her test* is what Sarah actually
asked for: a primary path obvious enough that low confidence is not a barrier,
with the depth Dave requires still present.

She is a criterion. She is not in §2.1.

### 2.3 Roles requiring a surface — not built

*Each is implied by a design decision, and none is in prototype scope. Recorded
so the omission is scoped rather than overlooked.*

| Role | Requirement | Implied by | Why not built |
|---|---|---|---|
| **Policy owner / approver** | Review drafted rules; approve, activate, supersede; see the source document and citation beside each proposal; identity recorded against every approval | D18, D27, §8.6.3 | Requires a policy store and an approval workflow. Configuration is the store at prototype scale (§8.8.8) |
| **Auditor / compliance reviewer** | Retrieve a past decision by reference code; read its provenance; replay the verdict without re-invoking the model | §8.7, NFR-13 | Requires persistence, which N3 forbids. The record exists and travels with the result, but there is nothing to retrieve it *from* |
| **Operator** | Latency and error rate against the 5s budget; verdict distribution sliced by model version; version-change annotations | §9.4.4, §9.4.6 | Host-provided log view only in the prototype (§9.4.7) |
| **Programme sponsor** | Throughput, adoption rate, effect on backlog | Sarah's own interest (SRC-2) | Requires longitudinal data the prototype does not retain |

**The policy approver is the notable gap.** D27 states that no rule reaches
`IN FORCE` without named human approval — which *requires an interface to approve
in*. The governance model has a UI dependency that §5.1 of the design document
does not acknowledge. It belongs in §15 of that document.

---

## 3. Information Architecture

**One screen. No navigation. No settings.**

```
   ┌──────────────────────────────────────────────┐
   │   Single review          ⟷      Batch        │
   │   (default)                    (secondary)   │
   └──────────────────────────────────────────────┘
```

Two modes, one visible switch. No menu, no account, no history, no preferences —
partly because N2 and N3 mean there is nothing to put in them, and partly because
every additional destination is somewhere a low-confidence user can get lost.

**Rejected: a wizard.** Splitting "enter the application data" and "upload the
label" into steps adds state, a back button, and a way to be halfway through.
Everything needed for one review fits on one screen at legible size.

---

## 4. Single Review — Specification

### 4.1 Regions

> **Revised.** This screen used to hold two panels: five typed application
> fields beside a label upload. It now takes one file — the filed
> TTB F 5100.31 as a PDF, the same input the batch takes. The panels below the
> diagram record what changed and why.

```
┌────────────────────────────────────────────────────────────────────────┐
│  A  TTB Label Check                          Single │ Batch │ Policy   │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  ┌── B ───────────────────────────────────────────────────────────┐    │
│  │  The filed application                                          │    │
│  │                                                                 │    │
│  │  The completed TTB F 5100.31 as a PDF — the label artwork and    │    │
│  │  the application record, exactly as filed. Both pages are read   │    │
│  │  separately: neither reading is shown the other.                 │    │
│  │                                                                 │    │
│  │   ┌───────────────────────────────────────────────────────┐     │    │
│  │   │        Drop the filed application here                │     │    │
│  │   │             ┌──────────────────┐                      │     │    │
│  │   │             │  Choose a file   │                      │     │    │
│  │   │             └──────────────────┘                      │     │    │
│  │   │             PDF, up to 10 MB                          │     │    │
│  │   └───────────────────────────────────────────────────────┘     │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                        │
│   ┌── C ────────────────────────┐  ┌── D ──────────────┐               │
│   │   Check this submission     │  │  Clear this form  │               │
│   └─────────────────────────────┘  └───────────────────┘               │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

| Region | Contains | Notes |
|---|---|---|
| A | Product name, mode switch | No other chrome. No logo lockup, no user menu |
| B | The filed submission | One upload. No typed fields |
| C | Primary action | Always visible without scrolling at 1280×800 and above |
| D | Clear | Secondary, and deliberately smaller |

**Why the typed panel is gone.** The agent was copying five values off the form
in front of them into five boxes. That is a transcription step, and it was never
part of the job — the filed PDF already states every one of them. Each typed
value was also a value that could be mistyped, and a mistyped expectation
produces a discrepancy against a compliant label with nothing on screen able to
explain it. The system now reads what was filed.

**And it makes the two paths one path.** A submission checked alone and the same
submission checked inside a batch of three hundred now go through the same
intake guards, the same rasteriser, the same region map and the same two blind
reads — because they call the same function (`rasteriseSubmission`), not because
two functions happen to agree today.

### 4.2 What is read, and from where

| Region of the PDF | Read for | Never read for |
|---|---|---|
| Label artwork (page 1, affix box) | Brand name, class/type, alcohol content, net contents, the health warning | Product type |
| Application record | The same four fields, and **item 5, type of product** | The health warning |

**Where the record is depends on what was filed** (D50). Two shapes, told apart
by page count:

| Filed as | Record region | Consequence |
|---|---|---|
| Form page + a COLAs Online record page (the corpus) | The record page, whole | All four fields have a source |
| The form on its own (what ttb.gov publishes) | Page 1 **above** the affix box | Item 5 and item 6 have a source; class/type, alcohol content and net contents do not, and report `NOT_SUPPLIED` |

The second map's crop stops 8pt clear of the affix box, and that clearance is
the D4 boundary rather than tidiness: a record crop reaching into the artwork
would take the *application* reading off the very label it is about to be
compared against, and every field would then match itself.

**Two reads, and neither is shown the other** (D4, CT-10). No expected value
exists until both have answered, so there is nothing for either reading to
anchor to. This is the property that makes a *match* mean something: a model
shown what it is meant to find tends to find it, and every such error is a
non-compliant label passing review.

**Item 5 is asked of the record and never of the label** (D25). No label states
"Distilled spirits". Asking the artwork would let the bottle choose the body of
regulation it is judged by.

**Product type is classified, not transcribed.** Three known options — the
boxes the form itself offers — and the read fails closed at every step: exactly
one stated and recognised, or nothing. None, several, illegible, or a word not
on the form all produce *no product type*, and the result then says plainly that
nothing could be checked. The nearest match is never taken; "Beer" does not
become "Malt beverages", because the difference between them is a body of
regulation and a wrong one produces findings that all look perfectly ordinary.

### 4.3 The upload

| State | Presentation |
|---|---|
| Empty | Dashed region, instruction text, **and** a `Choose a file` button. Accepted format and size limit stated at rest |
| Dragging over | Region highlights; border becomes solid |
| Selected | Filename, file size, `Replace` and `Remove` |
| Rejected | Returns to empty with the reason stated beneath (§10) |

**Drag-and-drop is always paired with a file-picker button.** Drag-and-drop
alone is unusable for several groups and unfamiliar to part of this audience.
The button is not a fallback; it is the primary affordance, with the drop zone
as a convenience.

**Filename and size before submission, and no thumbnail.** The agent must be
able to confirm the right file is attached without submitting — the most common
upload error is the wrong file. The thumbnail went with the image upload: a PDF
does not render in an `img`, and its first page is the form rather than the
label.

**Constraints are stated before they are violated** (P6). Format and size are
visible at rest, not revealed by an error.

**Beneath the upload: demo examples.** A short list of real corpus documents to
download and upload. Without them the single-review path is a file picker that
refuses every file its visitor owns, which is the state anyone evaluating the
deployment arrives in.

**Every one is a complete submission**, and two things were tried here first.
An invitation to fill in the blank form and upload it — twenty minutes of data
entry to see one verdict, whose likeliest outcome was somebody uploading the
*blank* form and getting a verdict saying nothing could be read. Then `F01`,
the form filed on its own, offered as a seventh sample: a fair test of the
region map that reads such a filing (D50), and a poor demonstration, because
three of the four comparisons come back unassessed and that reads as a tool
which could not read the document. It remains in the corpus as a fixture.

What is offered is the shape this system is for: the form with the labels
affixed, and the application record carrying the fields the form has no box
for.

> **Somebody will upload their own form, and that works** (D50). Nothing stops
> a visitor filling in a TTB F 5100.31 and submitting it without an application
> record, so the question is what happens when they do — and the answer is that
> it degrades honestly rather than failing. The form has no box for class/type,
> alcohol content or net contents — item 15 asks for those only where they are
> embossed on the container and absent from the labels — so those three report
> `NOT_SUPPLIED`: *not assessed*, which is true, rather than a pass. What the form does carry is item 5, which selects the
> governing regulation, and item 6. The regulation checks read the **label**,
> so every one of them still applies. Nothing is defaulted in to fill the gap:
> a default would be compared against the label, and agreement with an invented
> expectation is a false match.

- They are **the corpus files**, not mock-ups: the same documents the batch runs
  on, each with authored ground truth for what it should produce
  (`testdata/README.md`). A fabricated sample would demonstrate the interface
  rather than the system
- Their titles and expected outcomes are read from the corpus manifest, never
  restated on the screen. A second copy of ground truth drifts, and the screen
  is the one that would look authoritative when it did
- Six, spanning a clean pass, a genuine discrepancy, a tolerance that must *not*
  fire, an unreadable field, and the adversarial case. A demonstration made only
  of passes says nothing about judgement; one made only of failures reads as a
  broken system
- Each line says what the reader will see happen, in those words — not which
  test case it serves
- **Their absence is silent.** Samples are a convenience, and an error banner
  over a form that works perfectly well reports a problem the agent does not
  have

**A PDF this system cannot crop is refused as a form problem, not a service
problem.** "Please try again in a moment" is wrong advice for a file that will
be rejected identically every time; it sends the agent back to a dependency
instead of to the file they uploaded.

### 4.4 Primary action

- Label: **Check this submission**
- The largest interactive element on the screen
- **Never disabled**
- Full-width on narrow viewports; centred and generously sized otherwise

**The button is never disabled**, even with nothing attached. A disabled button
is unfocusable, announces nothing to assistive technology, and gives a hesitant
user no explanation for why clicking does nothing. Pressing it with nothing
attached runs validation and moves focus to the problem, which *tells the agent
what to do*. That is both the accessible pattern and the kinder one.

**Beside it: Clear this form** — secondary styling, and smaller. UC-1 is a
repeated act: an agent checks one submission, then the next.

- It removes the attached PDF, clears any error, and takes the previous verdict
  off the screen
- **The attached file goes with it.** A PDF left attached under a screen that
  looks empty is the one state that would put the same submission through a
  second review under a new reference
- Focus returns to the picker, so the next submission starts where the eye
  already is
- **It asks no confirmation, because nothing is lost.** Every review is
  persisted with its own reference code the moment it completes (M4), so this
  discards a view of the record and not the record. An agent who needs the
  previous result looks it up by reference (§11)
- It is present from the start rather than appearing once a result exists: a
  control that materialises only when you are finished is one nobody knows
  about while they are working

It is deliberately *not* the same size as the primary action. Matching it would
present "start again" as an equal choice to "check this submission", which is
not what an agent came to the screen to do.

### 4.5 Validation

**On submit only. Never on blur.**

Validating as a user leaves a field punishes slow and uncertain typists — it flags
an incomplete entry as an error before they have finished thinking. For this
audience that is actively hostile.

On submit, if no file is attached:

1. Focus moves to the first problem
2. An inline message appears beneath that control
3. The control is marked invalid for assistive technology
4. No request is sent

Every constraint enforced here is re-enforced server-side (§9.3). Client-side
validation exists for responsiveness, never for correctness.

### 4.6 The working state

Five seconds is short but not instant, and an unexplained wait is where a hesitant
user starts clicking again.

```
              ┌──────────────────────────────────────┐
              │   Reading the submission…                 │
              │   ▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░         │
              └──────────────────────────────────────┘

                     This usually takes a few seconds.
```

| Rule | Reason |
|---|---|
| The button is **replaced**, not disabled | A greyed button invites a second click; a progress element does not |
| Copy is plain: *"Reading the submission…"* | Never *"Invoking extraction"* (P7) |
| Form inputs become read-only, not hidden | The agent can still see what they submitted |
| After ~8s: *"Still working — this is taking longer than usual."* | Honest, and prevents the assumption of a hang |
| Progress is indeterminate, not a countdown | A countdown that overruns is worse than none |

### 4.7 Transition to results

**Results replace the input region entirely.** The label image moves into the
results view (§6.4), where it stays visible.

The form is not shown alongside the results, because the results rows *become* the
editing surface (§8). Two editable copies of the same value is a defect waiting to
happen.

On completion:

1. The results region replaces regions B, C and D
2. Focus moves to the outcome banner
3. The banner is announced via an assertive live region
4. The page does not scroll — the banner occupies the position the form did

**Moving focus is not optional.** Without it, a screen-reader user is left at a
now-empty region with no indication that anything happened, and a sighted user may
miss a result rendered above their scroll position.

A `Check another label` action resets to §4.1 with everything cleared.

### 4.8 Keyboard and focus

| | |
|---|---|
| Tab order | Product type → brand name → class/type → alcohol → net contents → file button → primary action → clear this form |
| The drop zone is not a tab stop | The button inside it is |
| Focus ring | Visible, never removed, ≥ 2px, ≥ 3:1 against its background |
| `Enter` in any text field | Submits — matches the expectation of a four-field form |
| On validation failure | Focus to the first invalid control |
| On results | Focus to the outcome banner |
| On error | Focus to the error message |

### 4.9 Responsive behaviour

| Width | Layout |
|---|---|
| ≥ 1100px | Panels side by side; image beside results |
| 700–1100px | Panels side by side, narrower; image above results |
| < 700px | Panels stack — application, then label, then action |

Nothing is hidden at any width. No horizontal scrolling at any width, or at 200%
zoom (NF-A04).

### 4.10 Every string on this screen

*Written once, here, so copy is a design artefact rather than an implementation
afterthought.*

| Element | Text |
|---|---|
| Page title | TTB Label Check |
| Mode switch | Single review · Batch |
| Panel 1 heading | 1. The application says |
| Panel 2 heading | 2. The label |
| Field labels | Product type · Brand name · Class / type · Alcohol content · Net contents |
| Buttons | Check this submission · Clear this form |
| Required marker | (required) — on brand name only |
| Class hint | e.g. Kentucky Straight Bourbon Whiskey |
| Net contents hint | e.g. 750 mL |
| Drop zone | Drop the label image here |
| File button | Choose a file |
| Constraint line | JPEG or PNG, up to 10 MB |
| Selected file actions | Replace · Remove |
| Primary action | Check this submission |
| Working | Reading the submission… |
| Working, sub | This usually takes a few seconds. |
| Working, extended | Still working — this is taking longer than usual. |
| Missing brand name | Please enter the brand name from the application. |
| Missing image | Please add an image of the label. |
| Reset action | Check another label |

---

## 5. Results — Overall Outcome

Three outcomes (§8.4.2), each unmistakable, each carrying a text label, never
distinguished by colour alone (P2, NF-A05).

```
┌────────────────────────────────────────────────────────────────────────┐
│  ✓   Everything matches                                                │
│      All 4 fields agree with the application. Warning statement is      │
│      correct.                                                          │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│  ✗   2 problems found                                                  │
│      Alcohol content does not match. Warning statement is not correct.  │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│  !   Could not finish the check                                        │
│      1 field could not be read from this image. A clearer photo is      │
│      needed before this label can be reviewed.                          │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│  ?   Nothing blocking found — some rules need your judgement           │
│      Nothing blocking found — some rules need your judgement before    │
│      your approval.                                                    │
└────────────────────────────────────────────────────────────────────────┘
```

**A fourth was added with the policy layer (D40).** `CLEAR_CONFIRM_POLICY` is
not the same request as `CLEAR_CONFIRM_FLAGGED`, and they are deliberately not
merged: one asks the agent to confirm a *reading* a better scan would settle,
the other to make a *compliance judgement* the artwork cannot supply at all. It
ranks above the flagged state and below anything reporting a defect, and it
sits above the "Matched" divider in the worklist with its own count chip —
nothing blocking was found, but the submission is not finished with.

**The second line is the recommendation, and it never says "Approved".** The
word appears only as something handed back — *"ready for your approval"*, *"do
not approve until…"*. This is the one place a user reads the governing
principle, and it is one word from being violated; `aggregate.test.ts` asserts
it on every outcome.

**The third matters most.** `INCOMPLETE` outranks everything (D5), and the
interface must never let it read as a pass. It gets its own treatment, its own
wording, and states the required action — a clearer photo — rather than merely
reporting a condition.

Wording is deliberately non-technical: *"Everything matches"*, not `CLEAR`.
*"Could not finish the check"*, not `INCOMPLETE`. The verdict vocabulary in
§8.4.2 is internal (P7).

---

## 6. Results — Field Rows

In the order of Jenny's paper checklist (P4), with the artwork beside them so the
agent adjudicates against the label rather than against the verdict (FR-10).

```
┌───────────────────────────────────────┐  ┌──────────────────────────┐
│  Brand name                            │  │                          │
│  ✓  Matches                            │  │      [ label image ]     │
│     Application:  Old Tom Distillery   │  │                          │
│     On the label: OLD TOM DISTILLERY   │  │      stays visible       │
│     Capitalisation differs — treated   │  │      while scrolling     │
│     as a match.                        │  │                          │
├───────────────────────────────────────┤  │      ┌────────────┐      │
│  Class / type                          │  │      │   Enlarge   │      │
│  ✓  Matches                            │  │      └────────────┘      │
│     Application:  Kentucky Straight…   │  │                          │
│     On the label: Kentucky Straight…   │  └──────────────────────────┘
├───────────────────────────────────────┤
│  Alcohol content                       │
│  ✗  Does not match                     │
│     Application:  45%      [ Edit ]    │
│     On the label: 40% Alc./Vol.        │
├───────────────────────────────────────┤
│  Net contents                          │
│  !  Could not read this on the label   │
│     Application:  750 mL               │
│     On the label: —                    │
│     This part of the image is unclear.  │
└───────────────────────────────────────┘
```

### 6.1 Row anatomy

| Part | Always present | Purpose |
|---|---|---|
| Field name | Yes | Plain English, matching the paper checklist |
| Status: icon **and** words | Yes | Never icon-only, never colour-only |
| Both values, labelled | Yes | The evidence (FR-10) — the agent's actual decision input |
| Rule line | **Conditional — §6.3** | Explains a judgment the system made |

### 6.2 Status vocabulary

Fixed, and used nowhere else.

| Icon | Words | Meaning |
|---|---|---|
| ✓ | Matches | Agrees within a stated rule |
| ✗ | Does not match | Read, and disagrees |
| ! | Could not read this on the label | Perception failed — **not** a discrepancy |
| — | Not on the application | Nothing supplied to compare against |

### 6.3 The rule line — when it appears

**A rule line appears only when a rule was actually exercised.**

| Situation | Rule line |
|---|---|
| Values identical | **None.** `✓ Matches` and nothing further |
| Values differ but a tolerance matched them | **Yes** — *"Capitalisation differs — treated as a match."* |
| Units converted | **Yes** — *"Units differ but the volume is the same."* |
| Proof converted to ABV | **Yes** — *"Proof converted to alcohol by volume."* |
| Unit assumed on the label | **Yes** — *"No unit was found on the label; millilitres assumed. Please double-check."* |
| Plain mismatch | **Yes** — names the comparison performed |
| Could not read | **Yes** — states the consequence and the remedy |

**This resolves the tension in §2.1.** Dave's trust comes from seeing that the
system noticed and decided — silent correctness leaves him unsure it looked at
all. But an explanation on every row is text on a screen whose premise is that a
hesitant user should not have to read much.

Showing the line exactly when a judgment was made satisfies both: a clean label
produces four near-bare rows, while every exercised tolerance is visible and
challengeable. The explanation appears precisely when it is earning its place.

**Rejected alternative:** hiding rule lines behind a disclosure control. That
violates P1 and P9 — a control which must be discovered is one the benchmark user
will not find.

### 6.4 The image panel

| Rule | Reason |
|---|---|
| Remains visible while results scroll | **Load-bearing.** FR-10 exists so the agent adjudicates against the artwork; if the image scrolls away they adjudicate against the verdict instead — the exact posture the design is built to avoid |
| `Enlarge` opens a full-size view | Small print on a label is unreadable at panel size |
| Never obscures a result row | The enlarged view is dismissible by `Esc`, by a close button, and by clicking outside |
| Stacks above results below 1100px | Still visible, and still before the verdicts in reading order |

---

## 7. Results — Warning Statement

Distinct from the field rows because its rules differ (G3 outranks G5) and its
failures are more specific.

```
┌────────────────────────────────────────────────────────────────────────┐
│  Government warning                                                     │
│                                                                         │
│  ✗  The wording is not correct                                          │
│                                                                         │
│     Required:  …because of the risk of birth defects.                   │
│     On label:  …because of the risk of birth defect.                    │
│                                                     ^^^^^^^^^^^^        │
│     The text must match the regulation exactly.                          │
│                                                                         │
│  ✓  "GOVERNMENT WARNING:" is in capital letters                         │
│                                                                         │
│  ─────────────────────────────────────────────────────────────────      │
│                                                                         │
│  Please check these by eye — they cannot be verified from an image:      │
│                                                                         │
│    ☐  "GOVERNMENT WARNING:" is in bold type                             │
│    ☐  The rest of the warning is NOT in bold                            │
│    ☐  Type size meets the minimum for this container size               │
│    ☐  The warning is separate from other label text                     │
└────────────────────────────────────────────────────────────────────────┘
```

- **The deviation is shown, not merely reported.** Required and actual text side
  by side with the difference marked. "The warning is wrong" is not actionable.
- **Failures are named by segment** (§3.6) — header, clause 1, clause 2 — rather
  than condemning the whole statement.
- **The advisory checklist is FR-6a made honest.** Rules the system cannot verify
  from an image, stated as the agent's responsibility rather than silently
  omitted. Checkboxes are non-functional and non-persisted: it is a printed
  checklist, which is the artefact Jenny already uses.
- **A print stylesheet is worth its cost.** Jenny works from paper, and the
  advisory list is the one part of this interface that genuinely wants printing.
- The second advisory item — *"the rest of the warning is NOT in bold"* — is the
  rule no interviewee mentioned (§3.6). Its presence is the visible payoff of
  reading the regulation rather than the transcript.

---

## 7a. Results — Rules Applied

The policy layer's output (design §18.4), below the warning statement. One row
per rule that governed this submission, in the order the agent needs them:
breaches first, then rules that could not be judged, then those met, then those
that did not apply. A list ordered by rule id buries three problems under nine
passes.

```
┌───────────────────────────────────────────────────────────────────────┐
│  Rules applied                                                         │
├───────────────────────────────────────────────────────────────────────┤
│  ✗  Not met                                                            │
│     Net contents must be an authorised standard of fill                │
│     800 mL is not an authorised standard of fill                       │
│     27 CFR 5.203 · DS-STANDARD-OF-FILL                                 │
├───────────────────────────────────────────────────────────────────────┤
│  ?  Could not be judged from the artwork                               │
│     Net contents must appear on the label                              │
│     netContents could not be read from the artwork                     │
│     27 CFR 5.63 · DS-NET-CONTENTS-PRESENT                              │
├───────────────────────────────────────────────────────────────────────┤
│  ✓  Met                                                                │
│     Alcohol content must be stated in a permitted form                 │
│     "45% alc/vol" is a permitted form                                  │
│     27 CFR 5.65 · DS-ALCOHOL-CONTENT-FORMAT                            │
└───────────────────────────────────────────────────────────────────────┘
```

**Every row cites its regulation.** A finding an agent cannot trace to a
section is one they can only defer to, and deferring to it is precisely what
FR-10 exists to avoid. The citation and rule id are monospaced for the same
reason as the reference code: they are read across to another document,
character by character.

**Every row states what it decided on.** The evidence line is the observation,
not a restatement of the verdict — *"800 mL is not an authorised standard of
fill"*, never *"failed"*.

**"No rules were applied to this submission" is a real state, and it is shown.**
It happens when the application states no product type, because product type is
what selection runs on. It reads as an open question rather than a pass — the
outcome is `CLEAR_CONFIRM_POLICY`, not `CLEAR`.

---

## 8. Correcting a Value

UC-3. The agent notices a typo in the application data rather than a genuine
discrepancy.

```
│  Alcohol content                       │
│  ✗  Does not match                     │
│     Application:  45%      [ Edit ]    │
│     On the label: 40% Alc./Vol.        │
```

| Step | Behaviour |
|---|---|
| `Edit` | The application value becomes an inline text input, focused, content selected |
| Confirm | `Enter`, or a `Re-check` button. `Esc` cancels |
| Result | Comparison re-runs; no re-upload, no re-extraction; effectively instantaneous |
| Copy after | *"Re-checked using the same label reading."* |
| Scope | Only the edited row's verdict and the overall outcome change |

**`Edit` appears only on rows where it can help** — a mismatch or a missing value.
Offering it on a passing row invites tampering with a correct result.

**This is where the architecture becomes felt.** The separation of extraction from
comparison (§6.1) is otherwise invisible to the user; here it appears as a
correction that returns instantly instead of taking five seconds.

---

## 9. Batch Mode

```
┌────────────────────────────────────────────────────────────────────────┐
│  Checked 47 of 300                    ▓▓▓▓░░░░░░░░░░░░░░░░░░░░          │
│                                                                        │
│   ✗  3 with problems     !  1 could not be read     ✓  43 matched      │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  Problems first                                                   │  │
│  │                                                                   │  │
│  │  ✗  bourbon_0012.jpg    Alcohol content does not match            │  │
│  │  ✗  gin_0031.jpg        Warning statement is not correct          │  │
│  │  ✗  rye_0044.jpg        Brand name does not match                 │  │
│  │  !  vodka_0019.jpg      Could not read 2 fields                   │  │
│  │  ─────────────────────────────────────────────────────────────    │  │
│  │  ✓  bourbon_0001.jpg    Everything matches                        │  │
│  │  ✓  bourbon_0002.jpg    Everything matches                        │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

- **Results appear as they resolve** (FR-13, NFR-2). The first lands within 5s
  while the rest continue.
- **Problems sort to the top and stay there.** With 300 items the job is triage;
  the 43 that matched need no attention. Sorting by outcome rather than by arrival
  is the difference between a list and a worklist.
- Counts update live, so progress is legible without reading rows.
- A failed item shows its cause and is individually re-submittable (NFR-6).
- Selecting any row opens that item's full review — the same view as §5–§7. One
  results design, not two.

---

## 10. Errors

Every message follows one shape: **what happened, why, what to do next** (P6).

| Situation | Message |
|---|---|
| Wrong file type | *"That file is a PDF. Please upload a JPEG or PNG image of the label."* |
| Too large | *"That image is 24 MB. The limit is 10 MB. Please upload a smaller image."* |
| Corrupt image | *"This image could not be opened. It may be damaged — try exporting it again."* |
| Missing brand name | *"Please enter the brand name from the application."* — at the field |
| Missing image | *"Please add an image of the label."* — at the upload region |
| Service unavailable | *"The label reading service is not responding. Nothing is wrong with your label — please try again in a moment."* |
| Timeout | *"This took longer than expected and was stopped. [Try again]"* |
| Unexpected | *"Something went wrong. Nothing was saved. [Try again]"* + reference code |

**The service-unavailable wording carries real weight.** Without *"nothing is
wrong with your label"*, an agent may record a rejection for a system fault. The
distinction between a system failure and a compliance finding must be in the
words, not merely in a status code.

**The reference code** (D21) appears in error messages and at the foot of every
result: `Reference: 7K2M-4QX9`. Nothing is stored (N3), so it is the only bridge
between an agent's report of a wrong result and the operator's logs.

**No message contains** an error number as its primary content, the words
"invalid" or "failed" unqualified, a stack trace, or an instruction to contact an
administrator who does not exist.

---

## 11. Visual System

Deliberately plain. Each decision follows from §2.1.

| Aspect | Decision | Because |
|---|---|---|
| Type scale | Outcome 32px · headings 20px · body 17px · nothing below 15px | NFR-4; half the team is over 50 |
| Line length | ≤ 75 characters | Readability at larger sizes |
| Contrast | ≥ 4.5:1 throughout; ≥ 7:1 for outcome text | NF-A02 |
| Status encoding | Icon **and** word **and** colour — any two sufficient alone | Colour-blindness; NF-A05 |
| Colour | Green / red / amber for status only. Neutral greys elsewhere | Status must be the most salient thing on screen |
| Density | Generous spacing; ~8 field rows visible at once | Cramped tables punish imprecise pointing |
| Motion | Progress indication only | Motion is noise here |
| Chrome | No cards-within-cards, no shadows carrying meaning, no icon-only buttons | Every control names itself |
| Focus | Visible focus ring, never removed | NF-A03 |

**Aesthetic position:** this should look like a well-made government tool, not a
consumer product. Restraint is the correct register for the audience and the
setting, and it is also the fastest thing to build well within C1.

---

## 12. Copy Rules

The interface's vocabulary is a design artefact (P7).

| Never | Always |
|---|---|
| Extraction, inference, model, AI, confidence score | Reading the label, could not read |
| CLEAR / DISCREPANCIES / INCOMPLETE | Everything matches / problems found / could not finish |
| CLEAR_CONFIRM_POLICY, VIOLATED, UNDETERMINED | Needs your judgement / not met / could not be judged from the artwork |
| Approved | *"ready for your approval"* — the system recommends, the agent decides |
| Invalid input | Names the field and what is needed |
| Failed | Says what did not happen and what to do |
| Low confidence | *"Please double-check this one"* |

**"AI" appears nowhere in the interface.** It is not what the agent is doing —
they are checking a label. Naming the mechanism invites either misplaced trust or
misplaced suspicion, and both cost accuracy.

---

## 13. Accessibility

Target WCAG 2.1 AA (§5.4).

- Every input has a real `<label>`; no placeholder-as-label
- Full keyboard operation, logical tab order, visible focus (NF-A03)
- Results announced on completion via an assertive live region; focus moved to the
  outcome banner (§4.7)
- Validation errors associated with their controls and announced
- Status conveyed in text, not by icon or colour alone (NF-A05)
- Layout survives 200% zoom with no horizontal scrolling (NF-A04)
- Drag-and-drop always paired with a file-picker button
- No time limits, no auto-dismissing messages
- The enlarged image view traps focus and returns it on dismissal

---

## 14. Deliberately Absent

| Absent | Why |
|---|---|
| Login | D14 |
| Dark mode | Cost without benefit for this audience and setting |
| Keyboard shortcuts | Discoverability cost for the benchmark user; power-user affordances are not the bar |
| Saved history | N3 — nothing is stored |
| Settings | Nothing a user should be configuring |
| Onboarding tour | If it needs a tour it has failed NF-U |
| Confidence percentages | A number invites false precision; *"please double-check this one"* is more actionable |
| Approve / reject buttons | **N7** — the system informs, it does not decide. Adding them would misrepresent what the tool is |

The last is the most important omission. There is no button that records a
compliance decision, because that decision is the agent's and is made in COLA.

---

## 15. Build Order

Matching §11.1 milestones and the §11.2 cut ladder.

| # | Piece | Section | Milestone |
|---|---|---|---|
| 1 | Single-review layout, form, upload | §4.1–4.5 | M3 |
| 2 | Working state and focus management | §4.6–4.8 | M3 |
| 3 | Reference code surfaced | §10 | M4 |
| 4 | Outcome banner, all three states | §5 | M5 |
| 5 | Field rows with evidence | §6.1–6.2 | M5 |
| 6 | Rule line, conditional | §6.3 | M5 |
| 7 | Image panel, persistent | §6.4 | M5 |
| 8 | Warning block with deviation display | §7 | M5 |
| 9 | Advisory checklist | §7 | M5 |
| 10 | Error states | §10 | M6 |
| 11 | Correct-and-recheck | §8 | after M6 |
| 12 | Batch | §9 | M9 |

Items 1–10 constitute the shippable floor (§11.2).
