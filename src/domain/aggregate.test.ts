import { rule } from './evidence.js'
/**
 * Unit tests for outcome aggregation.
 *
 * Test IDs refer to `docs/test-plan.md` §3.6.
 *
 * UT-G03 and UT-G04 are the most important tests in the suite. They assert the
 * system cannot report a clear result for a label it could not read — the
 * failure mode where a non-compliant label passes because the system was blind
 * to the problem (D5).
 */

import { describe, expect, it } from 'vitest'
import {
  aggregate,
  judgementCount,
  OUTCOME_HEADLINE,
  problemCount,
  summarise,
  unreadableFields,
} from './aggregate.js'
import type { FindingState, PolicyFinding } from './evaluate.js'
import type { Severity } from './policy.js'
import type { FieldName, FieldVerdict, FieldVerdictState, WarningVerdict } from './types.js'

const field = (state: FieldVerdictState, name: FieldName = 'brandName'): FieldVerdict => ({
  field: name,
  state,
  expected: 'Old Tom',
  observed: 'Old Tom',
  rule: rule('test fixture'),
})

const finding = (
  state: FindingState,
  severity: Severity = 'blocking',
  ruleId = 'DS-TEST',
): PolicyFinding => ({
  ruleId,
  requirement: 'a test requirement',
  state,
  severity,
  evidence: 'a test observation',
})

const warning = (ok: boolean, legible = true): WarningVerdict => ({
  present: true,
  ok,
  legible,
  segments: [],
  advisory: [],
  referenceDataVersion: 1,
})

describe('UT-G05 — an illegible warning can never aggregate to a clear result', () => {
  /*
   * Written from a measured failure, not an imagined one.
   *
   * The statutory warning is a fixed string every model knows by heart. Shown a
   * blurred label, the model did not report that it could not read it — it
   * returned the statute, verbatim and correct, and the check passed.
   *
   * The experiment that settled it: the same submission rendered twice at the
   * same blur, differing only in that one carried "birth defect" where the
   * statute says "birth defects". Both transcriptions came back identical and
   * canonical. The model reads when it can and recites when it cannot, and
   * says nothing about which it did.
   *
   * So legibility cannot be a model's claim about itself. It is measured from
   * the pixels, and an unreadable warning blocks a conclusion exactly as an
   * unreadable field does (D5).
   */
  it('outranks a clean match', () => {
    expect(
      aggregate({ fields: [field('MATCH'), field('MATCH')], warning: warning(true, false) }),
    ).toBe('INCOMPLETE')
  })

  it('outranks a discrepancy, because the unread part may be worse', () => {
    expect(aggregate({ fields: [field('MISMATCH')], warning: warning(false, false) })).toBe(
      'INCOMPLETE',
    )
  })

  it('does not fire when the warning was legible', () => {
    expect(aggregate({ fields: [field('MATCH')], warning: warning(true, true) })).toBe('CLEAR')
  })

  // A submission with no warning verdict at all is a different case: nothing
  // was assessed, so there is nothing to call illegible.
  it('says nothing about a submission carrying no warning verdict', () => {
    expect(aggregate({ fields: [field('MATCH')], warning: null })).toBe('CLEAR')
  })
})

describe('UT-G — aggregation ordering', () => {
  it('UT-G01 — all match', () => {
    expect(aggregate({ fields: [field('MATCH'), field('MATCH')], warning: warning(true) })).toBe(
      'CLEAR',
    )
  })

  it('UT-G02 — a mismatch is a discrepancy', () => {
    expect(aggregate({ fields: [field('MATCH'), field('MISMATCH')], warning: warning(true) })).toBe(
      'DISCREPANCIES_FOUND',
    )
  })

  it('UT-G03 — one unreadable field blocks a clear result', () => {
    expect(
      aggregate({ fields: [field('MATCH'), field('UNREADABLE')], warning: warning(true) }),
    ).toBe('INCOMPLETE')
  })

  it('UT-G04 — unreadable outranks a mismatch', () => {
    expect(
      aggregate({ fields: [field('MISMATCH'), field('UNREADABLE')], warning: warning(true) }),
    ).toBe('INCOMPLETE')
  })

  it('UT-G05 — low confidence asks for confirmation', () => {
    expect(
      aggregate({ fields: [field('MATCH'), field('LOW_CONFIDENCE')], warning: warning(true) }),
    ).toBe('CLEAR_CONFIRM_FLAGGED')
  })

  it('UT-G06 — a not-supplied field is not assessed, not failed', () => {
    expect(
      aggregate({ fields: [field('MATCH'), field('NOT_SUPPLIED')], warning: warning(true) }),
    ).toBe('CLEAR')
  })

  it('UT-G07 — a warning failure is a discrepancy even when all fields match', () => {
    expect(aggregate({ fields: [field('MATCH')], warning: warning(false) })).toBe(
      'DISCREPANCIES_FOUND',
    )
  })

  it('UT-G08 — unreadable outranks a warning failure too', () => {
    expect(aggregate({ fields: [field('UNREADABLE')], warning: warning(false) })).toBe('INCOMPLETE')
  })

  it('missing on the label is a discrepancy', () => {
    expect(
      aggregate({ fields: [field('MATCH'), field('MISSING_ON_LABEL')], warning: warning(true) }),
    ).toBe('DISCREPANCIES_FOUND')
  })

  it('unreadable outranks low confidence', () => {
    expect(
      aggregate({ fields: [field('LOW_CONFIDENCE'), field('UNREADABLE')], warning: warning(true) }),
    ).toBe('INCOMPLETE')
  })

  it('tolerates a review with no warning verdict', () => {
    expect(aggregate({ fields: [field('MATCH')], warning: null })).toBe('CLEAR')
  })
})

