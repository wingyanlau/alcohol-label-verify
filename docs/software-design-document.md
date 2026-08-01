# Software Design Document

> **How to use this template**
> Fill sections top to bottom. Each section opens with an italic statement of its
> purpose and a set of prompting questions. Answer the questions in prose or
> tables — then delete the italic guidance.
>
> Mark any section that genuinely does not apply as **N/A** with a one-line
> reason. Do not delete it: an explicit N/A proves the concern was considered,
> a missing section proves nothing.
>
> Sections marked **[Core]** must be complete before implementation begins.
> Sections marked **[Deferred]** may be drafted as open questions and resolved
> during the build.

| Field | Value |
|---|---|
| Project | |
| Author | |
| Status | Draft / In review / Approved |
| Created | |
| Last updated | |
| Reviewers | |

---

## 1. Context and Problem Statement **[Core]**

*Why this project exists. A reader with no background should finish this section
understanding the problem without yet knowing the solution.*

### 1.1 Background

- What situation prompted this work?
- Who currently does this job, and how?
- What does it cost them today — time, error rate, money, morale?

### 1.2 Problem statement

*One paragraph, no solution language. If the sentence contains the name of a
technology, it is a solution statement, not a problem statement.*

### 1.3 Stakeholders

| Stakeholder | Role | Primary interest | How success is judged by them |
|---|---|---|---|
| | | | |

### 1.4 Definitions and domain glossary

*Domain terms, acronyms, and any word this document uses in a narrower sense
than plain English. Ambiguous vocabulary is a leading cause of built-wrong.*

| Term | Definition | Source |
|---|---|---|
| | | |

---

## 2. Goals, Non-Goals, and Success Criteria **[Core]**

*The scope fence. Everything later in this document is justified by reference
to this section.*

### 2.1 Goals

*Ordered by priority. If two goals conflict, the higher one wins — state that
resolution explicitly rather than leaving it to be discovered mid-build.*

| # | Goal | Priority | Rationale |
|---|---|---|---|
| G1 | | Must / Should / Could | |

### 2.2 Non-goals

*What this project deliberately will not do, and why. This section protects
scope and is the first thing a reviewer should read.*

| # | Non-goal | Why excluded | Revisit when |
|---|---|---|---|
| N1 | | | |

### 2.3 Success criteria

*Observable, measurable statements. "Fast" is not a criterion; "p95 under 5s
on a 2 MB image" is. Each should be checkable by someone who did not build it.*

| # | Criterion | Measurement method | Target | Traces to |
|---|---|---|---|---|
| S1 | | | | G1 |

---

## 3. Requirements **[Core]**

*Every requirement gets a stable ID and a named source. Requirements without a
source are assumptions in disguise — move them to §4.2.*

### 3.1 Requirement sources

*Where requirements come from: documents, interviews, regulations, inferred.
List them so each requirement below can cite one.*

| Source ID | Description | Type | Authority |
|---|---|---|---|
| SRC-1 | | Written spec / Interview / Regulation / Inferred | |

### 3.2 Functional requirements

| ID | Requirement | Priority | Source | Acceptance test | Status |
|---|---|---|---|---|---|
| FR-1 | | Must / Should / Could / Won't | SRC-1 | | Open |

### 3.3 Non-functional requirements

*Group by concern. Each needs a number, not an adjective.*

| ID | Category | Requirement | Target / threshold | Source | Verification method |
|---|---|---|---|---|---|
| NFR-1 | Performance | | | | |
| NFR-2 | Usability / accessibility | | | | |
| NFR-3 | Reliability | | | | |
| NFR-4 | Security / privacy | | | | |
| NFR-5 | Scalability | | | | |
| NFR-6 | Maintainability | | | | |
| NFR-7 | Observability | | | | |
| NFR-8 | Cost | | | | |

### 3.4 Explicitly out of scope

*Requirements that were raised and consciously rejected. Distinct from §2.2:
non-goals are strategic, these are specific asks that were turned down.*

| Ask | Raised by | Decision | Reason |
|---|---|---|---|

### 3.5 Traceability check

*Before leaving this section, confirm every source in §3.1 has produced at least
one requirement, and every goal in §2.1 is served by at least one requirement.
Note any gaps here rather than discovering them at review.*

---

## 4. Constraints and Assumptions **[Core]**

### 4.1 Constraints

*Fixed conditions that limit the solution space and are not negotiable by this
project — time, budget, platform, regulation, existing systems, team skills.*

| ID | Constraint | Type | Imposed by | Design impact |
|---|---|---|---|---|
| C1 | | Technical / Organisational / Legal / Temporal | | |

### 4.2 Assumptions

*Things believed true but unverified. Each needs an owner, a way to validate,
and a statement of what breaks if it turns out false.*

