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
import {
  alreadyDecided,
  checkDecision,
  DecisionRejected,
  isDecision,
  isDisagreement,
  listDecisions,
} from './decision.js'

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

describe('a verdict is decided once', () => {
  /*
   * Asked per verdict rather than per submission, and the difference matters.
   *
   * A correction supersedes a verdict (UC-3) and produces a new one that
   * genuinely needs deciding again. Refusing on "this submission was decided
   * once" would leave a corrected submission permanently undecidable; refusing
   * on "this verdict was decided" stops only the duplicate — a second tab, a
   * double click, a retried request — which would otherwise append a row that
   * masks the first without superseding it.
   */
  const db = (rows: unknown) =>
    ({
      prepare: () => ({ bind: () => ({ first: async () => rows }) }),
    }) as unknown as D1Database

  it('reports a verdict that already carries a decision', async () => {
    expect(await alreadyDecided(db({ found: 1 }), 'v-1')).toBe(true)
  })

  it('reports one that does not', async () => {
    expect(await alreadyDecided(db(null), 'v-1')).toBe(false)
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

describe('the decision history (ui-design §2.3)', () => {
  /*
   * A transparent record rather than a supervisor's screen. This deployment
   * authenticates nobody, so gating it behind a role would imply an access
   * control that does not exist — and this is the one record that says what
   * humans did rather than what the system found.
   */
  const rows = (results: unknown[]) =>
    ({
      prepare: () => ({
        bind: () => ({ all: async () => ({ results }) }),
        all: async () => ({ results }),
      }),
    }) as unknown as D1Database

  const row = (over: Record<string, unknown> = {}) => ({
    submission_id: 's-1',
    reference_code: 'ABCD-1234',
    source_name: 'L01-fully-compliant.pdf',
    job_id: 'job-1',
    judged_at: '2026-08-04T09:00:00.000Z',
    verdict_id: 'v-1',
    decided_by: 'jenny',
    decided_at: '2026-08-04T10:00:00.000Z',
    decision: 'APPROVED',
    recommended_outcome: 'CLEAR',
    note: null,
    ...over,
  })

  it('reports attribution as entered, not as identity', async () => {
    // The field name carries the caveat, so a reader cannot mistake a typed
    // name for a verified one.
    const [entry] = await listDecisions(rows([row()]))
    expect(entry?.decidedByAsEntered).toBe('jenny')
  })

  it('computes agreement with the one implementation, not a second copy', async () => {
    const [agreed] = await listDecisions(rows([row()]))
    expect(agreed?.agreed).toBe(true)
    const [differed] = await listDecisions(
      rows([row({ decision: 'APPROVED', recommended_outcome: 'DISCREPANCIES_FOUND' })]),
    )
    expect(differed?.agreed).toBe(false)
  })

  it('says a reason exists without publishing it', async () => {
    // The note is free text an agent wrote about an applicant. It is already
    // kept out of the audit chain on D20 grounds, and a browsable list is a
    // weaker place for it than a log somebody had a reason to open.
    const [entry] = await listDecisions(rows([row({ note: 'corrected label by email' })]))
    expect(entry?.hasNote).toBe(true)
    expect(JSON.stringify(entry)).not.toContain('corrected label by email')
  })

  it('tolerates a submission whose reference cannot be resolved', async () => {
    const [entry] = await listDecisions(rows([row({ reference_code: null })]))
    expect(entry?.reference).toBe('')
  })

  it('tells two runs of the same file apart', async () => {
    // The batch is meant to be run repeatedly, and each run produces fresh
    // submissions with new ids and new reference codes. Both are decidable,
    // which is right — but a list carrying only a code and a date would show
    // two identical-looking rows for the same label.
    const entries = await listDecisions(
      rows([
        row({ submission_id: 's-2', job_id: 'job-2', judged_at: '2026-08-04T15:00:00.000Z' }),
        row(),
      ]),
    )
    expect(entries.map((e) => e.sourceName)).toEqual([
      'L01-fully-compliant.pdf',
      'L01-fully-compliant.pdf',
    ])
    // Same label, different run, different moment of judging.
    expect(entries[0]?.jobId).not.toBe(entries[1]?.jobId)
    expect(entries[0]?.judgedAt).not.toBe(entries[1]?.judgedAt)
  })

  it('keeps when it was judged apart from when it was decided', async () => {
    // Different moments, and a reviewer comparing runs needs both: one says
    // when the system reached the verdict, the other when a person answered it.
    const [entry] = await listDecisions(rows([row()]))
    expect(entry?.judgedAt).toBe('2026-08-04T09:00:00.000Z')
    expect(entry?.decidedAt).toBe('2026-08-04T10:00:00.000Z')
  })

  it('survives a verdict or submission that cannot be joined', async () => {
    const [entry] = await listDecisions(
      rows([row({ source_name: null, job_id: null, judged_at: null })]),
    )
    expect(entry?.sourceName).toBe('')
    expect(entry?.jobId).toBeNull()
  })

  it('returns nothing when nothing has been decided', async () => {
    // Distinct from "everything agreed", which is what an empty list reads as
    // if the caller does not say otherwise.
    expect(await listDecisions(rows([]))).toEqual([])
  })
})
