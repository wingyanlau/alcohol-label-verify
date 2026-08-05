# What it costs, what it saves, and what it does not claim

*Machine cost is **measured** from a corpus run, not estimated. Human effort is
derived from the figures TTB gave in the discovery interviews. Where a number is
neither — the fraction of filings that arrive clean — this shows a range and
refuses to pick, because that number is the one that decides the answer and
nobody has it yet.*

**Evidence convention**, as elsewhere in this repository: **[M]** measured by
this system · **[R]** reported by a stakeholder · **[P]** published by a vendor ·
**[E]** estimated, with the basis stated.

---

## 1. What a submission costs to check

From a 26-item corpus run on 2026-08-05. Twenty-five reached verification; `L26`
is a deliberately truncated file that fails at intake and never reaches a model.

| | Measured |
|---|---|
| Reads per submission | 2 — the label and the record, both blind **[M]** |
| Tokens sent, per submission | 2,833 **[M]** |
| Tokens returned, per submission | 342 **[M]** |
| **Total per submission** | **3,175 tokens** **[M]** |
| Spread | Near-constant: label ~1,565, record ~1,620 on every item **[M]** |

**The cost is predictable, which is the useful part.** Token counts barely move
between a clean label and a badly-degraded one, so cost per submission is a rate
rather than a distribution.

### At published rates

| Model | Rate in / out per 1M **[P]** | Per submission | 150,000/year **[R]** |
|---|---|---|---|
| `gemini-3.5-flash` (as run) | $1.50 / $9.00 | **$0.0073** | **≈ $1,100** |
| `gemini-3.5-flash-lite` | $0.30 / $2.50 | $0.0017 | ≈ $260 |
| `gemini-2.5-flash` | $0.30 / $2.50 | $0.0017 | ≈ $260 |

Rates as published on the date above; check them before quoting. The token
counts are ours and will not move — **swap the rate, keep the arithmetic.**

**Inference is not the interesting cost.** Roughly a thousand dollars a year to
read every label TTB receives is a rounding error beside a $4.2M modernisation
quote **[R]**. The interesting costs are hosting, accreditation and the agent
time in §3 — and the fact that inference is *this* cheap is itself the finding,
because it removes cost as a reason not to check every submission twice.

---

## 2. What it costs in time, and what the tail actually is

| | Measured **[M]** |
|---|---|
| Verification, p50 | 2.30 s |
| Verification, p95 | 11.30 s |
| Slowest | 15.19 s |
| Comparison alone | **0.00 s** — sub-millisecond |

**All of the time is inference. None of it is our code.** That single fact
decides where the fix lives.

### The tail is provider variance, not work

The slowest reads are not the difficult images. `L09` and `L10` — the degraded
scans — are nowhere near the top. Instead:

| Latency | Region | Tokens | Submission |
|---|---|---|---|
| 15,194 ms | record | 1,621 | L20 |
| 3,889 ms | record | 1,620 | L12 |

**Same work, near-identical token counts, four times the latency.** Latency here
is uncorrelated with the size of the job, which points at provider-side
queueing on a metered free tier rather than at anything the design controls.

### What that means for the stated target

S1 is *"p95 ≤ 5 s"*. p50 is comfortably inside it; p95 is not.

**But 25 samples cannot settle this.** At n = 25, nearest-rank p95 is the
24th value — effectively the second-slowest single observation. One slow call
moves it by seconds. So the honest statement is:

> The median is well inside target. The tail exceeds it, and the sample is too
> small to say by how much. Repeated runs, and a provider with dedicated
> capacity, are what would settle it.

Reporting "S1: not met" as a finished verdict would be over-claiming in the
pessimistic direction, which is no more honest than the optimistic one.

---

## 3. What it saves, in agent-hours

**Denominated in hours, not dollars, deliberately.** Hours follow from figures
TTB gave. Dollars need a salary the brief never stated — so the conversion is
kept separate, and a reader who rejects the rate keeps the analysis.

### Inputs

