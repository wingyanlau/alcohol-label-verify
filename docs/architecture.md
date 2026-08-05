# Architecture — as built

*The system as it actually runs. `design.md` §6 and §8 describe the **logical**
design, worked before the platform was chosen and deliberately free of vendor
names; this describes what those components became on Cloudflare Workers
(D12/D13). Where the two disagree, this one is the deployment and that one is
the intent — and a disagreement is a defect in one of them, not a difference of
opinion.*

---

## 1. Context

Who talks to the system, and what it talks to.

```
   ┌────────────────────────┐        ┌──────────────────────────┐
   │   Compliance agent     │        │  Policy author/approver  │
   │  (Dave, Jenny, Janet)  │        │   (Sarah, IT admin)      │
   └───────────┬────────────┘        └────────────┬─────────────┘
               │ a filed submission (PDF)         │ a reviewed change to
               │ a decision on a verdict          │ config/policy-set.json
               ▼                                  ▼  (git, not this app)
   ╔════════════════════════════════════════════════════════════════╗
   ║              Label Verification System (this project)          ║
   ║                                                                ║
   ║        the model reads · the rules compare · the human decides ║
   ╚═══════════┬─────────────────────────────┬══════════════════════╝
               │ image + extraction contract │ regulation text, by digest
               ▼                             ▼
   ┌───────────────────────┐      ┌──────────────────────────────┐
   │ Vision model provider │      │ eCFR versioner API           │
   │ Workers AI · Gemini   │      │ (build/review time, not      │
   │ external, metered     │      │  a runtime dependency)       │
   └───────────────────────┘      └──────────────────────────────┘

   NOT in context, deliberately:
     COLA (N1) · identity provider (N2, D14) · agency databases (N3)
```

The **only runtime external dependency is the vision model provider.**
Regulation text is pinned by digest in configuration and ships with the worker;
nothing calls out to ecfr.gov to decide a verdict.

---

## 2. Containers

What runs where, on the Cloudflare platform.

```
 ── EDGE ─────────────────────────────────────────────────────────────────
   ┌───────────────────────────────────────────────────────────────────┐
   │ Worker  src/index.ts                                              │
   │                                                                   │
   │  gate (D49) ─▶ routes ─▶ { review · batch · policy · agents ·     │
   │                            measurement · samples · health }       │
   │                                                                   │
   │  holds NO verification logic — it routes, persists and reports    │
   └───┬──────────┬──────────┬───────────┬──────────┬──────────┬───────┘
       │          │          │           │          │          │
       ▼          ▼          ▼           ▼          ▼          ▼
 ┌──────────┐ ┌────────┐ ┌───────┐ ┌──────────┐ ┌────────┐ ┌──────────┐
 │ JOB      │ │ WORK   │ │STAGING│ │ DB       │ │BROWSER │ │ AI /     │
 │ Durable  │ │ Queue  │ │ R2    │ │ D1       │ │Rendering│ │ fetch    │
 │ Object   │ │        │ │       │ │          │ │        │ │ (Gemini) │
 │          │ │ 1 msg  │ │ PDFs, │ │ the      │ │puppeteer│ │          │
 │ ledger,  │ │ per    │ │ label │ │ record   │ │+ pdf.js│ │ optional │
 │ progress,│ │ item   │ │ crops │ │ (§8.2)   │ │        │ │ via AI   │
 │ fan-out, │ │        │ │       │ │          │ │ crop   │ │ Gateway  │
 │ WebSocket│ │ retry  │ │ purged│ │ append-  │ │ label +│ │          │
 │ broadcast│ │ + DLQ  │ │ by    │ │ only     │ │ record │ │          │
 │          │ │        │ │ sweep │ │ audit    │ │ regions│ │          │
 └──────────┘ └────────┘ └───────┘ └──────────┘ └────────┘ └──────────┘

 ── BUNDLED WITH THE WORKER ──────────────────────────────────────────────
   ASSETS (./testdata)          config/*.json
   26 corpus submissions,       warning statement (D3), policy set (D45),
   build-time rasters,          approved models (D29), user register (§19.5)
   authored ground truth
```

**The Worker contains no verification logic.** Every rule lives in
`src/domain/**`, which takes no clock, no randomness, no I/O and no platform
API. That is what makes the rules testable without a network and re-runnable
years later — and it is enforced by coverage thresholds that apply to that
directory and nowhere else.

---

## 3. Request path — one submission (UC-1)

