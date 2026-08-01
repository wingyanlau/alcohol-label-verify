# User Interface Design

*Companion to `design.md` §5. Realises the interaction principles in §5.3.
Section references are to that document unless stated.*

| Field | Value |
|---|---|
| Status | Draft |
| Last updated | 2026-07-31 |
| Benchmark user | Sarah's mother, 73 (SRC-2) |

---

## 1. The Bar

Sarah set a specific, unusually clear standard: *"something my mother could
figure out — she's 73 and just learned to video call her grandkids."* Half the
team is over 50. Dave prints his emails.

That is the design constraint, and it is more demanding than "clean". It rules
out things that are normal in modern web applications: progressive disclosure,
icon-only controls, hover-revealed actions, multi-step wizards, anything
requiring a user to know that a region is scrollable or clickable.

**The test is NF-U** (test-plan §9.3): one untrained person completes a review
without asking a question. Not "finds it attractive". Completes it.

---

## 2. Information Architecture

**One screen. No navigation. No settings.**

```
   ┌──────────────────────────────────────────────┐
   │                                              │
   │   Single review          ⟷      Batch        │
   │   (default)                    (secondary)   │
   │                                              │
   └──────────────────────────────────────────────┘
```

Two modes, one visible switch, nothing else. There is no menu, no account, no
history, no preferences — partly because N2 and N3 mean there is nothing to put
in them, and partly because every additional destination is somewhere a
low-confidence user can get lost.

**Rejected:** a wizard. Splitting "enter the application data" and "upload the
label" into steps adds state, a back button, and a way to be halfway through.
Everything needed for one review fits on one screen at legible size.

---

## 3. Single Review — Layout

```
┌────────────────────────────────────────────────────────────────────────┐
│  TTB Label Check                                    Single │ Batch     │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  ┌──────────────────────────────┐  ┌────────────────────────────────┐  │
│  │  1. The application says      │  │  2. The label                  │  │
│  │                               │  │                                │  │
│  │  Brand name                   │  │   ┌──────────────────────────┐ │  │
│  │  ┌─────────────────────────┐  │  │   │                          │ │  │
│  │  │                         │  │  │   │   Drop the label image    │ │  │
│  │  └─────────────────────────┘  │  │   │         here              │ │  │
│  │                               │  │   │                          │ │  │
│  │  Class / type                 │  │   │   ┌──────────────────┐   │ │  │
│  │  ┌─────────────────────────┐  │  │   │   │  Choose a file   │   │ │  │
│  │  │                         │  │  │   │   └──────────────────┘   │ │  │
│  │  └─────────────────────────┘  │  │   │                          │ │  │
│  │                               │  │   │   JPEG or PNG, up to 10MB │ │  │
│  │  Alcohol content              │  │   └──────────────────────────┘ │  │
│  │  ┌─────────────────────────┐  │  │                                │  │
│  │  │                    % │  │  │                                │  │
│  │  └─────────────────────────┘  │  │                                │  │
│  │                               │  │                                │  │
│  │  Net contents                 │  │                                │  │
│  │  ┌─────────────────────────┐  │  │                                │  │
│  │  │                         │  │  │                                │  │
│  │  └─────────────────────────┘  │  │                                │  │
│  └──────────────────────────────┘  └────────────────────────────────┘  │
│                                                                        │
│              ┌──────────────────────────────────────┐                  │
│              │        Check this label              │                  │
│              └──────────────────────────────────────┘                  │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

**Why this shape.**

- **Two numbered panels.** "1. The application says" / "2. The label" names the
  agent's actual task — comparing a form against artwork — in the layout itself.
  Numbering removes any question of order without imposing steps.
- **One primary action, always visible, never below the fold** (P1). It is the
  largest interactive element on the screen.
- **Field labels above inputs, never inside them.** Placeholder-as-label
  disappears on focus, which is a documented accessibility failure and precisely
  the kind of thing that strands a hesitant user.
- **Constraints stated before they are violated** — accepted formats and size
  limit are visible at rest, not revealed by an error (P6).
- Panels stack vertically below ~900px. Nothing is hidden at any width.

---

## 4. Working State

The 5-second budget (S1) is short but not instant, and an unexplained wait is
where a hesitant user starts clicking again.

```
┌────────────────────────────────────────────────────────────────────────┐
│                                                                        │
│              ┌──────────────────────────────────────┐                  │
│              │   Reading the label…                 │                  │
│              │   ▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░         │                  │
│              └──────────────────────────────────────┘                  │
│                                                                        │
│                     This usually takes a few seconds.                  │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

