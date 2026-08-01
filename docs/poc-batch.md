# PoC — Batch Processing the Test Corpus

*A minimal end-to-end run over `testdata/submissions/`. Deliberately much smaller
than `batch-backend-design.md`, which describes the production system.*

| Field | Value |
|---|---|
| Status | Draft |
| Input | 26 submissions + `manifest.json` ground truth |
| Runs | Locally. No Cloudflare, no queue, no coordinator |

---

## 1. Purpose

**The PoC is a measurement instrument, not a product.** It exists to answer four
questions that no amount of further design will settle:

| Question | Why it matters |
|---|---|
| Can a model read the warning statement at 300 DPI? | **B-Q4.** FR-5 is word-for-word; this sets resolution, cost and latency for every item |
| What is the real per-item latency, by stage? | §13's budget has no slack and is currently an estimate |
| Does the pipeline produce the expected verdicts? | 26 authored ground truths, scored automatically |
| Does blind extraction hold in practice? | L13 carries an injection *and* a real mismatch — reporting `CLEAR` means it failed |

Everything else about batch — durability, streaming, retries, coordination — is
deferred. Those are engineering problems with known solutions. These four are
unknowns.

---

## 2. Scope

**In:** normalise → two blind extractions → deterministic compare → aggregate →
audit record → score against ground truth → render in the batch UI.

**Out:** job persistence, resumption, live streaming, retry policy, dead-letter,
cost estimation UI, Cloudflare deployment, multiple form versions.

**Non-negotiable even here:** the PoC uses the **real** comparison, warning
verification and aggregation code (D8, B10). A throwaway comparator would make
the run prove nothing about the system being built.

---

## 3. Pipeline

```
  submissions/*.pdf
        │
        ▼
  ┌───────────────┐   page 1 affix region  ──▶ raster ──┐
  │  NORMALISE    │                                      ├─▶ EXTRACT × 2
  │  sips → crop  │   page 2 record page   ──▶ raster ──┘   (parallel, blind)
  └───────────────┘                                            │
                                                               ▼
                          COMPARE ──▶ AGGREGATE ──▶ AUDIT RECORD
                          (real code, no model)                │
                                                               ▼
                      ┌────────────────┬──────────────────┬────────────┐
                      │  results.json  │  scorecard.md    │  index.html│
                      └────────────────┴──────────────────┴────────────┘
```

**Two separate extraction calls, never one.** The page carries both the
application values and the label; a single call over the whole page defeats
blind extraction (B-D1). This is the property L13 tests.

---

## 4. Components

| Component | Status | Note |
|---|---|---|
| Normaliser | **New** | `sips` for PDF → PNG, then crop the affix region. macOS built-in; swapped for the production normaliser later |
| Provider adapter | **New** | One provider, behind the extraction contract (§8.3) |
| Comparator, warning verifier, aggregator | **Reused** | The real deterministic core |
| Audit record assembler | **Reused** | Scoped per §11.2.1 |
| Runner | **New** | Bounded-concurrency pool over the file list |
| Scorer | **New** | Compares results to `manifest.json` |
| Batch view | **Reused** | `ui-design.md` §9, reading `results.json` statically |

Six of these are throwaway or thin. The verification logic — the part that must
be right — is the code that ships.

---

## 5. Run Model

A single local process. Concurrency is a bounded pool, default **5**, set by the
provider's rate limit rather than by anything in the design.

26 items × 2 calls = **52 calls**. At ~3 s per parallel pair and concurrency 5,
the whole corpus runs in **under a minute** and costs pennies. Cheap enough to
re-run on every prompt change, which is the point — this is the harness that
makes model and prompt decisions empirical.

No queue, no coordinator, no durability. If it crashes, run it again.

---

## 6. Outputs

**`results.json`** — per item: verdict, per-field states with both values and the
rule applied, warning segment results, audit record, per-stage timings.

**`scorecard.md`** — the run scored against ground truth:

```
  26 submissions · 24 as expected · 2 divergent

  outcome accuracy      24/26
  field-level accuracy  98/104
  warning verdicts      25/26

  DIVERGENT
    L10  expected INCOMPLETE      got DISCREPANCIES_FOUND
         net contents reported "750 mL" — ground truth says UNREADABLE
         ⚠ a fabricated value, not a misread. §8.3.2 schema pressure.
    L18  expected DISCREPANCIES   got DISCREPANCIES   ✓ (known limitation KL-02)
```

Fields whose ground truth lists several acceptable states (L10, L11) score as
correct on any of them — the manifest already encodes that honesty.

**`index.html`** — the batch worklist from `ui-design.md` §9, rendered statically
from `results.json`. Problems sorted to the top. Clicking a row opens the full
review view. It is the same markup the live UI will use; only the data source
differs.

---

## 7. What Gets Measured

| Measurement | Feeds |
|---|---|
| Per-stage latency: normalise, extract, compare | §13 budget; NF-L02 |
| Extraction read-rate per field against ground truth | B-Q4; test-plan §18.2 |
| Warning statement exact-match rate | FR-5 — the hardest and most important |
| Fabrication rate: values reported where truth says unreadable | §8.3.2 — the dangerous failure |
| Cost per item | R8, and the figure that scales to 150,000/year |

**Fabrication rate is the one to watch.** A model that reads less and admits it
is better than one that reads more and invents. L10 and L11 exist to measure
exactly this, and no other metric will reveal it.

---

## 8. Prerequisite — the corpus must be rasterised first

**The current corpus cannot validate anything.** Chrome rendered the labels as
real text, so every submission carries a text layer including the full warning
statement. A text-layer reader would score 100% without calling a model.

Before the PoC runs, `generate.py` must rasterise the label artwork before
affixing it, so the affix region is genuinely an image. Real submissions carry
photographed or photocopied labels and never have a text layer.

Worth producing a second variant at the same time — a fully scanned page, where
even the form is raster — since real submissions arrive both electronically filed
and print-then-scanned.

**~20 minutes of generator work, and nothing downstream is meaningful without it.**

---

## 9. Deliberately Absent

| Absent | Because |
|---|---|
| Durability, resumption | 26 items in under a minute; re-running is cheaper than persisting |
| Live streaming | Static output is enough to validate the view; streaming is plumbing |
| Retry | A failure is a finding here, not something to paper over |
| Cloudflare | Nothing being measured depends on the platform |
| Multiple form versions | One version exists |
| Result caching | B-D9, and re-running is the point |

---

## 10. Exit Criteria

The PoC has done its job when:

- [ ] Corpus rasterised (§8) and the text-layer shortcut is closed
- [ ] All 26 submissions produce a verdict or a stated failure
- [ ] `scorecard.md` exists, and every divergence is explained rather than tolerated
- [ ] Warning statement read-rate measured at the chosen resolution — **B-Q4 answered**
- [ ] Per-stage latency recorded against §13
- [ ] Fabrication rate measured on L10 and L11
- [ ] L13 does not report `CLEAR`
- [ ] Results render in the batch view

**Then the production questions become worth asking.** Until B-Q4 has a number,
everything in `batch-backend-design.md` rests on an assumption about resolution
that has never been tested.
