import { describe, expect, it } from 'vitest'
import { rule } from '../domain/evidence.js'
import type { VerifyResult } from '../domain/verify.js'
import { buildPersistPlan, type PersistIds } from './persist.js'

const PROVENANCE = {
  provider: 'workers-ai',
  modelId: '@cf/meta/llama-4-scout-17b-16e-instruct',
  promptVersion: 'label-extract@1',
  samplingParameters: { temperature: 0 },
  latencyMs: 1200,
}

function result(overrides: Partial<VerifyResult> = {}): VerifyResult {
  return {
    outcome: 'DISCREPANCIES_FOUND',
    summary: 'Alcohol content does not match',
    problemCount: 1,
    fields: [
      {
        field: 'brandName',
        state: 'MATCH',
        expected: 'Old Tom Distillery',
        observed: 'OLD TOM DISTILLERY',
        rule: rule('Matches after ignoring capitalisation, punctuation and spacing'),
        explanation: 'Capitalisation differs — treated as a match.',
      },
      {
        field: 'alcoholContent',
        state: 'MISMATCH',
        expected: '45%',
        observed: '40% Alc./Vol.',
        rule: rule('Compared as numbers, ignoring format'),
      },
    ],
    warning: {
      present: true,
      ok: false,
      legible: true,
      segments: [
        {
          segmentId: 'header',
          label: 'Header',
          ok: true,
          required: 'GOVERNMENT WARNING:',
          observed: 'GOVERNMENT WARNING:',
        },
        {
          segmentId: 'clause_1',
          label: 'Surgeon General / pregnancy',
          ok: false,
          required: '(1) According…',
          observed: '(1) According…defect.',
          deviation: 'Required "defects.", label has "defect."',
        },
      ],
      advisory: [],
      referenceDataVersion: 1,
    },
    application: {
      brandName: 'Old Tom Distillery',
      classType: null,
      alcoholContent: '45%',
      netContents: null,
    },
    labelExtraction: {
      fields: {
        brandName: { raw: 'OLD TOM DISTILLERY', confidence: 1, unreadable: false },
        classType: { raw: null, confidence: 1, unreadable: false },
        alcoholContent: { raw: '40% Alc./Vol.', confidence: 1, unreadable: false },
        netContents: { raw: null, confidence: 1, unreadable: false },
      },
      warningStatement: 'GOVERNMENT WARNING: …',
    },
    judgementCount: 0,
    findings: [],
    appliedRules: [],
    policy: {
      policySetVersion: 1,
      selectedRuleIds: [],
      selectionInputs: {},
      submittedOn: '2026-08-01',
      validOn: '2026-08-01',
      asOf: '2026-08-01T00:00:00.000Z',
    },
    provenance: { label: PROVENANCE, record: PROVENANCE },
    rawResponses: { label: '{"fields":{}}', record: '{"fields":{}}' },
    timings: { extractMs: 1200, compareMs: 1, totalMs: 1300 },
    ...overrides,
  }
}

const ids: PersistIds = {
  verdictId: 'v-1',
  submissionId: 's-1',
  labelExtractionId: 'ex-label',
  recordExtractionId: 'ex-record',
}