| ID | Assumption | Confidence | Validation method | Impact if wrong |
|---|---|---|---|---|
| A1 | | High / Medium / Low | | |

### 4.3 Dependencies

| Dependency | Type | Owner | Risk if unavailable | Fallback |
|---|---|---|---|---|
| | Internal / Third-party / Data / Human | | | |

---

## 5. Users and Use Cases **[Core]**

*Design follows from who is doing what, under what conditions. Skipping this
section produces software that is correct and unusable.*

### 5.1 Personas

| Persona | Representative of | Technical comfort | Context of use | Key need | Key fear |
|---|---|---|---|---|---|
| | | | | | |

### 5.2 Primary use cases

*One subsection per use case. Keep these solution-agnostic — describe what the
user is trying to achieve, not which button they press.*

**UC-1: <name>**

- **Actor:**
- **Trigger:**
- **Preconditions:**
- **Main flow:**
- **Alternate flows:**
- **Failure flows:**
- **Postconditions:**
- **Frequency / volume:**
- **Traces to:** FR-*

### 5.3 User journey and interaction principles

*The end-to-end path, and the interaction rules that follow from §5.1. If a
persona has low technical comfort or works under time pressure, state the design
consequence here rather than leaving it to the implementer's taste.*

### 5.4 Accessibility requirements

*Concrete standard to meet, and the specific accommodations the personas imply.*

---

## 6. Solution Overview **[Core]**

*The first section permitted to discuss a solution. A reader should be able to
stop here and correctly describe what is being built.*

### 6.1 Approach summary

*Three to five sentences. What the system does, for whom, built roughly how.*

### 6.2 System context diagram

*The system as one box, with every external actor and system it exchanges data
with. Establishes the trust and control boundaries used throughout §8 and §10.*

```
<diagram>
```

### 6.3 Scope boundary

*Precisely which parts of the diagram this project builds, integrates with, or
merely assumes exist.*

---

## 7. Alternatives Considered **[Core]**

*Written before the detailed design, not after it. Reviewers judge a design
largely by the quality of the options it rejected.*

| Option | Summary | Pros | Cons | Verdict |
|---|---|---|---|---|
| A | | | | Chosen / Rejected |

**Rationale for the chosen option:**

**What would change the decision:**

---

## 8. Detailed Design

### 8.1 Architecture **[Core]**

*Components, responsibilities, and the boundaries between them. State the
architectural style and why it suits the constraints in §4.1.*

```
<diagram>
```

| Component | Responsibility | Owns | Depends on | Rationale for separation |
|---|---|---|---|---|
| | | | | |

### 8.2 Data model **[Core]**

*Entities, attributes, relationships, lifetimes. Include what is deliberately
not persisted — for privacy-sensitive systems that is the more important half.*

| Entity | Attributes | Persisted? | Lifetime | Retention / deletion rule |
|---|---|---|---|---|
| | | | | |

### 8.3 Interfaces and contracts **[Core]**

*Every boundary the system exposes or consumes. For each: shape of request and
response, error cases, idempotency, versioning.*

| Interface | Type | Consumer | Contract | Error modes |
|---|---|---|---|---|
| | HTTP / CLI / Event / Library | | | |

### 8.4 Core algorithms and business logic **[Core]**

*The parts a competent engineer could not infer from the requirements alone.
Each subsection should state the rule, the edge cases, and the tie-breaks.
Anything involving judgment, tolerance, or ranking belongs here, written
precisely enough to be testable.*

### 8.5 External service integration

*For each third-party or model dependency: what it is asked to do, what its
failure modes are, how the system degrades when it is slow or unavailable, and
how its output is validated before being trusted.*

| Service | Purpose | Failure mode | Detection | Degradation strategy | Output validation |
|---|---|---|---|---|---|
| | | | | | |

### 8.6 State management and concurrency **[Deferred]**

*Where state lives, what happens under simultaneous use, and which operations
must be atomic, idempotent, or ordered.*

---

## 9. Cross-Cutting Concerns

*The section that exists to stop concerns falling between components. Complete
each or mark it N/A with a reason.*

### 9.1 Performance **[Core]**

- Budget per operation, apportioned across the components in §8.1
- Where time is expected to go, and the measurement plan that confirms it
- Behaviour under load and at the largest realistic input size
- Caching, batching, concurrency limits, and what the user sees while waiting

### 9.2 Error handling and resilience **[Core]**

*Enumerate failure classes and define the response to each. The default answer
must never be an unhandled exception reaching the user.*

| Failure class | Example | Detection | System response | User-visible message | Recoverable? |
|---|---|---|---|---|---|
| Invalid input | | | | | |
| Degraded input quality | | | | | |
| Dependency failure | | | | | |
| Timeout | | | | | |
| Internal error | | | | | |