```
 agent            Worker                 BROWSER        provider        D1/R2
   │                │                       │              │              │
   │─ POST /review ▶│                       │              │              │
   │  (filed PDF)   │                       │              │              │
   │                │─ checkIntake ─────────┼──────────────┼──────────────┤
   │                │  bytes only: magic, page count,      │              │
   │                │  pixels, %%EOF — before any decode   │              │
   │                │                       │              │              │
   │                │─ rasteriseSubmission ▶│              │              │
   │                │                       │ pdf.js render│              │
   │                │◀── label crop ────────│ + 2 crops    │              │
   │                │◀── record crop ───────│              │              │
   │                │                       │              │              │
   │                │═ verifySubmission ════╪══════════════╪══════════════╡
   │                │   ┌─ extract(label) ──┼─────────────▶│  concurrent, │
   │                │   └─ extract(record) ─┼─────────────▶│  and BLIND   │
   │                │                       │              │              │
   │                │   compare · verify warning · apply policy (pure)    │
   │                │   aggregate → outcome                │              │
   │                │═══════════════════════╪══════════════╪══════════════╡
   │                │                       │              │              │
   │                │─ persist: extraction ×2, verdict, field_verdict,   ─▶│
   │                │           policy_finding, audit_event (hash-chained)│
   │◀─ verdict ─────│                       │              │              │
   │                │                       │              │              │
   │─ decision ────▶│  human only (D46) — the code refuses any other kind │
```

**Neither read is shown the other's answer.** No expected value exists until
both have returned, and an `ExtractionRequest` has nowhere to put one — so
blindness (D4) holds by the shape of the type, not by anyone remembering. `CT-10`
asserts it structurally.

---

## 4. Request path — a batch (UC-2)

The same verification, reached differently. Janet's 200–300 filings.

```
 agent      Worker        JOB (DO)        WORK queue      consumer
   │           │             │                │              │
   │ POST /batch            │                │              │
   │──────────▶│─ open job ─▶│ ledger: 26     │              │
   │           │             │ items, queued  │              │
   │           │─ enqueue ───┼───────────────▶│              │
   │◀─ jobId ──│             │                │              │
   │                         │                │              │
   │◀════ WebSocket ═════════│                │              │
   │      snapshot, then     │                │─ 1 message ─▶│
   │      per-item updates   │                │  at a time   │
   │                         │                │              │
   │                         │◀─ startItem ───┼──────────────│
   │                         │                │              │  ┌──────────────┐
   │                         │                │              │──▶ SAME pipeline│
   │                         │                │              │  │ as §3 (D51)  │
   │                         │◀─ completeItem ┼──────────────│◀─┤ two blind    │
   │                         │                │              │  │ reads        │
   │◀════ progress ══════════│                │              │  └──────────────┘
```

**One item at a time, one message each.** A failure isolates to its submission
(NFR-6); a rate limit waits in place rather than releasing its slot, so failure
tracks the artwork rather than queue position (B-D14).

**Both paths call the same functions.** `rasteriseSubmission` for the pixels and
`verifySubmission` for the judgement. That is enforced by there being one of
each, not by two implementations agreeing — the batch used to short-circuit the
record read and the two paths could disagree about the same file (D51).

---

## 5. What is stored, and where

| Store | Holds | Lifetime |
|---|---|---|
| **D1** | submissions, extractions (with raw response, latency, tokens), verdicts, field verdicts, policy findings, decisions, the bitemporal policy archive, hash-chained `audit_event` | Kept. The audit table is append-only by trigger |
| **R2** | the filed PDF, the rasterised label crop | Purged by the retention sweep (D32) |
| **Durable Object** | the live ledger for one job | The job's lifetime |
| **Config (bundled)** | warning statement, policy set, approved models, user register | Versioned in git; reviewed, never edited at runtime (D45) |

Logs carry identifiers, classifications and timings — **never content** (D20).
That rule is why a failure cause names a field rather than quoting it.

---

## 6. The seams, and what each one buys

| Seam | Interface | Bought |
|---|---|---|
| **Provider** | `ExtractionProvider` | Two vendors behind one contract; B-Q4 becomes a controlled measurement rather than an argument (D34) |
| **Normaliser** | `Normaliser` | Browser Rendering today, a library call in a container tomorrow, with nothing above it changing (deployment-path §3) |
| **Region map** | `FormRegionMap` | A new form is data, not code — and a filing arriving without its record page is a second map, not a second pipeline (D50) |
| **Policy archive** | `ruleSetAsAt(validOn, asOf)` | A verdict is judged by the rules in force on its filing date, and can be rebuilt years later (D41, D42) |
| **Agent** | `Agent{kind,id}` | "Only a human decides" is a function the code calls, not a convention (D46) |

---

## 7. Where the governing principle is structural

The principle is *the model reads, the rules compare, the human decides*. It is
enforced in four places that a reviewer can check:

| Claim | Enforced by |
|---|---|
| The model never sees expected values | `ExtractionRequest` has no field for them; `CT-10` asserts it |
| The rules never call a model | `src/domain/**` imports no provider, no `fetch`, no clock |
| Only a human decides | `checkAgentMay` throws on `decision.recorded` / `policy.rule.enacted` for any non-human agent |
| No rule takes force without a named person | `validatePolicySet` refuses to load a model-drafted active rule with no approval — the worker will not start |

---

## 8. Not in the architecture, on purpose

Authentication (D14 — the staging gate is a cost control, not a login),
COLA integration (N1), a runtime policy editor (D45 — a rule changes by
reviewed commit), and per-agent productivity measurement (D47).

Each is a named absence with a decision behind it, not an oversight.
