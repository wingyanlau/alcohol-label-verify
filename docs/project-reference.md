# Project Reference — Stakeholders, Context, and Open Questions

*Discovery reference for the TTB label verification initiative. Consolidates what
the meeting notes actually establish, identifies who has not yet been consulted,
and lists what must be clarified before this moves beyond a prototype.*

| Field | Value |
|---|---|
| Status | Living document |
| Last updated | 2026-07-31 |
| Source material | `instructions/README.md` — four interviews plus written requirements |
| Companions | `design.md` · `test-plan.md` · `ui-design.md` |

### Evidence convention

Applied throughout. The distinction matters more than usual here, because the
source material is four conversations rather than a specification, and a
prototype built on inference should say so.

| Marker | Meaning |
|---|---|
| **[R]** | **Recorded** — stated directly in the source material |
| **[I]** | **Inferred** — a reading of the material, not stated |
| **[T]** | **Typical** — normal for an organisation of this type; **not established for TTB** and must be confirmed |
| **[?]** | **Unknown** — an open question |

Nothing marked **[T]** should be repeated to a stakeholder as fact. It indicates
where to ask, not what is true.

---

## 1. Programme Context

### 1.1 What the organisation does

| Fact | Evidence |
|---|---|
| ~150,000 label applications reviewed annually | **[R]** Sarah |
| 47 compliance agents handle the full volume | **[R]** Sarah |
| Over 100 agents in the 1980s; reduced by budget cuts | **[R]** Sarah |
| 5–10 minutes per straightforward application | **[R]** Sarah |
| Process substantially unchanged since COLA went online in 2003 | **[R]** Sarah |
| Peak-season importers file 200–300 applications at once | **[R]** Sarah |
| Roughly half of review work is literal field matching | **[R]** Sarah's framing |
| Applications are processed strictly one at a time today | **[R]** Sarah |

**Implied throughput:** ~3,190 applications per agent per year, ~13 per working
day. At 5–10 minutes each that is 1–2 hours of review per agent per day, which
suggests either substantial non-review workload or that complex cases dominate
the time. **[I]** — worth confirming, because the automation benefit case depends
on which.

### 1.2 Systems landscape

| System | What is known | Evidence |
|---|---|---|
| **COLA** | Certificate of Label Approval system. .NET. Online since 2003. The agents' primary work environment | **[R]** Sarah, Marcus |
| **Azure tenancy** | Migrated 2019. FedRAMP certification took ~18 months of process | **[R]** Marcus |
| **Network egress controls** | Outbound traffic to many domains blocked. Broke ML endpoint calls during the vendor pilot | **[R]** Marcus |
| **Prior scanning vendor** | Piloted last year. 30–40 seconds per label. Abandoned by agents | **[R]** Sarah |
| **COLA modernisation** | Assessed by a contractor last summer; quoted $4.2M; not funded | **[R]** Marcus |
| Formula/other TTB systems | Not mentioned. Label approval usually sits alongside formula approval and permit systems | **[T]** |
| Identity provider / agency SSO | Not mentioned. Assumed to exist | **[T]** |
| Document/records store | Not mentioned. Artwork must be stored somewhere today | **[?]** |

**Integration position for the prototype:** explicitly standalone, no COLA
integration, "a whole different beast with its own authorization requirements"
**[R]** Marcus.

### 1.3 Organisational memory — why adoption is the real risk

Two failed modernisations are cited unprompted, by different people:

| Precedent | Outcome | Cited by |
|---|---|---|
| Scanning vendor pilot, last year | 30–40s per label; agents reverted to manual | **[R]** Sarah |
| Automated phone system, 2008 | Intended to reduce call volume; increased it | **[R]** Dave |

**[I]** The organisation has a working memory of modernisation that made work
harder. Two of four interviewees raised it without being asked. This is a change
-management fact, not a technical one, and it means the tool must be
*demonstrably* faster than eyeballing on first contact — there is no goodwill
budget to draw down.

---

## 2. Stakeholder Register

### 2.1 Consulted