/**
 * The policy findings, and where they rank (D40, §18.4).
 *
 * Two kinds of confirmation are deliberately not merged. `CLEAR_CONFIRM_FLAGGED`
 * asks the agent to confirm a *reading* — a better scan would settle it.
 * `CLEAR_CONFIRM_POLICY` asks them to make a *compliance judgement* the artwork
 * cannot supply at all. The second is the larger ask, so it takes the headline.
 */
describe('policy findings in the outcome', () => {
  const clean = { fields: [field('MATCH')], warning: warning(true) }

  it('a blocking violation is a discrepancy', () => {
    expect(aggregate({ ...clean, findings: [finding('VIOLATED')] })).toBe('DISCREPANCIES_FOUND')
  })

  it('an advisory violation asks for judgement rather than reporting a problem', () => {
    // Advisory is a severity the policy set assigns. The rule was applied and
    // failed, but the set says that is the agent's call, not a blocker.
    expect(aggregate({ ...clean, findings: [finding('VIOLATED', 'advisory')] })).toBe(
      'CLEAR_CONFIRM_POLICY',
    )
  })

  it('an undetermined check asks for judgement, whatever its severity', () => {
    for (const severity of ['blocking', 'advisory'] as const) {
      expect(aggregate({ ...clean, findings: [finding('UNDETERMINED', severity)] })).toBe(
        'CLEAR_CONFIRM_POLICY',
      )
    }
  })

  it('never lets an undetermined blocking check report a clear result', () => {
    // The whole point of the fourth state. A check that could not be performed
    // must not read as one that passed.
    const outcome = aggregate({ ...clean, findings: [finding('UNDETERMINED')] })
    expect(outcome).not.toBe('CLEAR')
  })

  it('satisfied and not-applicable findings leave a clear result clear', () => {
    expect(
      aggregate({
        ...clean,
        findings: [finding('SATISFIED'), finding('NOT_APPLICABLE', 'advisory')],
      }),
    ).toBe('CLEAR')
  })

  it('treats a submission governed by no rules exactly as one with none supplied', () => {
    expect(aggregate({ ...clean, findings: [] })).toBe(aggregate(clean))
  })

  it('ranks a judgement above a low-confidence reading', () => {
    expect(
      aggregate({
        fields: [field('LOW_CONFIDENCE')],
        warning: warning(true),
        findings: [finding('UNDETERMINED')],
      }),
    ).toBe('CLEAR_CONFIRM_POLICY')
  })

  it('ranks a blocking violation above a judgement', () => {
    expect(aggregate({ ...clean, findings: [finding('UNDETERMINED'), finding('VIOLATED')] })).toBe(
      'DISCREPANCIES_FOUND',
    )
  })

  it('ranks an unreadable field above every policy finding (D5 still governs)', () => {
    for (const state of ['VIOLATED', 'UNDETERMINED'] as const) {
      expect(
        aggregate({
          fields: [field('UNREADABLE')],
          warning: warning(true),
          findings: [finding(state)],
        }),
      ).toBe('INCOMPLETE')
    }
  })

  it('gives the new outcome a headline that does not read as an approval', () => {
    const headline = OUTCOME_HEADLINE.CLEAR_CONFIRM_POLICY
    expect(headline).toBeTruthy()
    expect(headline).not.toMatch(/\bapproved\b/i)
  })

  it('counts blocking violations as problems, and judgements separately', () => {
    const findings = [
      finding('VIOLATED'),
      finding('VIOLATED', 'advisory'),
      finding('UNDETERMINED'),
      finding('SATISFIED'),
    ]
    const input = { ...clean, findings }
    expect(problemCount(input)).toBe(1)
    expect(judgementCount(input)).toBe(2)
  })

  it('names the rule when a violation is the only thing wrong', () => {
    // Every field matched and the warning is correct, so the older branches
    // find nothing to report. Without this the worklist row read "Warning
    // statement is not correct" for a submission whose warning was fine.
    expect(
      summarise({ ...clean, findings: [finding('VIOLATED', 'blocking', 'DS-STANDARD-OF-FILL')] }),
    ).toBe('Fails DS-STANDARD-OF-FILL')
  })

  it('summarises a judgement by how many rules need one', () => {
    expect(
      summarise({ ...clean, findings: [finding('UNDETERMINED'), finding('VIOLATED', 'advisory')] }),
    ).toMatch(/2 rules/i)
  })

  it('uses the singular for one', () => {
    expect(summarise({ ...clean, findings: [finding('UNDETERMINED')] })).toMatch(/1 rule\b/i)
  })
})

