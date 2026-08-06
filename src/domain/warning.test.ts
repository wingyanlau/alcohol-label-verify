/**
 * Unit tests for warning statement verification.
 *
 * Test IDs refer to `docs/test-plan.md` §3.5.
 *
 * UT-W12 is the load-bearing one: a meaning-preserving paraphrase must FAIL.
 * If it ever passes, the tolerant matching path has been wired into the exact
 * path, and G3 no longer outranks G5 (§2.1).
 */

import { describe, expect, it } from 'vitest'
import { referenceIsUnverified, warningReference } from './reference.js'
import { verifyWarning } from './warning.js'

const ref = warningReference()
const REQUIRED = ref.segments.map((s) => s.text).join(' ')

describe('UT-W — statutory text', () => {
  it('UT-W01 — exact text passes', () => {
    const v = verifyWarning(REQUIRED)
    expect(v.ok).toBe(true)
    expect(v.present).toBe(true)
    expect(v.segments.every((s) => s.ok)).toBe(true)
  })

  it('UT-W02 — line wrapping is layout, not wording', () => {
    expect(verifyWarning(REQUIRED.replace(/ /g, '\n')).ok).toBe(true)
  })

  it('UT-W03 — repeated whitespace is tolerated', () => {
    expect(verifyWarning(REQUIRED.replace(/\. /g, '.   ')).ok).toBe(true)
  })

  it('UT-W04 — typographic apostrophes are tolerated', () => {
    expect(verifyWarning(REQUIRED.replace(/'/g, '’')).ok).toBe(true)
  })

  it('UT-W05 — title-case header fails, and says why (Jenny, SRC-5)', () => {
    const v = verifyWarning(REQUIRED.replace('GOVERNMENT WARNING:', 'Government Warning:'))
    expect(v.ok).toBe(false)
    const header = v.segments.find((s) => s.segmentId === 'header')
    expect(header?.ok).toBe(false)
    expect(header?.deviation).toMatch(/capital letters/i)
  })

  it('UT-W06 — a missing colon is named specifically', () => {
    const v = verifyWarning(REQUIRED.replace('GOVERNMENT WARNING:', 'GOVERNMENT WARNING'))
    expect(v.ok).toBe(false)
    expect(v.segments.find((s) => s.segmentId === 'header')?.deviation).toMatch(/colon/i)
  })

  it('UT-W07 — one altered word fails, naming the segment and the deviation', () => {
    const v = verifyWarning(REQUIRED.replace('birth defects', 'birth defect'))
    expect(v.ok).toBe(false)
    const clause = v.segments.find((s) => s.segmentId === 'clause_1')
    expect(clause?.ok).toBe(false)
    expect(clause?.deviation).toContain('defects')
    // Failures localise: the other clause is unaffected.
    expect(v.segments.find((s) => s.segmentId === 'clause_2')?.ok).toBe(true)
  })

  it('UT-W08 — an absent clause is named, not reported as whole-statement failure', () => {
    const clause2 = ref.segments.find((s) => s.id === 'clause_2')
    const v = verifyWarning(REQUIRED.replace(clause2?.text ?? '', '').trim())
    expect(v.ok).toBe(false)
    expect(v.segments.find((s) => s.segmentId === 'clause_2')?.ok).toBe(false)
    expect(v.segments.find((s) => s.segmentId === 'clause_1')?.ok).toBe(true)
  })

  it('UT-W09 — removing the (1)/(2) markers fails', () => {
    expect(verifyWarning(REQUIRED.replace('(1) ', '').replace('(2) ', '')).ok).toBe(false)
  })

  it('UT-W10 — clauses in the wrong order fail', () => {
    const [header, one, two] = ref.segments
    expect(verifyWarning(`${header?.text} ${two?.text} ${one?.text}`).ok).toBe(false)
  })

  it('UT-W11 — an absent statement is distinct from one present but wrong', () => {
    const absent = verifyWarning(null)
    expect(absent.present).toBe(false)
    expect(absent.ok).toBe(false)

    const wrong = verifyWarning(REQUIRED.replace('birth defects', 'birth defect'))
    expect(wrong.present).toBe(true)
    expect(wrong.ok).toBe(false)
  })

  it('UT-W12 — a meaning-preserving paraphrase FAILS (G3 outranks G5)', () => {
    const paraphrase =
      'GOVERNMENT WARNING: (1) According to the Surgeon General, pregnant women should not ' +
      'consume alcoholic beverages due to the risk of birth defects. (2) Drinking alcoholic ' +
      'beverages impairs your ability to drive a car or operate machinery, and may cause ' +
      'health problems.'
    expect(verifyWarning(paraphrase).ok).toBe(false)
  })

  it('UT-W13 — extra text after the statement does not fail the wording', () => {
    expect(verifyWarning(`${REQUIRED} PLEASE DRINK RESPONSIBLY`).ok).toBe(true)
  })

  it('empty text is treated as absent, not as a passing statement', () => {
    expect(verifyWarning('   ').present).toBe(false)
    expect(verifyWarning('   ').ok).toBe(false)
  })

  it('a statement with no recognisable header at all is reported as not found', () => {
    const v = verifyWarning('SOMETHING ENTIRELY DIFFERENT ON THIS LABEL')
    expect(v.segments.find((s) => s.segmentId === 'header')?.deviation).toMatch(/not found/i)
  })
})

describe('FR-6a — advisory formatting checks', () => {
  it('surfaces the formatting rules the system does not decide, each citing its own section', () => {
    const v = verifyWarning(REQUIRED)
    expect(v.advisory.length).toBeGreaterThan(0)
    // Part 16 throughout — but not all of it is 16.22, which this test used to
    // assert. Separateness is stated in 16.21 beside the statement itself, so
    // citing it to 16.22 sent an agent to a section not containing the
    // requirement (D53). The citation is the point of an advisory check: it is
    // the only thing that makes the question answerable.
    for (const check of v.advisory) expect(check.citation).toMatch(/^27 CFR 16\.(21|22)/)
    expect(v.advisory.find((c) => c.id === 'separateness')?.citation).toBe('27 CFR 16.21')
    expect(v.advisory.find((c) => c.id === 'header_bold')?.citation).toContain('16.22(a)(2)')
  })

  it('includes the non-bold-remainder rule no stakeholder mentioned (§3.6)', () => {
    expect(verifyWarning(REQUIRED).advisory.map((a) => a.id)).toContain('remainder_not_bold')
  })

  it('advisory checks never fail the verdict (N4)', () => {
    // A correct statement passes even though several formatting rules are
    // unverified — and TTB itself does not routinely review them (§8.8).
    expect(verifyWarning(REQUIRED).ok).toBe(true)
  })
})

describe('provenance', () => {
  it('records the reference-data version that produced the verdict (§8.7.1)', () => {
    expect(verifyWarning(REQUIRED).referenceDataVersion).toBe(ref.configVersion)
  })

  it('reports whether the statutory text has been verified against the source (M0)', () => {
    // Not an assertion about which value is correct — an assertion that the
    // system can tell you. FR-5 rests on a constant that may be unverified.
    expect(typeof referenceIsUnverified(ref)).toBe('boolean')
  })
})
