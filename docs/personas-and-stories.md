# Personas, stories, and what is actually built

*Personas come from the discovery interviews, not from a workshop. Each one earns
its place by changing something concrete — a persona that changes no decision is
decoration. Stories are traced to the requirements in `design.md` §3, and each
carries a **status a reviewer can check**, including the ones that are not built.*

**Gaps are shown.** A backlog that lists only what shipped is a marketing
document. The three "Not built" rows and the two "Partial" rows below are the
most useful part of this page: they say where the prototype stops, and why it
stops there rather than somewhere else.

---

## 1. The people

| Persona | Source | What is true of them | What it changed in the product |
|---|---|---|---|
| **Dave** — senior agent, 28 years | SRC-4 | Has watched modernisation projects come and go. Values judgment over pattern-matching. Cited `STONE'S THROW` vs `Stone's Throw` as "obviously the same thing" | Tolerance rules for case, punctuation and whitespace (FR-7), and every verdict shows both values with the rule that decided it (FR-10). **A false mismatch costs more trust than a missed match** — the tolerance direction follows from him |
| **Jenny** — junior agent, 8 months | SRC-5 | Works from a printed checklist. Caught a title-case "Government Warning" and rejected it. Wants degraded images handled | The warning check is exact and clause-by-clause (FR-5, FR-6); results follow her checklist order. `UT-W05` and `UT-W12` are guard tests because *her* case is the one that must never silently pass |
| **Janet** — Seattle office | SRC-2 | Handles bulk importer filings, 200–300 at once | Batch exists for her (FR-12, FR-13). Results stream as they settle rather than at the end, and the worklist puts settled items first so the remaining work is the bottom of the list |
| **Sarah** — Deputy Director | SRC-2 | Owns the outcome. Burned by a vendor pilot at 30–40 s per label. "If we can't get results back in about 5 seconds, nobody's going to use it" | S1 (p95 ≤ 5 s) is a stated success criterion, and the Measurement screen now reports against it rather than asserting it |
| **"Sarah's mother"** — the accessibility benchmark | SRC-2 | 73, learned video calling last year | The floor for every interaction decision. One obvious action per screen; the primary button is never disabled, because a disabled button explains nothing |
| **The median agent** | SRC-2 | Half the team is over 50; mixed tech confidence; time-pressured | Large type, high contrast, no hunting for controls (NFR-4) |

**Marcus** (SRC-3, IT) is a stakeholder rather than a user: he never touches the
screen, but Azure, FedRAMP, the blocked outbound firewall and "no COLA
integration" are all his, and they shape `integration-and-delivery.md`.

---

## 2. Stories, by priority and status

**Status vocabulary.** *Built* — works, with a test or screen you can check.
*Partial* — the useful half works and the rest is named. *Not built* — and the
row says whether that was a decision or a shortfall.

### P1 — the product does not exist without these

| ID | Story | Req | Status | Evidence |
|---|---|---|---|---|
| **US-1** | As an agent, I upload a filed submission and get a verdict, so I stop transcribing values by hand | FR-1, FR-2, FR-3 | **Built** | `/review` takes the filed PDF; both regions read blind (D48) |
| **US-2** | As an agent, I see what the label says beside what the application says, so I can adjudicate without reopening the artwork | FR-10 | **Built** | Results panel shows expected and observed per field, plus the crop and the filed document |
| **US-3** | As Dave, a difference of case or punctuation is not reported as a discrepancy, so the tool does not waste my time | FR-7 | **Built** | `UT-N02` — `STONE'S THROW` matches. `UT-N08` guards the other direction: `Old Tom` ≠ `Old Tom Distillery` |
| **US-4** | As Jenny, the government warning is checked word for word, including capitalisation | FR-5, FR-6 | **Built** | Guard tests `UT-W05`, `UT-W12`. The statutory text is byte-verified against the eCFR API |
| **US-5** | As an agent, "could not read it" is plainly different from "read it and it is wrong" | FR-11 | **Built** | `UNREADABLE` outranks every other state (D5); guard tests `UT-G03`, `UT-G04` |
| **US-6** | As Sarah, a result arrives fast enough that agents keep using it | NFR-1 | **Partial** | The target is stated and now *measured* (D52). Whether it is met is a number on the Measurement screen, not a claim here — and dropping the batch short-circuit (D51) made every submission cost two model calls |
| **US-7** | As Sarah, every review leaves a record I can defend | FR-17, FR-18 | **Built** | Hash-chained `audit_event`; extraction rows keep the raw response; a verdict replays from its own record |

