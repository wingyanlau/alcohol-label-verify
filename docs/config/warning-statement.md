# Configuration: Government Health Warning Statement

**Single source of truth for FR-5 and FR-6.** The application reads the warning
text from this file. It is not duplicated in the design document, in code, or in
a prompt. Correcting this file corrects the system.

| Field | Value |
|---|---|
| Citation | 27 CFR § 16.21 (text), § 16.22 (formatting) |
| Applies to | All alcoholic beverages — beer, wine, distilled spirits |
| Retrieved from | Cornell LII mirror of the CFR |
| Retrieved on | 2026-07-31 |
| Verification status | ⚠️ **UNCONFIRMED** — pending spot-check against ecfr.gov |
| Config version | 1 |

> **Open action.** eCFR blocked automated retrieval, so this was taken from the
> Cornell LII mirror. Confirm against
> [ecfr.gov § 16.21](https://www.ecfr.gov/current/title-27/chapter-I/subchapter-A/part-16/subpart-C/section-16.21)
> in a browser, then change verification status to CONFIRMED. A single wrong word
> here silently invalidates every warning-statement verdict the system issues.

---

## 1. Canonical Text

The statement is continuous text. The line breaks below are presentation only
and carry no meaning for comparison.

```text
GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects. (2) Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may cause health problems.
```

## 2. Segments

*Held separately so a failure can name which part is wrong rather than reporting
the whole statement as incorrect. A label missing clause (2) is a different
finding from one that has paraphrased clause (1).*

| ID | Segment | Text |
|---|---|---|
| `header` | Header | `GOVERNMENT WARNING:` |
| `clause_1` | Surgeon General / pregnancy | `(1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects.` |
| `clause_2` | Impairment / health problems | `(2) Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may cause health problems.` |

## 3. Comparison Rules

*The tolerant matcher used for brand and class/type fields must **not** be
applied here — the statement is exact by law. These rules define the only
variance permitted, and each exists because it is an artefact of reading text
off a photograph rather than a difference in the words themselves.*

| Rule | Permitted | Reason |
|---|---|---|
| Collapse runs of whitespace to a single space | Yes | Line wrapping on the physical label is a layout choice |
| Ignore leading and trailing whitespace | Yes | Extraction artefact |
| Treat a line break as a space | Yes | The statement wraps across lines on most labels |
| Normalise typographic quotes and dashes to ASCII | Yes | Extraction and typesetting artefact |
| Ignore case **outside** the header | Yes | Only the header has a capitalisation rule (§4) |
| Ignore case **within** the header | **No** | FR-6 — title case is a documented rejection reason |
| Substitute, omit, add, or reorder any word | **No** | Statutory text is exact |
| Alter punctuation, including the `(1)` / `(2)` markers | **No** | Part of the required text |

**On reporting.** When the text does not match, report the specific deviation —
which segment, and what differs — not merely that the statement is wrong. An
agent needs to see the discrepancy to act on it.

## 4. Formatting Rules — 27 CFR § 16.22

| Rule | Requirement | Auto-verified | Requirement ID |
|---|---|---|---|
| Header capitalisation | `GOVERNMENT WARNING:` in capital letters | **Yes** | FR-6 |
| Header weight | `GOVERNMENT WARNING:` in **bold** type | No — advisory | FR-6a |
| Remainder weight | Remainder **may not** be bold | No — advisory | FR-6a |
| Minimum type size | ≤ 237 mL → 1 mm · > 237 mL–3 L → 2 mm · > 3 L → 3 mm | No — advisory | FR-6a |
| Legibility and contrast | Readily legible under ordinary conditions, on a contrasting background | No — advisory | FR-6a |
| No compression | Characters not compressed so as to impair legibility | No — advisory | FR-6a |
| Separateness | Separate and apart from other label information | No — advisory | FR-6a |

**Two rules worth noting, neither raised in the stakeholder interviews:**

1. **The remainder may not be bold.** Interviewees framed formatting risk solely
   as applicants under-emphasising the warning. The regulation also constrains
   over-emphasis. A checklist derived only from the interviews misses this.
2. **Minimum type size is a function of container volume**, so it cannot be
   evaluated from artwork alone — it depends on net contents, itself a field
   under comparison.

## 5. Change Log

| Version | Date | Change | By |
|---|---|---|---|
| 1 | 2026-07-31 | Initial capture from Cornell LII; verification pending | — |