| Name | Role | Interest | Influence | Position | Needs | Risk if unaddressed |
|---|---|---|---|---|---|---|
| **Sarah Chen** | Deputy Director, Label Compliance | Throughput; team-wide adoption | **High** — business owner | Sponsor. AI interest originated with leadership | Sub-5s results; batch; usable by the whole team | Sponsor withdrawal; the initiative has no other advocate |
| **Marcus Williams** | IT Systems Administrator | Deployability within federal constraints | **High** — technical gatekeeper | Cooperative, realistic, weary of process | No COLA coupling; no sensitive data; network-realistic | Blocked at deployment; egress constraint is his to enforce |
| **Dave Morrison** | Senior Compliance Agent, 28 yrs | Not being slowed or overruled | **High informally** — opinion leader | Sceptical, open, not hostile | Tolerance for trivial variance; speed; judgment preserved | **Quiet non-adoption.** He does not need to object to defeat this |
| **Jenny Park** | Junior Compliance Agent, 8 mths | Replacing manual checklist work | Low formally, **high as advocate** | Enthusiastic early adopter | Exact warning verification; tolerance of imperfect photos | Loss of the only unambiguous champion |

**[I] Dave is the critical stakeholder, not Sarah.** Sarah can mandate the tool;
Dave determines whether it is used. His stated failure mode — "just don't make my
life harder" — is satisfied by silence rather than approval, and quiet
abandonment is precisely how the previous pilot ended.

### 2.2 Named but not consulted

| Name / group | Relevance | Action |
|---|---|---|
| **Janet**, Seattle office | Named as the long-standing requester of batch upload **[R]** | Primary user of the batch feature; **has never been interviewed**. Batch is being designed to a second-hand requirement |
| **Leadership** | Originated the interest in AI **[R]** Sarah | Success criteria unknown. Sarah's operational goals may not match theirs |
| **The other ~43 agents** | The actual user population | Four data points, three of them from one office **[I]** |
| Seattle and other field offices | Distinct workflows implied by Janet's separate ask **[I]** | Regional practice variation unassessed |
| The 2008 phone-system owners | Organisational precedent | Worth understanding what went wrong; the lesson is free |

### 2.3 Not consulted, and expected in a programme of this type **[T]**

*None of these appear in the source material. In a federal system that applies AI
to a regulatory determination, each would normally hold a gate. Their absence
from discovery is itself a finding.*

| Function | Why they matter here | Likely gate |
|---|---|---|
| **ISSO / Information System Security Officer** | FISMA categorisation, control selection, authority to operate | **Blocking** for any deployment |
| **Privacy Officer** | Applicant and business data; whether a Privacy Impact Assessment is triggered | **Blocking** |
| **Records Management / NARA liaison** | Whether a verification result is a federal record; retention schedule for the audit trail (§8.7) | **Blocking** once records persist |
| **Office of Chief Counsel** | Whether an automated finding carries legal weight in a regulatory determination | **Blocking** — see §4.5 |
| **AI governance / CAIO function** | Federal AI use policy: inventory, impact assessment, human-oversight requirements | **Blocking**; also determines classification |
| **Section 508 programme office** | Accessibility conformance is a legal obligation, not a quality goal | **Blocking** |
| **COLA system owner** | Owns the system this must eventually integrate with | Blocking at integration |
| **Enterprise architecture** | Standards, platform, tooling | Advisory to blocking |
| **Procurement / contracting** | If a model service is purchased; FedRAMP status of any provider | Blocking for a hosted model |
| **Labour relations / union** | Automation affecting the work of bargaining-unit employees | **[T]** Often a formal notification obligation |
| **Training / knowledge management** | Half the team is over 50 with mixed confidence **[R]** | Non-blocking, adoption-critical |
| **Service desk** | First contact when the tool misbehaves | Non-blocking |
| **Data owner for label artwork** | Who authorises artwork leaving the agency boundary | **Blocking** — see Q-SEC-01 |

**[I] The single most consequential gap is AI governance.** A system that assists
a regulatory determination affecting a business's ability to sell a product is
plausibly within scope of federal policy on rights-impacting AI, which typically
carries impact-assessment, human-oversight, and inventory obligations. Design
decisions already taken — N7 (the system never decides), FR-10 (evidence always
shown), §8.7 (full provenance) — align with those obligations, but **alignment by
accident is not compliance**, and the controlling policy needs to be identified
rather than assumed.

---

## 3. Requirements Traceable to Individuals

Consolidated for follow-up; the authoritative list is `design.md` §3.