- The button is replaced, not merely disabled — a greyed button invites a second
  click; a progress element does not.
- Plain language: *"Reading the label"*, never *"Invoking extraction"* (P7).
- If it exceeds ~8 seconds the copy changes to *"Still working — this is taking
  longer than usual"*, which is honest and prevents the assumption of a hang.

---

## 5. Results — Overall Outcome

Three outcomes (§8.4.2), each unmistakable, each carrying a text label and never
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
```

**The third is the one that matters most.** `INCOMPLETE` outranks everything
(D5), and the interface must never let it read as a pass. It gets its own
treatment, its own wording, and states the required action — a clearer photo —
rather than merely reporting a condition.

Wording is deliberately non-technical: *"Everything matches"*, not *"CLEAR"*.
*"Could not finish the check"*, not *"INCOMPLETE"*. The verdict vocabulary in
§8.4.2 is internal (P7).

---

## 6. Results — Field Rows

Presented in the order of Jenny's paper checklist (P4), with the artwork beside
them so the agent adjudicates against the label rather than against the verdict
(FR-10).

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
│     Application:  45%                  │
│     On the label: 40% Alc./Vol.        │
├───────────────────────────────────────┤
│  Net contents                          │
│  !  Could not read this on the label   │
│     Application:  750 mL               │
│     On the label: —                    │
│     This part of the image is unclear.  │
└───────────────────────────────────────┘
```

**Row anatomy — four parts, always all four:**

| Part | Purpose |
|---|---|
| Field name | Plain English, matching the paper checklist |
| Status with icon **and** words | Never icon-only, never colour-only |
| Both values, labelled | The evidence (FR-10) — the agent's actual decision input |
| Rule applied, when it explains something | *"Capitalisation differs — treated as a match"* |

**The rule line is Dave's row.** His objection is a tool that flags
`STONE'S THROW` against `Stone's Throw`. This design does not merely avoid the
false flag — it *shows him it noticed and decided*, in a sentence. Silent
correctness would leave him unsure whether the tool had looked.

**Status vocabulary**, fixed and used nowhere else:

| Icon | Words | Meaning |
|---|---|---|
| ✓ | Matches | Agrees within a stated rule |
| ✗ | Does not match | Read, and disagrees |
| ! | Could not read this on the label | Perception failed — **not** a discrepancy |
| — | Not on the application | Nothing supplied to compare against |

**The keeping-the-image-visible decision is load-bearing.** FR-10 exists so the
agent adjudicates against the artwork. If the image scrolls away behind the
results, the agent adjudicates against the verdict instead — which is the
trust posture the entire design is built to avoid.

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

- **The deviation is shown, not just reported.** Required text and actual text
  side by side with the difference marked. An agent must be able to act, and
  "the warning is wrong" is not actionable.
- **Failures are named by segment** (§3.6) — the header, clause 1, clause 2 —
  rather than condemning the whole statement.
- **The advisory checklist is FR-6a made honest.** Four things the system cannot
  verify from an image, stated as the agent's responsibility rather than silently
  omitted. Checkboxes are deliberately non-functional and non-persisted; they are
  a printed checklist, which is the artefact Jenny already uses.
- The second item — *"the rest of the warning is NOT in bold"* — is the rule no
  interviewee mentioned (§3.6). Its presence is the visible payoff of reading the
  regulation.

---

## 8. Correcting a Value

UC-3. The agent notices a typo in the application data rather than a genuine
discrepancy.