describe('buildPersistPlan', () => {
  it('records the outcome and the full versioned identity set (NFR-13)', () => {
    const plan = buildPersistPlan(result(), ids, 300)
    expect(plan.verdict.outcome).toBe('DISCREPANCIES_FOUND')
    expect(plan.verdict.rulesetVersion).toBe('compare@1')
    expect(plan.verdict.policyVersion).toBe('policy@1')
    // @2 since D40 — the vocabulary gained a state and aggregation gained an
    // input, so a verdict reached under @1 may not be reached again today.
    expect(plan.verdict.aggregationVersion).toBe('aggregate@2')
    expect(plan.verdict.referenceDataVersion).toBe(1)
  })

  describe('the rule-set binding (D26)', () => {
    const governed = () =>
      result({
        findings: [
          {
            ruleId: 'DS-STANDARD-OF-FILL',
            requirement: 'Net contents must be an authorised standard of fill',
            state: 'VIOLATED',
            severity: 'blocking',
            evidence: '800 mL is not an authorised standard of fill',
          },
        ],
        policy: {
          policySetVersion: 3,
          selectedRuleIds: ['DS-STANDARD-OF-FILL'],
          selectionInputs: { productType: 'Distilled spirits' },
          submittedOn: '2026-08-01',
          validOn: '2026-08-01',
          asOf: '2026-08-01T00:00:00.000Z',
        },
      })

    it('records which rules were applied and what they were selected on', () => {
      // The version alone proves the rules were applied correctly. The inputs
      // prove the CORRECT rules were selected — the error that is otherwise
      // silent, systematic, and invisible in the output.
      const { verdict } = buildPersistPlan(governed(), ids, 300)
      expect(verdict.policySetVersion).toBe(3)
      expect(JSON.parse(verdict.selectedRuleIds ?? 'null')).toEqual(['DS-STANDARD-OF-FILL'])
      expect(JSON.parse(verdict.selectionInputs ?? 'null')).toEqual({
        productType: 'Distilled spirits',
      })
      expect(verdict.submittedOn).toBe('2026-08-01')
    })

    it('keeps the rule-set version apart from the region-map policy version', () => {
      // Two unrelated things with confusingly similar names (§18.3). Sharing a
      // column would make them move together and leave neither traceable.
      const { verdict } = buildPersistPlan(governed(), ids, 300)
      expect(verdict.policyVersion).toBe('policy@1')
      expect(verdict.policySetVersion).toBe(3)
    })

    it('stores each finding with the evidence it decided on (FR-10)', () => {
      const { findings } = buildPersistPlan(governed(), ids, 300)
      expect(findings).toHaveLength(1)
      expect(findings[0]?.state).toBe('VIOLATED')
      expect(findings[0]?.severity).toBe('blocking')
      expect(findings[0]?.evidence).toContain('800 mL')
      // The wording as it stood when applied. Looking it up later would read
      // today's set, and a superseded rule would be reported with wording it
      // never had when this verdict was reached.
      expect(findings[0]?.requirement).toMatch(/authorised standard of fill/)
    })

    it('records no binding at all when no rule was applied', () => {
      // Not version 0, and not the loaded set's version. A verdict naming a
      // policy set is claiming rules were applied to it.
      const { verdict, findings } = buildPersistPlan(result(), ids, 300)
      expect(verdict.policySetVersion).toBeNull()
      expect(verdict.selectedRuleIds).toBeNull()
      expect(verdict.selectionInputs).toBeNull()
      expect(verdict.submittedOn).toBeNull()
      expect(findings).toEqual([])
    })
  })

  it('keeps both the expected and observed values as evidence (FR-10)', () => {
    const plan = buildPersistPlan(result(), ids, 300)
    const abv = plan.fields.find((f) => f.field === 'alcoholContent')
    expect(abv).toMatchObject({ state: 'MISMATCH', expected: '45%', observed: '40% Alc./Vol.' })
  })

  it('preserves the rule and the explanation on each field', () => {
    const plan = buildPersistPlan(result(), ids, 300)
    const brand = plan.fields.find((f) => f.field === 'brandName')
    expect(brand?.rule).toContain('ignoring capitalisation')
    expect(brand?.explanation).toBe('Capitalisation differs — treated as a match.')
  })

  it('encodes warning segment pass/fail as 0/1 with the deviation', () => {
    const plan = buildPersistPlan(result(), ids, 300)
    expect(plan.warning.find((w) => w.segmentId === 'header')?.ok).toBe(1)
    const clause = plan.warning.find((w) => w.segmentId === 'clause_1')
    expect(clause?.ok).toBe(0)
    expect(clause?.deviation).toContain('defect')
  })

  it('records two blind extractions, each with its raster DPI and raw response', () => {
    const plan = buildPersistPlan(result(), ids, 300)
    expect(plan.extractions).toHaveLength(2)
    expect(plan.extractions.map((e) => e.region).sort()).toEqual(['label', 'record'])
    for (const e of plan.extractions) {
      expect(e.method).toBe('vision')
      expect(e.rasterDpi).toBe(300)
      expect(e.rawResponse).not.toBe('')
    }
    expect(plan.verdict.extractionIds).toBe(JSON.stringify(['ex-label', 'ex-record']))
  })

  it('records only the label extraction when the record was not read from an image', () => {
    const r = result({
      provenance: { label: PROVENANCE, record: null },
      rawResponses: { label: '{"fields":{}}', record: null },
    })
    const plan = buildPersistPlan(r, { ...ids, recordExtractionId: null }, 300)
    expect(plan.extractions).toHaveLength(1)
    expect(plan.extractions[0]?.region).toBe('label')
  })
})