| Requirement | Source | Nature |
|---|---|---|
| Results in under 5 seconds | Sarah | Hard threshold, learned from the failed pilot |
| Usable by a low-confidence computer user | Sarah | "Something my mother could figure out" |
| Batch upload, 200–300 items | Sarah, on Janet's behalf | Second-hand |
| Tolerance for trivial presentation variance | Dave | `STONE'S THROW` / `Stone's Throw` |
| Exact warning wording; header in capitals | Jenny | Rejected a title-case label last month |
| Tolerance of imperfect photographs | Jenny | Flagged by her as possibly out of scope |
| No COLA integration | Marcus | Firm |
| No sensitive data retention | Marcus | Firm for the prototype |
| Network egress constraints | Marcus | Real; **not satisfied** by a hosted-model prototype |

---

## 4. Open Questions

*Grouped by the function that would answer them. Priority reflects what blocks
progress beyond a prototype, not what blocks the prototype itself.*

### 4.1 Business process and scope

| ID | Question | Why it matters | Ask |
|---|---|---|---|
| Q-BUS-01 | What does an agent do with a flagged discrepancy — reject, query the applicant, escalate? | The tool's output must fit an existing decision path, not invent one | Sarah, Dave |
| Q-BUS-02 | What proportion of applications are rejected today, and for which causes? | Establishes whether field mismatches are even the dominant failure mode | Sarah |
| Q-BUS-03 | Which beverage classes dominate volume? | Class-specific rules are out of scope (N5); volume determines whether that is acceptable | Sarah |
| Q-BUS-04 | Are front and back labels submitted separately, or as one image? | **Directly determines whether assumption A2 holds.** The warning is commonly on the back | Sarah, Jenny |
| Q-BUS-05 | What formats does artwork arrive in — PDF, TIFF, JPEG? | Assumption A6 assumes images; PDF is likely | Marcus, Jenny |
| Q-BUS-06 | Where does application data live in machine-readable form? | Determines the real intake path once COLA integration is on the table | COLA system owner |
| Q-BUS-07 | What does leadership consider success — throughput, backlog, cost, accuracy? | Sarah's operational goals may not be the funding rationale | Leadership via Sarah |
| Q-BUS-08 | What is Janet's batch workflow, in her own words? | Batch is being designed to a second-hand account | **Janet — interview directly** |

### 4.2 Data and integration

| ID | Question | Why it matters | Ask |
|---|---|---|---|
| Q-INT-01 | What is COLA's integration surface — API, database, file export? | Determines feasibility and cost of the eventual integration | COLA system owner |
| Q-INT-02 | Is the $4.2M modernisation likely to be revived? | A rebuild would change the target entirely | Marcus |
| Q-INT-03 | Where is label artwork stored, and under what access controls? | Production reads from the system of record rather than uploads (§15.1) | Records, COLA owner |
| Q-INT-04 | Is there an existing agency ML or AI platform? | May be mandated; changes the model-hosting question | EA, IT |
| Q-INT-05 | Are there adjacent systems — formula approval, permits — with the same need? | Affects scope and the business case | EA |

### 4.3 Security

| ID | Question | Why it matters | Ask |
|---|---|---|---|
| Q-SEC-01 | **May label artwork leave the agency boundary at all?** | If not, hosted inference is dead on arrival and on-premise models are mandatory, not preferable | ISSO, data owner |
| Q-SEC-02 | What FISMA categorisation would this system carry? | Determines the control baseline and the effort to authorise | ISSO |
| Q-SEC-03 | Is a full ATO required, or can it run under an existing boundary? | The difference between months and a year **[T]** | ISSO |
| Q-SEC-04 | Which model providers, if any, are FedRAMP authorised and approved for use? | Constrains provider choice absolutely | ISSO, procurement |
| Q-SEC-05 | What are the egress exception criteria, and has one ever been granted? | Marcus states the block as fact; the exception path is unknown | Marcus, network security |
| Q-SEC-06 | What audit-log integrity requirements apply — tamper-evidence, WORM? | Affects the §8.7 record design once persisted | ISSO, records |
| Q-SEC-07 | Is a penetration test or security assessment required before pilot use? | Schedule impact | ISSO |

### 4.4 Privacy and records

| ID | Question | Why it matters | Ask |
|---|---|---|---|
| Q-PRV-01 | Does label artwork or application data constitute PII or protected business information? | Determines whether a PIA is triggered and what retention applies | Privacy Officer |
| Q-PRV-02 | Is a verification result a federal record? | If so, retention is scheduled and disposal is regulated — the prototype's "store nothing" posture cannot carry forward | Records Management |
| Q-PRV-03 | What retention schedule applies to the audit trail? | Drives storage design and cost | Records Management |
| Q-PRV-04 | Is a SORN or PIA update needed? | **[T]** Lead time is typically months | Privacy Officer |
| Q-PRV-05 | May applicant-submitted artwork be used to evaluate or improve a model? | A commonly assumed permission that is often absent | Privacy, OCC |

