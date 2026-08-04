/**
 * The agent's decision (§18.5).
 *
 * The value of this table is the pair — what was recommended, and what a
 * person did. So the tests are mostly about that pair being recorded
 * faithfully, and about refusing the one case that would make the record
 * useless: a departure from the recommendation with no reason given.
 */

import { describe, expect, it } from 'vitest'
import type { Outcome } from '../domain/types.js'
import { checkDecision, DecisionRejected, isDecision, isDisagreement } from './decision.js'

const check = (decision: string, recommendedOutcome: Outcome, note: string | null = null) =>
  checkDecision({ decision, decidedBy: 'jenny', recommendedOutcome, note })

describe('the decision vocabulary', () => {
  it('accepts only what it records', () => {
    expect(isDecision('APPROVED')).toBe(true)
    expect(isDecision('MAYBE')).toBe(false)
  })

  it('refuses anything else by name', () => {
    expect(() => check('MAYBE', 'CLEAR')).toThrow(DecisionRejected)
  })

  it('refuses a decision nobody is named for', () => {
    // An unattributable approval is not an approval.
    expect(() =>
      checkDecision({
        decision: 'APPROVED',
        decidedBy: '  ',
        recommendedOutcome: 'CLEAR',
        note: null,
      }),
    ).toThrow(/name who made it/i)
  })
})

describe('agreement and disagreement', () => {
  it('counts approving a clear result as agreement', () => {
    for (const outcome of ['CLEAR', 'CLEAR_CONFIRM_FLAGGED', 'CLEAR_CONFIRM_POLICY'] as const) {
      expect(isDisagreement({ decision: 'APPROVED', recommendedOutcome: outcome }), outcome).toBe(
        false,
      )
    }
  })

  it('counts approving over a discrepancy as disagreement', () => {
    expect(
      isDisagreement({ decision: 'APPROVED', recommendedOutcome: 'DISCREPANCIES_FOUND' }),
    ).toBe(true)
  })

  it('counts approving something that could not be checked as disagreement', () => {
    // INCOMPLETE is not a recommendation to approve. Treating it as neutral
    // would hide the case where an agent waved through a label the system
    // could not read — which is the failure D5 exists to prevent, appearing
    // one layer later.
    expect(isDisagreement({ decision: 'APPROVED', recommendedOutcome: 'INCOMPLETE' })).toBe(true)
  })

  it('counts rejecting a clear result as disagreement', () => {
    expect(isDisagreement({ decision: 'REJECTED', recommendedOutcome: 'CLEAR' })).toBe(true)
  })

  it('counts rejecting a flagged discrepancy as agreement', () => {
    expect(
      isDisagreement({ decision: 'REJECTED', recommendedOutcome: 'DISCREPANCIES_FOUND' }),
    ).toBe(false)
  })

  it('treats returning for better artwork as agreeing with INCOMPLETE', () => {
    // Distinct from REJECTED on purpose: sending an application back for a
    // clearer scan is not a finding against the applicant, and collapsing the
    // two would make every unreadable scan look like the system overruled.
    expect(isDisagreement({ decision: 'RETURNED', recommendedOutcome: 'INCOMPLETE' })).toBe(false)
  })
})

describe('a departure from the recommendation must say why', () => {
  it('is refused without a note', () => {
    expect(() => check('APPROVED', 'DISCREPANCIES_FOUND')).toThrow(DecisionRejected)
    expect(() => check('APPROVED', 'DISCREPANCIES_FOUND')).toThrow(/say why/i)
  })

  it('is refused when the note is only whitespace', () => {
    expect(() => check('APPROVED', 'DISCREPANCIES_FOUND', '   ')).toThrow(DecisionRejected)
  })

  it('is accepted with one', () => {
    expect(() =>
      check('APPROVED', 'DISCREPANCIES_FOUND', 'Applicant supplied a corrected label by email.'),
    ).not.toThrow()
  })

  it('does not demand a note when the agent agreed', () => {
    // Requiring one everywhere would train agents to type a character to get
    // past the box, and the notes that matter would be indistinguishable from
    // the noise.
    expect(() => check('APPROVED', 'CLEAR')).not.toThrow()
    expect(() => check('REJECTED', 'DISCREPANCIES_FOUND')).not.toThrow()
  })
})
