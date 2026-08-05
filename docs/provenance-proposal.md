# Proposal: provenance for the nine enforced rules

> **Stopped, and kept as evidence rather than as a proposal.**
>
> Selecting the passage by hand does not work well enough to be worth
> finishing. The first pass produced two malformed quotes — one truncated
> mid-sentence, one began mid-sentence — and both were caught by eye rather
> than by anything structural. The boundaries that matter in a regulation are
> legal ones: a paragraph qualified by the sub-paragraph beneath it, a
> definition three sections away. String offsets do not know that, and a
> reviewer handed a fragment that stops before its own proviso is worse off
> than one handed a citation.
>
> **This is the concrete case for the recall work in the README.** Producing
> the passage a rule rests on — with the provisions that qualify it — is a
> retrieval and comprehension problem, which is exactly what a model is good at
> and exactly what this system has so far refused to use one for. It assists
> *review of the rules* rather than deciding compliance, so it sits on the
> right side of the governing principle, and §19 is what would make it
> accountable.
>
> What survives below and is worth keeping: the three eCFR source documents
> with digests of the bytes actually retrieved, and the demonstration that the
> stored digests for 5.63 and 5.65 have not moved. The nine quotes are verbatim
> and were verified as such — they are simply not *well chosen*, which is the
> part that cannot be brute-forced.

| Field | Value |
|---|---|
| Status | **Abandoned. Not applied, and not ready to apply.** |
| Prepared | 2026-08-04, by a model (`claude-opus-5`) |
| Applies to | `config/policy-set.json` — the nine rules with `status: "active"` |
| Payload | [`config/proposed-provenance.json`](../config/proposed-provenance.json) |

---

## The problem this closes

The nine rules **actually being enforced** carry no record of where they came
from. The six that never fire carry careful quotes and citations. That is
backwards, and it matters for a specific reason stated in design §18.5a:

> Without the quote, reviewing one rule means re-reading the whole regulation —
> which means nobody reviews it, and the approval becomes a formality.

A finding currently pins its regulation by digest and issue date, which is
exact and cannot be paraphrased. What it does not give a reviewer is the words,
and the words are what make review practical rather than theoretical.

## Why this is a proposal rather than a commit

`quote` does not exist on its own. It lives inside `provenance`, which requires
`extractedBy` — a factual claim about **who read the regulation**. Both values
are closed to the model that prepared this:

- **`"human"`** would assert a person derived these rules. That cannot be
  established: they were authored before the session that found the gap, and
  writing it would launder a possibly model-derived rule past the check that
  exists to catch exactly that.
- **`"model"`** is the honest value, and `validatePolicySet` then refuses to
  load a set in which an `active` rule was model-extracted and carries no
  `approval`. That refusal is D27 — *no rule reaches force without named human
  approval* — and D46 now enforces it in code rather than in prose.

So applying this **requires a person to approve it**, which is the whole point.
Committing it unapproved would stop the worker from starting.

## What the payload contains

**Three source documents to register**, one per CFR part, each digested from
the bytes actually retrieved from the eCFR versioner API on 2026-08-04:

| Document | Part | Digest |
|---|---|---|
| `DOC-ECFR-27-PART-4` | 27 CFR 4 | `9059fcb15c2cd350` |
| `DOC-ECFR-27-PART-5` | 27 CFR 5 | `2b24904b3b10adda` |
| `DOC-ECFR-27-PART-16` | 27 CFR 16 | `60d6e204b84398ac` |

**Nine provenance blocks**, each carrying the verbatim passage the rule
implements:

| Rule | Section | Quote |
|---|---|---|
| `DS-BRAND-NAME-PRESENT` | 5.63 | the mandatory-information sentence through *"Brand name, in accordance with § 5.64"* |
| `DS-CLASS-TYPE-PRESENT` | 5.63 | *"Class, type, or other designation … subpart I of this part"* |
| `DS-ALCOHOL-CONTENT-PRESENT` | 5.63 | *"and (3) Alcohol content, in accordance with § 5.65."* |
| `DS-ALCOHOL-CONTENT-FORMAT` | 5.65 | (b)(2)(i) the three permitted formats, through (b)(3)'s abbreviations — the two together are what the check implements |
| `DS-PROOF-CONSISTENT` | 5.65 | (b)(1) and (b)(1)(i): proof may be stated alongside the mandatory percentage, which is the relationship the check tests |
| `DS-NET-CONTENTS-PRESENT` | 5.70 | *"The volume of spirits in the container must appear on a label as a net contents statement."* |
| `DS-STANDARD-OF-FILL` | 5.203 | the authorised metric standards, all 25 |
| `WINE-STANDARD-OF-FILL` | 4.72 | the authorised standards of fill for wine, all 25 |
| `HEALTH-WARNING-TEXT` | 16.21 | the statutory warning in full |

**Every quote was checked to appear verbatim** in the section it cites, against
the eCFR XML — once, by a script, at the time of writing. Nothing re-checks it:
these blocks live in a proposal file the suite does not read. If this were ever
applied, that check would need to become a test, or the quotes would drift from
their regulations with nothing noticing.

Two digests were also confirmed unmoved: `5.63` and `5.65` still hash to the
values recorded in the archive, so those regulations have not changed since the
rules were written.

## If it were applied anyway

*Left for reference. The approach above is not recommended.*

1. Decide who approves. This is a governance act — the person named is
   answerable for nine rules that are already deciding real submissions.
2. In `config/policy-set.json`, for each of the nine rules:
   - add its `provenance` block from the payload;
   - add `"approval": { "by": "<name>", "at": "<YYYY-MM-DD>" }`.
3. Add the three source documents to `sourceDocuments`.
4. Bump `policySetVersion` to 3, set `supersedes` to 2, update `contentDigest`,
   and add the new version to `RELEASED` in `src/domain/policy-set.test.ts`.
   The suite fails until all four are done — deliberately (§18.8.1).
5. `npm run quality-check`, then deploy. The reconciler will supersede the nine
   rows and write `policy.rule.enacted` against the approver's name.

Step 5 is worth watching: verdicts recorded **before** the change must still
replay `identical`, because the archive rebuilds the rules as they stood at each
verdict's own two dates. That is the property D41 and D42 exist for, and this is
the first change large enough to demonstrate it.

## What this does not do

It does not make the rules correct. It records where they came from and who is
answerable for them, which is a different claim — and the one that was missing.
