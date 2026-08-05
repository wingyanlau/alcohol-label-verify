# Integration requirements, and how to deliver this

*Two questions a prototype exists to answer, and one it accidentally answered
better than expected.*

*`deployment-path.md` covers the **technical** port — Workers to container to
sovereign hosting, and what breaks at each step. This sits above it: what a real
integration must be given, what the organisation must do, and in what order.*

---

## 1. What building this discovered about integration

The most useful integration requirements were not designed. They fell out of
implementation, which is the point of a prototype.

### 1.1 The paper form cannot supply three of the four compared fields

**TTB F 5100.31 has no box for class/type designation, alcohol content, or net
contents.** Item 15 asks for such information only where it is embossed on the
container *and absent from the labels*. We found this by reading the real form's
AcroForm field rectangles while building the region map.

The consequence is a hard requirement rather than a preference:

> **A document-only integration cannot verify three of the four fields.** The
> expected values must come from COLA's *database*, not from the filed PDF.

The prototype models this with a second page — a "COLAs Online application
record" — carrying the structured fields. Whether COLA in fact captures them is
`Q-INT-08`, opened by this prototype, and it is the **first question to ask TTB**, because the
answer decides whether the product is a document checker or a database
comparator.

The system already behaves correctly when the data is absent: those fields
report `NOT_SUPPLIED` — *not assessed*, distinct from a pass — and every
regulation check still runs, because those read the label rather than the record.

### 1.2 Product type selects the body of law, so it cannot be inferred

Item 5 decides which regulations apply. Read it wrong and the submission is
judged against the wrong part of the CFR, producing findings that are
individually well-formed and entirely wrong, with nothing in the output showing
it. The prototype reads it as a closed classification and fails to *no product
type* on any ambiguity (D48).

> **Integration requirement:** product type must arrive as data with the
> application, not be inferred from artwork or free text.

### 1.3 Outbound network egress is a first-class constraint

Marcus: the agency firewall blocked the scanning vendor's ML endpoints and *"half
their features didn't work."* This is not a footnote; it is the reason the
provider seam exists (`ExtractionProvider`) and the reason stage 3 of the
deployment path is *self-hosted model*, not *different vendor*.

> **Integration requirement:** the inference dependency must be replaceable with
> an in-boundary model without touching verification logic. Verified by running
> the corpus through both and diffing verdicts.

### 1.4 What else a real integration must supply

| Needed | Prototype's stand-in | Why it cannot ship as-is |
|---|---|---|
| **Identity** | None (D14). Names on decisions are *declared* | An audit trail attributing a decision to an unverified string is not an audit trail. Prerequisite for US-19, US-20 |
| **Filing date** | Today's date | The rule set applied depends on it (D41). A backdated filing is judged by today's rules, which is wrong and currently invisible |
| **Application identifier** | A generated reference code | `Q-INT-06` — the record has no COLA/TTB id to join on |
| **Retention schedule** | Configurable window, demo default | `D32` — how long an agency may hold a submission is a records decision, not ours |
| **Policy approval workflow** | A reviewed commit to `config/policy-set.json` (D45) | Works, and needs a named approver with an identity to be meaningful |

---

## 2. What ports without change

Worth stating plainly, because it is the return on the design and it is
checkable rather than asserted.

| Layer | Ports? | Why |
|---|---|---|
| `src/domain/**` — comparison, warning, aggregation, policy | **Unchanged** | No clock, no I/O, no platform API, no vendor. It is the product |
| Extraction contract | **Unchanged** | Vendors sit behind it; two already do |
| Region maps | **Unchanged** | Data, not code |
| Policy archive | **Unchanged** | Plain SQL, bitemporal |
| Reference data | **Unchanged** | Config, digest-pinned |
| Orchestration (DO, Queue) | **Rewritten** | Five adapters — `deployment-path.md` §4 |
| Rasterisation | **Swapped** | Browser Rendering → a library call in a container |

---

## 3. Delivery approach

Four stages, each with an entry condition, an exit test, and the thing that
actually costs the time. Stage 1 is done.

```
  ┌─────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
  │ 1 PROTOTYPE │──▶│ 2 PORTABILITY│──▶│ 3 SOVEREIGN  │──▶│ 4 PRODUCTION │
  │   DONE      │   │   days       │   │   months     │   │  months–year │
  └─────────────┘   └──────────────┘   └──────────────┘   └──────────────┘
   pipeline works    abstraction        model inside      ATO, SSO,
   design is sound   holds — corpus     the boundary,     accessibility
                     diffs identical    retention real    governance
```

| Stage | Entry condition | Exit test | Dominated by |
|---|---|---|---|
| **1 Prototype** | — | 26-item corpus runs; every *Must* requirement maps to a passing test | **Complete** |
| **2 Portability** | A container platform and a decision to proceed | **Run the corpus on both and diff the verdicts. Identical means the port is correct** | Five adapters and a container image. Days |
| **3 Sovereign** | Egress policy confirmed; GPU capacity available | Corpus diffs identical against the self-hosted model; latency re-validated against S1 | Model hosting, capacity, retention schedule. Months |
| **4 Production** | ATO process started; identity provider chosen | Accessibility conformance; policy approval workflow with named approvers; monitoring | FedRAMP paperwork — Marcus reports eighteen months. Months to a year |

**Stage 2 must not be skipped**, and the reason is methodological: it is the only
stage whose sole purpose is to prove the abstraction, and it is cheap precisely
because nothing else changes at the same time. Change platform and model together
and any divergence is unattributable.

### 3.1 What to do before stage 2, in order

1. **Ask TTB whether COLA holds class/type, alcohol content and net contents**
   (§1.1). The answer changes the product. Nothing else is worth sequencing
   ahead of it.
2. **Run the corpus against both providers** and record accuracy and cost per
   submission. B-Q4 has been a question since the design; the measurement
   surface now answers it.
3. **Put the six drafted wine and malt rules through a named approval**, or
   delete them. They are currently loaded, visible and inert.
4. **Get one real agent in front of it for an hour.** No compliance agent has
   used this. The personas are drawn from interview notes, and interview notes
   are not observed use.

### 3.2 What would make this fail

Named, because a delivery plan that lists only steps is a wish.

| Risk | Why it is the one to watch | Mitigation in the design |
|---|---|---|
| **Adoption** | Dave has watched modernisation projects come and go, and the last vendor pilot was abandoned on latency alone | S1 is measured, not asserted. Evidence beside every verdict, so the tool argues rather than instructs |
| **A false pass** | It admits a non-compliant label. The costs are not symmetric with a false flag | `UNREADABLE` outranks everything; uncertainty routes to a human; no defaults are ever compared |
| **Egress blocked** | It killed half the last pilot's features | Provider seam; stage 3 exists for exactly this |
| **The record does not exist** | If COLA holds no structured fields, three of four comparisons cannot be made | §1.1 — ask first, build second |
| **Model drift** | A vendor repoints a stable name and every prior verdict cites a model that no longer exists | Fully-qualified identifiers (D29); a per-job fingerprint; the vendor's own served version recorded |