### 4.5 Legal, compliance, and AI governance

| ID | Question | Why it matters | Ask |
|---|---|---|---|
| Q-LEG-01 | **Does this fall within federal policy on rights-impacting AI?** | Would impose impact-assessment, human-oversight, and inventory obligations. **Identify the controlling policy — do not assume** | AI governance / CAIO, OCC |
| Q-LEG-02 | Must an applicant be told an automated tool assisted the review? | Notice obligations are common for automated decision support **[T]** | OCC |
| Q-LEG-03 | Can an automated finding support a rejection, or must a human independently verify? | **Validates or invalidates N7.** The current design assumes the latter | OCC, Sarah |
| Q-LEG-04 | Is there an appeal path where the tool's reasoning could be challenged? | Determines the evidentiary standard the audit record must meet | OCC |
| Q-LEG-05 | Which CFR parts are in scope beyond Part 16? | Part 16 covers the warning only; class-specific labelling rules sit elsewhere | Sarah, OCC |
| Q-LEG-06 | Who owns and approves changes to encoded rules (§8.6)? | Rule authorship is a compliance judgment, not an engineering one | Sarah, OCC |
| Q-LEG-07 | **Does any tolerance apply to alcohol content, label versus application?** | Exactness may manufacture false discrepancies on compliant labels — Dave's objection via the numeric path. *Also test-plan Q7* | Sarah, OCC |

### 4.6 Accessibility

| ID | Question | Why it matters | Ask |
|---|---|---|---|
| Q-ACC-01 | What Section 508 conformance evidence is required — ACR/VPAT? | A legal obligation for federal systems, not a quality target | 508 programme office |
| Q-ACC-02 | Are there known assistive-technology users among the 47 agents? | Moves specific accommodations from theoretical to required | Sarah, 508 office |
| Q-ACC-03 | Is accessibility testing centrally provided? | Avoids duplicating a service that exists | 508 office |

### 4.7 Operations and workforce

| ID | Question | Why it matters | Ask |
|---|---|---|---|
| Q-OPS-01 | Who would operate and support this in production? | An unowned system is not deployable | Marcus |
| Q-OPS-02 | What availability is expected? | Drives architecture and cost | Sarah, Marcus |
| Q-OPS-03 | What is the acceptable cost per application? | 150,000/year makes per-call inference cost material | Sarah, finance |
| Q-OPS-04 | Who owns model performance monitoring and re-evaluation over time? | A model-governance role that typically has no owner at pilot stage **[T]** | Marcus, AI governance |
| Q-OPS-05 | Does automating review work trigger a labour-relations obligation? | **[T]** Common where bargaining-unit work changes | HR, labour relations |
| Q-OPS-06 | How will agents be trained, and by whom? | Mixed technical confidence is a stated fact | Training, Sarah |
| Q-OPS-07 | What is the pilot-to-production path and its decision criteria? | Prevents an indefinite pilot | Sarah, leadership |

### 4.8 Immediate — answerable now, affects the prototype

| ID | Question | Blocks |
|---|---|---|
| Q-NOW-01 | Confirm the statutory warning text against the primary source | FR-5 correctness (design Q1a) |
| Q-NOW-02 | Front/back label practice — Q-BUS-04 | Assumption A2; risk R7 |
| Q-NOW-03 | Alcohol content tolerance — Q-LEG-07 | Comparison rules; test UT-A06 |

---

## 5. Assumptions Requiring Validation

Full register in `design.md` §4.2. Those with an external owner:

| Assumption | Owner | Consequence if wrong |
|---|---|---|
| One image contains every field under review (A2) | Sarah, Jenny | False discrepancies on the zero-tolerance check |
| Artwork is images, not PDFs (A6) | Marcus | A rendering stage is required at intake |
| Agent is trusted at the network perimeter (A5) | ISSO | Identity becomes a prerequisite |
| English-only labels (A3) | Sarah | Extraction and comparison both need rework |
| Common field set is sufficient (A4) | Sarah, OCC | Verification is materially incomplete |

---

## 6. Engagement Plan

**[I]** Ordered by what unblocks the most.