describe('the safety property, stated directly (D5)', () => {
  const everyOtherState: FieldVerdictState[] = [
    'MATCH',
    'MISMATCH',
    'MISSING_ON_LABEL',
    'NOT_SUPPLIED',
    'LOW_CONFIDENCE',
  ]

  it.each(everyOtherState)(
    'never reports a clear result when a field is unreadable, alongside %s',
    (other) => {
      const outcome = aggregate({
        fields: [field('UNREADABLE'), field(other)],
        warning: warning(true),
        // Present, and deliberately the states that would otherwise carry the
        // outcome. None of them may outrank a field nobody could read.
        findings: [finding('SATISFIED'), finding('UNDETERMINED'), finding('VIOLATED', 'advisory')],
      })
      expect(outcome).toBe('INCOMPLETE')
      expect(outcome).not.toBe('CLEAR')
      expect(outcome).not.toBe('CLEAR_CONFIRM_FLAGGED')
      expect(outcome).not.toBe('CLEAR_CONFIRM_POLICY')
    },
  )
})

describe('summary helpers', () => {
  it('counts field and warning problems together', () => {
    expect(
      problemCount({
        fields: [field('MISMATCH'), field('MISSING_ON_LABEL'), field('MATCH')],
        warning: warning(false),
      }),
    ).toBe(3)
  })

  it('does not count unassessed or low-confidence fields as problems', () => {
    expect(
      problemCount({
        fields: [field('NOT_SUPPLIED'), field('LOW_CONFIDENCE')],
        warning: warning(true),
      }),
    ).toBe(0)
  })

  it('lists the fields that could not be read, for the INCOMPLETE explanation', () => {
    const fields = [field('UNREADABLE'), field('MATCH'), field('UNREADABLE')]
    expect(unreadableFields({ fields, warning: null }).length).toBe(2)
  })
})

describe('summarise — the batch worklist line (ui-design §9)', () => {
  it('names the offending field on a discrepancy', () => {
    const out = summarise({
      fields: [field('MATCH'), field('MISMATCH', 'alcoholContent')],
      warning: warning(true),
    })
    expect(out).toMatch(/alcohol content does not match/i)
  })

  it('names a missing field distinctly from a mismatched one', () => {
    expect(
      summarise({ fields: [field('MISSING_ON_LABEL', 'netContents')], warning: warning(true) }),
    ).toMatch(/missing from the label/i)
  })

  it('counts unreadable fields rather than naming them all', () => {
    expect(
      summarise({
        fields: [field('UNREADABLE'), field('UNREADABLE', 'classType')],
        warning: warning(true),
      }),
    ).toMatch(/could not read 2 fields/i)
  })

  it('uses the singular for one unreadable field', () => {
    expect(summarise({ fields: [field('UNREADABLE')], warning: warning(true) })).toMatch(
      /could not read 1 field$/i,
    )
  })

  it('falls back to the warning statement when no field is at fault', () => {
    expect(summarise({ fields: [field('MATCH')], warning: warning(false) })).toMatch(
      /warning statement/i,
    )
  })

  it('reports a clean result plainly', () => {
    expect(summarise({ fields: [field('MATCH')], warning: warning(true) })).toBe(
      'Everything matches',
    )
  })

  it('asks for confirmation when only confidence is low', () => {
    expect(summarise({ fields: [field('LOW_CONFIDENCE')], warning: warning(true) })).toMatch(
      /confirm flagged/i,
    )
  })
})