### P2 — the reason Janet asked for this

| ID | Story | Req | Status | Evidence |
|---|---|---|---|---|
| **US-8** | As Janet, I submit a batch and triage results as they arrive | FR-12, FR-13 | **Built** | 26-item corpus run; live progress over WebSocket; per-item failure isolation |
| **US-9** | As Janet, the ones needing me are easy to find | FR-9 | **Built** | Worklist puts settled items first under a divider, and marks rows a person has already decided |
| **US-10** | As an agent, one bad file does not take down the batch | NFR-6 | **Built** | `L26` is a deliberately truncated PDF; it fails alone |
| **US-11** | As an agent, I record my decision and it is kept against the verdict it answered | §18.5 | **Built** | Decision recorded with the recommendation it agreed or disagreed with; only a human agent may record one (D46) |

### P3 — governance, which nobody asked for and the record needs

| ID | Story | Req | Status | Evidence |
|---|---|---|---|---|
| **US-12** | As an auditor, I can see which rules a verdict was judged by, as they stood that day | D41, D42, D44 | **Built** | Bitemporal policy archive; replay reconstructs the rule set from the verdict's own two dates |
| **US-13** | As a reviewer, I can read the rules in force and what is awaiting approval | §18.5a | **Built** | Policy screen, read-only |
| **US-14** | As a reviewer, I can see who and what may act here | D46 | **Built** | Agents screen: human / model / system, with entitlements |
| **US-15** | As Sarah, I can see what this costs to run | Q-OPS-03 | **Built** | Token counts per read and per model (D52) |

### Not built — and why

| ID | Story | Req | Status | Why |
|---|---|---|---|---|
| **US-16** | As an agent, I correct a mistyped expected value and re-run the comparison without re-reading the image (UC-3) | — | **Not built — decision** | The screen no longer takes typed values at all (D48): it reads the filed form. Correction now means correcting the *filing*, which is a COLA operation this prototype does not have. The cheap re-compare that UC-3 promised still exists architecturally — comparison is pure and takes no model — but there is no longer an input to correct |
| **US-17** | As Janet, I export batch results to a spreadsheet | FR-15 | **Not built — shortfall** | Ranked *Could*. Nothing structural prevents it; it did not survive the time available. The data is all in D1 |
| **US-18** | As Jenny, badly-shot photographs are still read | — | **Partial** | `L09` (angle + glare) reads; `L10` (out of focus) is reported `UNREADABLE`, which is the *correct* behaviour rather than a failure — but Jenny asked for the image to be salvaged, and no deskew or enhancement step exists |
| **US-19** | As an agent, I sign in, and my decisions are attributable to me | NFR-2 | **Not built — decision** | D14: the prototype is unauthenticated. Names on decisions are **declared, not verified**. The staging gate is a shared credential and a cost control, not a login, and the Agents screen says so on its face |
| **US-20** | As a compliance manager, I approve a new rule in the interface | §18.5a | **Not built — decision** | A rule takes effect by a reviewed change to `config/policy-set.json` (D45). A button that wrote rules at runtime would be a control with no authorisation behind it, since there is no identity (D14). Six drafted rules currently await a named approval |

---

## 3. What this says about coverage

| Priority | Built | Partial | Not built |
|---|---|---|---|
| P1 | 6 | 1 | 0 |
| P2 | 4 | 0 | 0 |
| P3 | 4 | 0 | 0 |
| Other | 0 | 1 | 3 |

Every *Must* requirement in `design.md` §3.2 maps to a passing test — the
matrix is `test-plan.md` §12, and it is the real completeness gate rather than a
coverage percentage.

The three deliberate omissions all share a shape: **each would need an identity
this prototype does not have.** Sign-in, in-app rule approval, and correcting a
filing are the same missing prerequisite wearing three hats — which is worth
more to a reader than three separate excuses.