| Priority | Who | Purpose |
|---|---|---|
| 1 | **ISSO / security** | Q-SEC-01 governs the entire architecture. If artwork cannot leave the boundary, hosted inference is not an option and everything downstream changes |
| 2 | **AI governance / CAIO** | Q-LEG-01 determines the compliance regime. Cheaper to learn now than after build |
| 3 | **Janet** | The batch requirement's actual owner, never interviewed |
| 4 | **Dave, again** | The adoption risk. Involve him in evaluating output, not just in requirements |
| 5 | **Privacy and Records** | Q-PRV-02 and Q-PRV-03 shape the audit design |
| 6 | **OCC** | Q-LEG-03 validates or invalidates N7, the design's central posture |
| 7 | **COLA system owner** | Not yet needed; needed before any integration commitment |
| 8 | **508 programme office** | Confirm conformance evidence expectations early; retrofits are expensive |

**[I] Recommended sequencing:** Q-SEC-01 and Q-LEG-01 before any production
commitment. Both can invalidate architectural decisions that are cheap to change
now and expensive later. Neither blocks the prototype.

---

## 7. How This Bears on the Prototype

The prototype proceeds under the stated assumptions and is not blocked by any
question above. Its value is partly in making these questions concrete and
askable — several only became visible by attempting a design.

| Finding | Prototype position |
|---|---|
| Egress restriction (Q-SEC-01) | Documented limitation with a named remedy (design §8.7.3) |
| AI governance regime (Q-LEG-01) | Design aligns with typical obligations by accident, not by verification. Stated as such |
| Front/back labels (Q-BUS-04) | Assumption A2, risk R7, test KL-01 — reproduced rather than hidden |
| Records and retention (Q-PRV-02) | "Produce always, store never" defers the question honestly (design §8.7.4) |
| Rule ownership (Q-LEG-06) | Policy externalised as configuration; rules authored by humans, never derived by a model (D17) |
| Adoption risk (Dave) | Evidence shown with every verdict; stated rules; no false-mismatch tolerance |

**[I]** For a take-home submission, the substance of this document is that the
brief's four interviews are a partial picture, and the parties who would gate a
real deployment — security, privacy, records, counsel, AI governance,
accessibility — do not appear in it at all. Noticing that is worth more than any
individual answer.

---

## 8. Verified Agency Context

*Gathered from ttb.gov and the CFR on 2026-07-31 and 2026-08-01. The four
interviews in the brief are a characterisation of TTB, not TTB itself; this
section records what the agency actually publishes. A fifth evidence marker
applies throughout:*

| Marker | Meaning |
|---|---|
| **[V]** | **Verified** — published by TTB or in the CFR |

Where **[V]** contradicts §1, the published source wins.

### 8.1 What TTB is

| Fact | Evidence |
|---|---|
| A bureau of the U.S. Department of the Treasury | **[V]** |
| Enforces federal law on the production, labelling and taxation of alcohol and tobacco; also collects excise tax on firearms and ammunition | **[V]** |
| Collected over **$18 billion** in excise taxes in FY 2023 | **[V]** |
| Label approval serves tax collection *and* market integrity — product identification, correct tax classification, consumer protection | **[V]** |

**[I]** This reframes the stakes. Class/type designation determines **tax
classification**, so a misdescribed product is a revenue question as well as a
consumer-protection one. The cost of a false pass is higher than the brief
conveys.

### 8.2 The COLA process as TTB describes it

| Fact | Evidence |
|---|---|
| The instrument is a **Certificate of Label Approval (COLA)**, applied for on **TTB F 5100.31** | **[V]** |
| Filed through **COLAs Online**, a paperless web system | **[V]** |
| The **Alcohol Labeling and Formulation Division (ALFD)** processes COLAs for malt beverages and distilled spirits | **[V]** |
| Related instruments: certificate of **exemption**, and **distinctive liquor bottle** approval. Exemptions are not issued for imported bottles or malt beverages | **[V]** |
| Approved applications are **available for public inspection** | **[V]** |
| Processing times are published as **median calendar days** — half take longer | **[V]** |
| **myTTB** is the modernisation platform intended to replace legacy systems | **[V]** |
| FY 2025 satisfaction: 83% COLAs Online, 81% Formulas Online | **[V]** |
| **No AI or automation appears anywhere in TTB's description of label review** | **[V]** |

### 8.3 The finding that most affects this design — "Needs Correction"