| Input | Value | Source |
|---|---|---|
| Applications per year | 150,000 | **[R]** Sarah |
| Agents | 47 | **[R]** Sarah |
| Minutes per straightforward review | 5–10 | **[R]** Sarah |
| Share of the work that is "essentially data entry verification" | ~half | **[R]** Sarah's framing |
| **Share of filings arriving with no discrepancy** | **unknown** | **the dominant variable** |

That last row is why this section is a table and not a number. The corpus cannot
supply it: it is authored, deliberately defect-heavy, and unrepresentative by
construction — 26 submissions chosen to exercise failure modes, not to sample
reality.

### Sensitivity, at 150,000 filings and 7.5 min average

Assume a clean filing still takes an agent **1 minute** to confirm against the
evidence shown, rather than zero — the human decides, always (§6.1).

| If this share arrives clean | Hours today | Hours after | **Reclaimed** | ≈ FTE-equivalents |
|---|---|---|---|---|
| 40% | 18,750 | 12,250 | **6,500 h** | ~3.5 |
| 60% | 18,750 | 9,000 | **9,750 h** | ~5.2 |
| 80% | 18,750 | 5,750 | **13,000 h** | ~6.9 |

*The model, stated so it can be argued with:* `after = clean × 1 min +
(1 − clean) × 7.5 min`. **A flagged filing is assumed to cost the full 7.5
minutes**, unchanged — the agent still adjudicates it, and the tool has only
told them where to look. That is deliberately conservative: if localising the
problem saves any time at all, these figures understate.

*FTE-equivalent at 1,880 productive hours/year **[E]**, a standard federal
working-year figure — shown as scale, not as headcount.*

**Read the left column, not the right.** The spread between 40% and 80% is
double the benefit. Establishing that fraction is a week of sampling real COLA
filings and is worth more than any further engineering.

---

## 4. What this deliberately does not claim

**Not headcount reduction.** This division went from 100+ agents to 47 through
budget cuts **[R]**. Sarah's stated problem is that her people are *"drowning in
routine stuff"* — a throughput problem, not a staffing surplus. Reclaimed hours
are capacity; what an agency does with capacity is its decision and not our
benefit line.

**Not replacement of judgment.** The saving sits in the matching half. Dave's
`STONE'S THROW` case is exactly the kind of thing the tolerance rules handle *so
that a human is not called for it* — and everything they cannot settle is routed
to a person by design.

**Not a quality claim.** Nothing here measures whether agents catch more
violations. That needs a labelled sample of real filings and a comparison
against agent decisions; the record now holds what such a study would need
(every verdict, every decision, whether they agreed), but the study has not been
done.

---

## 5. The error economics, which no single number can carry

The two ways to be wrong have costs that differ by orders of magnitude, and any
model that averages them recommends exactly the wrong automation.

| | Cost | Who absorbs it |
|---|---|---|
| **False flag** — a compliant label reported as a discrepancy | ~5 minutes of an agent's time, plus trust | The agent. Dave abandons tools that waste his time **[R]** |
| **False pass** — a non-compliant label reported as clear | A non-compliant product reaches market; the agency's decision is unsound | The public, and the agency's credibility |

**This asymmetry is the reason for design choices that look expensive:**
`UNREADABLE` outranks every other state; nothing is ever defaulted before being
compared; the two reads are blind so a model cannot confirm what it was shown;
and every uncertainty routes to a human rather than resolving itself.

A benefit case that priced only the time saved would recommend removing all four.

---

## 6. What would sharpen this

In the order that changes the answer most:

1. **Sample real filings for the clean-arrival rate** (§3). It is the dominant
   variable and it is a week of work.
2. **Repeat the corpus run** — enough times that p95 is a distribution rather
   than one slow call (§2).
3. **Run both providers over the same corpus** and compare accuracy against
   authored ground truth *and* cost. B-Q4 has been open since design; both
   halves are now measurable.
4. **Measure end to end, not stage totals.** What is reported excludes
   rasterisation and queue wait, so an agent experiences more than 2.30 s. The
   figure that matters to adoption is the one Sarah's vendor failed on.
