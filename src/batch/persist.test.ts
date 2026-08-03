import { describe, expect, it } from 'vitest'
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
        rule: 'Matches after ignoring capitalisation, punctuation and spacing',
        explanation: 'Capitalisation differs — treated as a match.',
      },
      {
        field: 'alcoholContent',
        state: 'MISMATCH',
        expected: '45%',
        observed: '40% Alc./Vol.',
        rule: 'Compared as numbers, ignoring format',
      },
    ],
    warning: {
      present: true,
      ok: false,
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
    expect(plan.verdict.aggregationVersion).toBe('aggregate@1')
    expect(plan.verdict.referenceDataVersion).toBe(1)
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