**An application TTB cannot approve as submitted is not rejected. It is returned
with the status `Needs Correction` and a list of the corrections required.** The
submitter then has **30 calendar days**; failure to correct results in automatic
denial and a status of `Rejected`. **[V]**

This answers **Q-BUS-01** and validates the design more strongly than the
interviews did:

| Design element | Fit with the actual workflow |
|---|---|
| Per-field verdicts showing both values (FR-10) | **Is** the correction list the agent must produce |
| N7 — the system never approves or rejects | Correct. The agent's normal action is neither: it is *return for correction* |
| `INCOMPLETE` as a distinct outcome (D5) | Maps to requesting better artwork — a correction request, not a denial |
| The rule line naming the tolerance applied | Explains to an applicant *why* something was or was not flagged |

**[I]** The output of this tool is, almost exactly, a draft correction list.
That is a stronger product framing than "verification", and it belongs in the
README.

### 8.4 Mandatory label information — distilled spirits

| Requirement | Evidence |
|---|---|
| **Brand name, alcohol content and class/type must appear in the same field of vision** | **[V]** |
| That label may be on the front, back or side of the container | **[V]** |
| **The health warning statement may appear anywhere on the label** | **[V]** |
| Where a product is not sold under a brand name, the bottler's, distiller's or importer's name is treated as the brand name | **[V]** |
| Name and address (city and state) of bottler, distiller, processor or importer is mandatory | **[V]** |
| Further mandatory items by product: neutral spirits, coloring or treatment with wood, FD&C Yellow #5, aspartame, carmine or cochineal, sulfite declaration, commodity statement, age statement, state of distillation | **[V]** |
| TTB publishes **checklists of mandatory label information** for wine, spirits and malt beverages | **[V]** |
| TTB publishes an interactive **"Anatomy of a Label"** tool | **[V]** |

**Three consequences.**

*The published checklists are almost certainly Jenny's printed checklist.* The
brief describes an agent working from a paper list; TTB publishes exactly that.
UI principle P4 — results in checklist order — should follow **TTB's** published
order rather than an invented one.

*"May appear anywhere" confirms R7.* The three compared fields must share a field
of vision; the warning need not. Assumption A2 is now **known** unsafe rather
than suspected — though see §8.10, since affixing the complete label set to one
page substantially mitigates it.

*"Same field of vision" is a checkable requirement the design does not check.*
It is spatial, so it needs bounding boxes from extraction rather than text alone.
Out of scope (N5), but a concrete next step — the kind of check a human does
effortlessly and a text-only pipeline cannot do at all.

### 8.5 Alcohol content tolerance — resolves Q7 and Q-LEG-07

**The tolerance applies to actual contents versus the label, not to the label
versus the application.**

| Provision | Tolerance | Applies to |
|---|---|---|
| 27 CFR 5.65 | ± 0.3 percentage points | Actual alcohol content vs. what the label states |
| 27 CFR 5.37(b) | 0.15% loss permitted; **no tolerance for an increase** | Internal Revenue Code purposes |
| 27 CFR 4.36, 7.71 | Parallel provisions | Wine, malt beverages |

**[I] Neither applies to this system.** Both concern laboratory-measured
contents against a printed claim. Comparing a *printed* value against an
*application* value has no tolerance provision, because both are statements of
the same intended figure — there is nothing to vary.

> **Q7 and Q-LEG-07 resolve to: exact numeric comparison is correct.**

Test-plan `UT-A06` and `UT-Q07` can therefore be implemented as exact rather than
left pending, with this citation as the justification.

### 8.6 Common errors TTB itself identifies

| Error | Evidence |
|---|---|
| **Net contents incorrectly stated** is among the most common problems on beer/malt label applications, and requires a correction before a COLA is issued | **[V]** |
| Formula applications commonly omit required supporting documentation | **[V]** |
| TTB directs applicants to the mandatory-information checklists specifically to prevent these | **[V]** |

**[I]** Net contents leading the error categories is useful validation: it is one
of the four compared fields, machine-checkable, and exactly the transcription
slip automated matching removes.

### 8.7 Fields on Form 5100.31 — a gap in the current design