```
│  Alcohol content                       │
│  ✗  Does not match                     │
│     Application:  45%     [ Edit ]     │
│     On the label: 40% Alc./Vol.        │
```

Editing re-runs comparison only — no re-upload, no re-extraction, and the result
is effectively instantaneous (§6.1). Copy after the edit: *"Re-checked using the
same label reading."*

This is worth building because it is where the architecture becomes *felt*. The
separation of extraction from comparison is otherwise invisible to the user; here
it shows up as a correction that returns instantly instead of taking five
seconds.

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
- **Problems sort to the top and stay there.** With 300 items the agent's job is
  triage; the 43 that matched need no attention. Sorting by outcome rather than
  by arrival is the difference between a list and a worklist.
- Counts update live, so progress is legible without reading rows.
- A failed item shows its cause and is individually re-submittable (NFR-6).
- Selecting any row opens that item's full review — the same view as §5–§7, so
  there is one results design, not two.

---

## 10. Errors

Every message follows one shape: **what happened, why, what to do next** (P6).

| Situation | Message |
|---|---|
| Wrong file type | *"That file is a PDF. Please upload a JPEG or PNG image of the label."* |
| Too large | *"That image is 24 MB. The limit is 10 MB. Please upload a smaller image."* |
| Corrupt image | *"This image could not be opened. It may be damaged — try exporting it again."* |
| Missing field | *"Please enter the brand name from the application."* — shown at the field |
| Service unavailable | *"The label reading service is not responding. Nothing is wrong with your label — please try again in a moment."* |
| Timeout | *"This took longer than expected and was stopped. [Try again]"* |
| Unexpected | *"Something went wrong. Nothing was saved. [Try again]" + reference code* |

**The service-unavailable wording carries real weight.** Without *"nothing is
wrong with your label"*, an agent may record a rejection for a system fault. The
distinction between a system failure and a compliance finding must be explicit in
the words, not merely in the status code.

**No message contains** an error number as its primary content, the words
"invalid" or "failed" unqualified, a stack trace, or any instruction to contact
an administrator who does not exist.

---

## 11. Visual System

Deliberately plain. Nothing here is stylistic preference; each follows from §5.1.

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
| Invalid input | Names the field and what is needed |
| Failed | Says what did not happen and what to do |
| Low confidence | *"Please double-check this one"* |

**"AI" appears nowhere in the interface.** It is not what the agent is doing.
The agent is checking a label; how the reading happens is an implementation
detail, and naming it invites either misplaced trust or misplaced suspicion —
both of which cost accuracy.

---

## 13. Accessibility

Target WCAG 2.1 AA (§5.4). Specifics:

- Every input has a real `<label>`; no placeholder-as-label
- Full keyboard operation, logical tab order, visible focus (NF-A03)
- Results announced on completion via a live region — the outcome must reach a
  screen-reader user without a manual re-read
- Status conveyed in text, not by icon or colour alone (NF-A05)
- Layout survives 200% zoom with no horizontal scrolling (NF-A04)
- Drag-and-drop always paired with a file-picker button — drag-and-drop alone is
  unusable for several groups and unknown to some of this audience
- No time limits, no auto-dismissing messages

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

The last is the most important omission on the list. There is no button that
records a compliance decision, because that decision is the agent's and is made
in COLA.

---

## 15. Build Order

Matching §11.1 milestones and the §11.2 cut ladder:

| # | Piece | Notes |
|---|---|---|
| 1 | Single-review layout, form, upload | §3 |
| 2 | Field rows with evidence | §6 — FR-10, the trust mechanism |
| 3 | Overall outcome banner | §5 — all three states, `INCOMPLETE` first |
| 4 | Warning block with deviation display | §7 |
| 5 | Error states | §10 |
| 6 | Working state | §4 |
| 7 | Advisory checklist | §7 — static, near-zero cost |
| 8 | Correct-and-recheck | §8 — where the architecture becomes felt |
| 9 | Batch | §9 — cut ladder items 5 and 6 |

Items 1–5 constitute the shippable floor (§11.2).