**Principles:** *e.g. never silently discard a unit of work; distinguish "could
not process" from "processed and found a problem"; make every failure actionable.*

### 9.3 Security and privacy **[Core]**

- Trust boundaries and where input becomes trusted
- Input validation and resource-exhaustion limits
- Sensitive data: what is collected, where it travels, how long it lives
- Secrets management
- AuthN / AuthZ, or an explicit statement that there is none and why that is acceptable
- Applicable regulatory obligations
- Threat model: the handful of realistic abuse cases and the mitigation for each

### 9.4 Observability **[Deferred]**

- What is logged, at what level, and what must never be logged
- Metrics that would reveal the system misbehaving
- How a specific user-reported failure is traced after the fact

### 9.5 Configuration and environments

| Setting | Purpose | Default | Where set | Secret? |
|---|---|---|---|---|
| | | | | |

### 9.6 Internationalisation and localisation **[Deferred]**

### 9.7 Cost model **[Deferred]**

*Per-operation and at-scale cost, including any usage-priced dependency.*

---

## 10. Testing and Validation Strategy **[Core]**

*How correctness is demonstrated, not merely intended.*

### 10.1 Test approach by level

| Level | Scope | What it proves | Tooling |
|---|---|---|---|
| Unit | | | |
| Integration | | | |
| End-to-end | | | |
| Non-functional | | | |
| Manual / exploratory | | | |

### 10.2 Test data

*What test inputs are needed, how they are obtained or generated, and how the
hard cases — malformed, adversarial, degraded, boundary — are covered.*

### 10.3 Requirements verification matrix

*Every Must-priority requirement from §3 maps to at least one test. Gaps here
are the ones that reach production.*

| Requirement ID | Verified by | Status |
|---|---|---|

### 10.4 Acceptance criteria

*The conditions under which this is declared done.*

---

## 11. Delivery Plan **[Core]**

### 11.1 Milestones

*Ordered so that a working, demonstrable system exists as early as possible and
remains working throughout.*

| # | Milestone | Deliverable | Depends on | Estimate | Definition of done |
|---|---|---|---|---|---|
| M1 | | | — | | |

### 11.2 Scope-reduction ladder

*Decided in advance, calmly: if time runs short, the order in which scope is
dropped, and the minimum still worth shipping. Prevents the mid-build panic
where the wrong thing gets cut.*

| Order to cut | Item | Consequence of cutting |
|---|---|---|
| 1 | | |

### 11.3 Deployment and operations **[Deferred]**

- Target environment and why
- Build, release, and rollback procedure
- Runtime prerequisites and configuration
- What operating this costs in attention

---

## 12. Risks and Open Questions **[Core]**

### 12.1 Risk register

| ID | Risk | Likelihood | Impact | Mitigation | Trigger to act | Owner |
|---|---|---|---|---|---|---|
| R1 | | H/M/L | H/M/L | | | |

### 12.2 Open questions

*Questions blocking design decisions. Each needs an owner and a date by which
an answer is needed, or a default that will be assumed in its absence.*

| ID | Question | Blocks | Owner | Needed by | Default if unanswered |
|---|---|---|---|---|---|
| Q1 | | | | | |

---

## 13. Decision Log **[Core]**

*Appended to throughout the project. One row per decision that would be
expensive to reverse or that a reviewer might question. The "why not" column is
the one that has value six months later.*

| ID | Date | Decision | Options rejected | Why | Reversibility | Traces to |
|---|---|---|---|---|---|---|
| D1 | | | | | Easy / Costly / One-way | |

---

## 14. Appendices

### 14.1 References

| Ref | Title | Location | Accessed | Relevance |
|---|---|---|---|---|

### 14.2 Document history

| Version | Date | Author | Change |
|---|---|---|---|
| 0.1 | | | Initial draft |

---

## Pre-Implementation Checklist

*All must be true before writing production code.*

- [ ] Problem statement contains no solution language
- [ ] Every **[Core]** section is complete or marked N/A with a reason
- [ ] Every requirement has an ID, a source, and an acceptance test
- [ ] Every stated requirement source has produced at least one requirement
- [ ] Every Must-priority requirement maps to a test in §10.3
- [ ] Non-functional requirements state numbers, not adjectives
- [ ] Non-goals are written down and specific
- [ ] Assumptions are recorded with owners and impact-if-wrong
- [ ] At least one serious alternative was considered and rejected in writing
- [ ] Every failure class in §9.2 has a defined user-visible behaviour
- [ ] Privacy and security concerns are addressed or explicitly waived with reason
- [ ] A scope-reduction ladder exists and was decided before time pressure
- [ ] Open questions have owners and defaults