| Item | Field | Note |
|---|---|---|
| 6 | **Brand name** | Modelled |
| 7 | **Fanciful name** | **Not modelled.** Required for some specialty products; must not be conflated with the brand name |
| — | Class/type designation | **Not on the form** |
| — | Alcohol content | **Not on the form** |
| — | Net contents | **Not on the form** — Item 15 asks for it only where embossed on the container *and absent from the labels* |
| — | Name and address of bottler/distiller/importer | **Not modelled** |
| Pages 3–4 | The list of allowable label revisions | Printed on the form itself |

**The paper form has no field for three of the four values under comparison.**
The brief's *"ABV is correct? Check"* cannot be a form-versus-label comparison —
there is nothing on the form to compare against. Either COLAs Online captures
structured data the paper form does not, or the brief simplified. This is why the
test corpus has a second page modelling the electronic record, and it is a
question for Sarah.

### 8.8 TTB does not routinely check what we chose not to check

> *"TTB does not routinely review submitted labels for compliance with applicable
> requirements for mandatory label information regarding type size, characters
> per inch, or contrasting background."* — TTB F 5100.31, §II.C **[V]**

It remains the applicant's responsibility, with TTB reserving the right to
review.

**[I] This is the strongest justification N4 and FR-6a have.** The prototype
defers exactly what TTB itself defers — a much better argument than "image
metrics are unreliable", and it belongs in the README.

### 8.9 Allowable revisions — a category the prototype does not model

Once approved, certain changes may be made **without a new COLA**: repositioning
text or graphics, adding bottling or production dates, adding an internet
address, and others listed on pages 3–4 of the form. TTB provides an **Allowable
Changes Sample Label Generator**. **[V]**

**[I]** This implies a review task the design does not contemplate — comparing a
*revised* label against a *previously approved* one and deciding whether the
differences fall within the allowable set. That is label-against-label rather
than label-against-application, and a plausible second product.

### 8.10 What the affixed label set does to R7

The form instructs the applicant to **"AFFIX COMPLETE SET OF LABELS BELOW"**.
Front and back labels are therefore on one submission page. **[V]**

**[I] This substantially reduces R7.** If the system ingests the whole submission
page rather than a standalone label image, the back label — and its warning
statement — is present. Assumption A2 fails only where the tool is handed a
*cropped front-label image* instead of the submission. Corpus case L12 models an
*incomplete submission* (front label only), where reporting the warning missing
is the correct finding rather than a false positive.

### 8.11 Calibrating the brief against reality

| Brief states | Status |
|---|---|
| ~150,000 applications per year | Not verified against published figures. Plausible; treat as the brief's premise |
| 47 compliance agents | Not verified. The brief's premise |
| COLA online since 2003 | Consistent with COLAs Online being long-established **[V]**; date unverified |
| .NET system, Azure since 2019 | Not published. The brief's premise |
| The process is manual and unaided | **Consistent with [V]** — no automation appears in TTB's description of label review |

**[I]** The brief is a realistic characterisation, not a documentary one. Its
process description holds up; its figures should be attributed to the brief
rather than asserted as fact.

### 8.12 References

| Source | Used for |
|---|---|
| [About TTB](https://www.ttb.gov/about-ttb) | §8.1 |
| [Certificate of Label Approval](https://www.ttb.gov/alfd/certificate-of-label-aproval-cola) | §8.2 |
| [Alcohol Labeling and Formulation Division](https://www.ttb.gov/about-ttb/who-we-are/offices/alcohol-labeling-and-formulation-division) | §8.2 |
| [COLAs and Formulas Online FAQs](https://www.ttb.gov/faqs/colas-and-formulas-online-faqs) | §8.3 |
| [Distilled Spirits: Mandatory Label Information](https://www.ttb.gov/regulated-commodities/beverage-alcohol/distilled-spirits/ds-labeling-home/ds-brand-label) | §8.4 |
| [Distilled Spirits: Alcohol Content](https://www.ttb.gov/regulated-commodities/beverage-alcohol/distilled-spirits/ds-labeling-home/ds-alcohol-content) | §8.5 |
| [27 CFR Part 5](https://www.ecfr.gov/current/title-27/chapter-I/subchapter-A/part-5) | §8.5 |
| [Avoiding Common Errors](https://www.ttb.gov/public-information/news/avoiding-common-errors) | §8.6 |
| [TTB F 5100.31](https://www.ttb.gov/system/files/images/pdfs/forms/f510031.pdf) | §8.7, §8.8, §8.10 — retrieved and read directly |
| [List of Allowable Changes](https://www.ttb.gov/regulated-commodities/labeling/allowable-revisions) | §8.9 |
