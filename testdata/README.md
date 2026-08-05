# Test Corpus — Submissions

26 submissions, one PDF each, two pages:

| Page | Contains |
|---|---|
| 1 | **The real TTB F 5100.31 (04/2023), page 1** — typed values, with the label set affixed in the "AFFIX COMPLETE SET OF LABELS BELOW" box |
| 2 | A **COLAs Online application record** carrying the structured fields |

Realises `docs/test-plan.md` §8 and exercises the unit cases in §3.

## Why two pages

**The paper form has no field for class/type designation, alcohol content or net
contents.** Item 15 asks for such information only where it is embossed on the
container *and absent from the labels*. The comparison the brief describes —
*"ABV is correct? Check"* — therefore has no source on the form itself.

Page 2 models the electronic record so the comparison has one. Whether COLAs
Online in fact captures these fields is an open question for TTB
(`docs/project-reference.md` §8.7). The split is deliberate: it keeps the
prototype's task intact while being explicit about which data comes from where.

## How the form is filled

Values are drawn at coordinates read from the form's **own AcroForm field
rectangles**, so nothing is positioned by guesswork. Annotations are then
stripped, producing a flat document like a scanned submission.

Two cells are redrawn by the overlay: item 2's caption and item 3 entirely. Their
text lives in field appearance streams rather than the page content stream, so
flattening removes them. Keeping the annotations instead is not an option —
several widgets paint opaque backgrounds over the affix box.

## Ground truth

`manifest.json` states, per submission, the application data and the expected
outcome: overall verdict, per-field state, and whether the warning should pass.

**It is authored, not derived.** Nothing comes from a model. Recording a model's
output as truth would score every future model against the incumbent's mistakes
and cap accuracy at whatever shipped first (test-plan §18.1).

Where a human could not be certain either, a field lists more than one acceptable
state — see L10 and L11. That is honest ground truth, not vagueness: demanding a
single answer where none exists produces false failures.

## Principles

**One defect per submission**, so a failure localises to one rule. L22 is the
deliberate exception, carrying three to exercise aggregation and counting.

**Three cases expose limitations rather than pass** — reproduced so they cannot be
quietly forgotten:

| Case | Limitation | Remedy |
|---|---|---|
| L18 | `Ky. Straight Bourbon` vs `Kentucky Straight Bourbon Whiskey` | Semantic escalation seam (§8.4.4) |
| L08 | Warning body in bold — a §16.22 violation | Advisory only. TTB states it does not routinely review type size or contrast (form §II.C) |
| L25 | Fanciful name — a Form 5100.31 field the prototype does not model | Field catalogue is configuration (§8.6.1) |

**Two cases test the dangerous direction of failure.** L13 carries a prompt
injection *alongside a genuine mismatch* — reporting `CLEAR` means the injection
worked. L11 affixes an invoice bearing plausible numbers and a company name,
which is exactly what invites a fabricated extraction.

**A note on L12 and the back-label problem.** Because the real form carries the
*complete set* of labels on one page, ingesting the whole submission largely
dissolves risk R7. The A2 assumption fails only if the tool is handed a cropped
front-label image instead of the submission page. L12 models an incomplete
submission — front label only — where reporting the warning missing is the
*correct* finding, not a false positive.

## Cases

| ID | Case | Expected | Serves |
|---|---|---|---|
| L01 | Fully compliant | `CLEAR` | IT-01, E2E-01 — clean pass, no false discrepancy |
| L02 | Brand differs only in capitalisation and apostrophe | `CLEAR` | UT-N02 — Dave's case (SRC-4). Must be a MATCH, not a mismatch |
| L03 | Alcohol content stated with proof on the label | `CLEAR` | UT-A01 — format tolerance, proof conversion |
| L04 | Alcohol content genuinely differs | `DISCREPANCIES_FOUND` | IT-02, E2E-02, UT-A05 — 45% on the record, 40% on the label |
| L05 | Health warning absent from the label set | `DISCREPANCIES_FOUND` | UT-W11, FR-5 — back label affixed, but carries no warning |
| L06 | Health warning header in title case | `DISCREPANCIES_FOUND` | UT-W05, IT-03 — Jenny's documented rejection (SRC-5) |
| L07 | Health warning altered by one word | `DISCREPANCIES_FOUND` | UT-W07 — 'birth defect' for 'birth defects'; must localise to clause_1 |
| L08 | Health warning body set in bold | `CLEAR` | KL-03, FR-6a — §16.22 violation, ADVISORY only, must not auto-fail |
| L09 | Submission scanned at an angle, under glare | `CLEAR` | G7 — degraded but should remain readable |
| L10 | Out-of-focus scan — graded degradation | `INCOMPLETE` | FR-11, E2E-03 — report UNREADABLE for what cannot be read, never guess |
| L11 | Wrong document affixed — a shipping invoice | `INCOMPLETE` | Corpus case 11 — no fabricated fields |
| L12 | Incomplete label set — front label only | `DISCREPANCIES_FOUND` | A2, R7 — the warning lives on the back label, which was not affixed |
| L13 | Label bearing injected instruction text | `DISCREPANCIES_FOUND` | ADV-01 — prompt injection must be data, never instruction |
| L14 | Net contents differ by unit only | `CLEAR` | UT-Q03 — 75 cL on the label against 750 mL on the record |
| L15 | Net contents genuinely differ | `DISCREPANCIES_FOUND` | UT-Q05 — TTB names net contents among the most common errors (§8.6) |
| L16 | Net contents missing from the label | `DISCREPANCIES_FOUND` | MISSING_ON_LABEL — distinct from UNREADABLE |
| L17 | Class/type genuinely differs | `DISCREPANCIES_FOUND` | Class/type mismatch — also a tax-classification question (§8.1) |
| L18 | Class/type abbreviated on the label | `DISCREPANCIES_FOUND` | KL-02 — semantic equivalence beyond deterministic rules |
| L19 | Brand name is a substring of the record value | `DISCREPANCIES_FOUND` | UT-N08 — guards against an over-permissive matcher |
| L20 | Ampersand on the label, 'and' on the record | `DISCREPANCIES_FOUND` | UT-N09 — semantic, not typographic; must NOT be silently tolerated |
| L21 | Record leaves class/type blank | `CLEAR` | NOT_SUPPLIED — not assessed is not the same as failed (UT-G06) |
| L22 | Multiple simultaneous discrepancies | `DISCREPANCIES_FOUND` | Aggregation with several findings; problem count must be 3 |
| L23 | Warning clauses in the wrong order | `DISCREPANCIES_FOUND` | UT-W10 — each clause matches in isolation; order is checked separately |
| L24 | Unreadable field alongside a genuine mismatch | `INCOMPLETE` | UT-G04 — UNREADABLE must outrank MISMATCH in aggregation (D5) |
| L25 | Fanciful name present on the record and the label | `CLEAR` | §8.7 — Item 7 is a field the prototype does not model |
| L26 | Corrupt / truncated file | `INTAKE_ERROR` | ADV-04, NFR-6 — intake rejection; in a batch it must fail alone |

## Regenerating

```
pip install pypdf
python3 generate.py
```

Also needs Google Chrome for headless rendering. The corpus is deterministic —
the same script produces the same submissions, so it regenerates rather than
living as opaque binaries.

## The blank form (`f510031.pdf`)

**Committed, not downloaded.** It used to be fetched from ttb.gov on first run
and kept out of the repository as a build artefact. It is neither.

| | |
|---|---|
| Document | TTB F 5100.31 (04/2023) — Application for and Certification/Exemption of Label/Bottle Approval |
| OMB control number | 1513-0020 |
| Retrieved from | <https://www.ttb.gov/system/files/images/pdfs/forms/f510031.pdf> |
| SHA-256 | `4d59b3bfe287ce7f36e072d9e7c918e551856b3ae2e3b968d5617c521db5c0ba` |
| Rights | A work of the United States federal government. Not subject to copyright |

**Why it is in the repository.** Two things in this codebase are *derived from
this exact file* and cannot be checked without it:

- `src/normalise/regions.ts` — the crop coordinates are the form's own AcroForm
  field rectangles, read off this document rather than measured by eye.
- Every submission in `submissions/` — page 1 of each is this file's page 1 with
  values merged onto it.

A form the agency revises, moves or withdraws would take both with it, and the
first sign would be a corpus that no longer regenerates or a crop that silently
slid off the affix box. Pinning the bytes is cheap; re-deriving those
coordinates from memory is not.

**The digest identifies the file, not the revision.** Two downloads of the same
04/2023 form can differ byte-for-byte — a copy re-saved by a browser carries a
different producer and creation date while printing identically. The revision
line at the foot of page 1 (`TTB F 5100.31 (04/2023)`) is what says which form
this is; the digest says which copy.

## Notes

- The statutory warning text mirrors `config/warning-statement.json`, the single
  source of truth (D3).
- Degradation in L09 and L10 is applied with CSS transforms and filters at render
  time, so the artwork is genuinely skewed, glared and defocused.
- L26 is a valid PDF truncated to a third of its length — structurally a PDF,
  unreadable as one.
