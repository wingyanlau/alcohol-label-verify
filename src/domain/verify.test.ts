/**
 * Pipeline tests.
 *
 * These use a stub provider rather than a model: the pipeline's job is
 * orchestration, and its correctness is about *which calls it makes and what it
 * does with them*, not about reading ability.
 *
 * The two properties worth asserting here cannot be tested anywhere else:
 * the extractions are separate and concurrent (B-D1, §8.8.2), and no
 * application value reaches either call (D4).
 */

import { describe, expect, it, vi } from 'vitest'
import type { ExtractionProvider, ExtractionRequest, ExtractionResult } from './extraction.js'
import { warningReference } from './reference.js'
import type { ApplicationData } from './types.js'
import { verifySubmission } from './verify.js'

/** A deterministic clock. Timings are then facts about the test, not the machine. */
const clock = () => {
  let t = 0
  return () => (t += 10)
}

/**
 * The filing date, stated rather than derived.
 *
 * `now` above is the TIMING clock — it counts in tens so durations are facts
 * about the test. Deriving a calendar date from it gave 1970-01-01, which
 * silently dropped every rule with an `effectiveFrom` and left these tests
 * exercising seven rules while reading as though they exercised eight.
 */
const FILED = '2026-08-01'

const REQUIRED = warningReference()
  .segments.map((s) => s.text)
  .join(' ')

const application: ApplicationData = {
  brandName: 'Old Tom Distillery',
  classType: 'Kentucky Straight Bourbon Whiskey',
  alcoholContent: '45% Alc./Vol.',
  netContents: '750 mL',
  // Stated on the application, and the input rule selection runs on (D25).
  productType: 'Distilled spirits',
}

const labelReading = (over: Partial<Record<string, unknown>> = {}) => ({
  fields: {
    brandName: { value: 'OLD TOM DISTILLERY', confidence: 0.96 },
    classType: { value: 'Kentucky Straight Bourbon Whiskey', confidence: 0.95 },
    alcoholContent: { value: '45% Alc./Vol.', confidence: 0.93 },
    netContents: { value: '750 mL', confidence: 0.92 },
    ...(over.fields as object),
  },
  warningStatement: 'warningStatement' in over ? over.warningStatement : REQUIRED,
})

const recordReading = {
  fields: {
    brandName: { value: application.brandName },
    classType: { value: application.classType },
    alcoholContent: { value: application.alcoholContent },
    netContents: { value: application.netContents },
  },
}

/** Records every request it receives, so the tests can inspect them. */
function stubProvider(byRegion: { label: unknown; record: unknown }) {
  const seen: ExtractionRequest[] = []
  const inFlight: string[] = []
  let concurrentPeak = 0

  const provider: ExtractionProvider = {
    name: 'stub',
    async extract(request): Promise<ExtractionResult> {
      seen.push(request)
      inFlight.push(request.region)
      concurrentPeak = Math.max(concurrentPeak, inFlight.length)
      await new Promise((r) => setTimeout(r, 5))
      inFlight.splice(inFlight.indexOf(request.region), 1)

      const body = request.region === 'label' ? byRegion.label : byRegion.record
      const { parseExtractionResponse } = await import('./extraction.js')
      return {
        extraction: parseExtractionResponse(body, {
          fields: request.fields,
          includeWarning: request.includeWarning,
        }),
        rawResponse: JSON.stringify(body),
        provenance: {
          provider: 'stub',
          modelId: 'stub@1',
          promptVersion: 'stub@1',
          samplingParameters: {},
          latencyMs: 5,
        },
      }
    },
  }
  return { provider, seen, peak: () => concurrentPeak }
}

const images = {
  label: { image: new ArrayBuffer(4), mimeType: 'image/png' },
  record: { image: new ArrayBuffer(4), mimeType: 'image/png' },
}

describe('the pipeline produces a verdict', () => {
  it('a compliant submission raises no discrepancy', async () => {
    const { provider } = stubProvider({ label: labelReading(), record: recordReading })
    const r = await verifySubmission(images, { provider, now: clock(), submittedOn: FILED })
    expect(r.problemCount).toBe(0)
    expect(r.fields.every((f) => f.state === 'MATCH')).toBe(true)
    expect(r.warning.ok).toBe(true)
  })

  it('a compliant submission with its product type declared is CLEAR', async () => {
    const { provider } = stubProvider({ label: labelReading(), record: recordReading })
    const r = await verifySubmission(
      { label: images.label, record: { applicationData: application } },
      { provider, now: clock(), submittedOn: FILED },
    )
    expect(r.outcome).toBe('CLEAR')
    expect(r.summary).toBe('Everything matches')
    expect(r.findings.some((f) => f.state === 'VIOLATED')).toBe(false)
    // Named, not counted. A dated rule dropping out of selection is invisible
    // in a count and in an outcome — the submission still passes, on fewer
    // rules than anyone reading this test would assume were applied.
    expect(r.policy.selectedRuleIds).toContain('DS-STANDARD-OF-FILL')
    expect(r.policy.submittedOn).toBe(FILED)
  })

  it('judges the submission by the rules in force on its filing date', async () => {
    // The same submission, filed before the January 2025 standards of fill.
    // Selection must drop that rule — and the date has to come from the caller
    // for it to be able to.
    const { provider } = stubProvider({ label: labelReading(), record: recordReading })
    const r = await verifySubmission(
      { label: images.label, record: { applicationData: application } },
      { provider, now: clock(), submittedOn: '2024-06-01' },
    )
    expect(r.policy.selectedRuleIds).not.toContain('DS-STANDARD-OF-FILL')
    expect(r.policy.selectedRuleIds).toContain('DS-BRAND-NAME-PRESENT')
  })

  /*
   * A limitation, asserted rather than described.
   *
   * Every rule in the set is conditioned on product type, and product type is
   * item 5 on the form — not one of `FIELDS`, so a record read from an image
   * does not carry it. That path therefore applies no regulation at all, and
   * the honest report is that nothing was checked, not that nothing was wrong.
   *
   * The batch path is unaffected: it supplies application data structurally,
   * product type included. If the extractor is ever taught to read item 5,
   * this test is the one that should change.
   */
  it('says nothing was checked when the record was read from an image', async () => {
    const { provider } = stubProvider({ label: labelReading(), record: recordReading })
    const r = await verifySubmission(images, { provider, now: clock(), submittedOn: FILED })
    expect(r.outcome).toBe('CLEAR_CONFIRM_POLICY')
    expect(r.policy.selectedRuleIds).toEqual([])
    expect(r.findings.map((f) => f.ruleId)).toEqual(['POLICY-SELECTION'])
  })

  it('a genuine mismatch is localised to the offending field', async () => {
    const { provider } = stubProvider({
      label: labelReading({ fields: { alcoholContent: { value: '40% Alc./Vol.' } } }),
      record: recordReading,
    })
    const r = await verifySubmission(images, { provider, now: clock(), submittedOn: FILED })
    expect(r.outcome).toBe('DISCREPANCIES_FOUND')
    expect(r.fields.filter((f) => f.state === 'MISMATCH').map((f) => f.field)).toEqual([
      'alcoholContent',
    ])
    expect(r.summary).toMatch(/alcohol content/i)
  })

  it('an unreadable field yields INCOMPLETE even alongside a mismatch (D5)', async () => {
    const { provider } = stubProvider({
      label: labelReading({
        fields: {
          alcoholContent: { value: '40% Alc./Vol.' },
          netContents: { unreadable: true },
        },
      }),
      record: recordReading,
    })
    const r = await verifySubmission(images, { provider, now: clock(), submittedOn: FILED })
    expect(r.outcome).toBe('INCOMPLETE')
  })

  it('a title-case warning header is a discrepancy (FR-6)', async () => {
    const { provider } = stubProvider({
      label: labelReading({
        warningStatement: REQUIRED.replace('GOVERNMENT WARNING:', 'Government Warning:'),
      }),
      record: recordReading,
    })
    const r = await verifySubmission(images, { provider, now: clock(), submittedOn: FILED })
    expect(r.outcome).toBe('DISCREPANCIES_FOUND')
    expect(r.warning.ok).toBe(false)
  })

  it('accepts application data supplied directly, skipping record extraction', async () => {
    const { provider, seen } = stubProvider({ label: labelReading(), record: recordReading })
    const r = await verifySubmission(
      { label: images.label, record: { applicationData: application } },
      { provider, now: clock(), submittedOn: FILED },
    )
    expect(r.outcome).toBe('CLEAR')
    expect(seen.map((s) => s.region)).toEqual(['label'])
    expect(r.provenance.record).toBeNull()
  })
})

describe('B-D1 — the extractions are separate and blind', () => {
  it('makes two calls, one per region', async () => {
    const { provider, seen } = stubProvider({ label: labelReading(), record: recordReading })
    await verifySubmission(images, { provider, now: clock(), submittedOn: FILED })
    expect(seen.map((s) => s.region).sort()).toEqual(['label', 'record'])
  })

  it('runs them concurrently, so the layer costs one round trip (§8.8.2)', async () => {
    const { provider, peak } = stubProvider({ label: labelReading(), record: recordReading })
    await verifySubmission(images, { provider, now: clock(), submittedOn: FILED })
    expect(peak()).toBe(2)
  })

  it('D4 — no application value reaches either call', async () => {
    const { provider, seen } = stubProvider({ label: labelReading(), record: recordReading })
    await verifySubmission(images, { provider, now: clock(), submittedOn: FILED })
    const payload = JSON.stringify(seen.map((s) => ({ ...s, image: '<bytes>' })))
    for (const leak of Object.values(application)) {
      if (leak) expect(payload).not.toContain(leak)
    }
  })

  it('only the label extraction asks for the warning statement', async () => {
    const { provider, seen } = stubProvider({ label: labelReading(), record: recordReading })
    await verifySubmission(images, { provider, now: clock(), submittedOn: FILED })
    expect(seen.find((s) => s.region === 'label')?.includeWarning).toBe(true)
    expect(seen.find((s) => s.region === 'record')?.includeWarning).toBe(false)
  })
})

describe('provenance and timings', () => {
  it('reports provenance for each extraction it performed', async () => {
    const { provider } = stubProvider({ label: labelReading(), record: recordReading })
    const r = await verifySubmission(images, { provider, now: clock(), submittedOn: FILED })
    expect(r.provenance.label.modelId).toBe('stub@1')
    expect(r.provenance.record?.modelId).toBe('stub@1')
  })

  it('retains both raw responses — provenance and test fixture', async () => {
    const { provider } = stubProvider({ label: labelReading(), record: recordReading })
    const r = await verifySubmission(images, { provider, now: clock(), submittedOn: FILED })
    expect(r.rawResponses.label).toContain('OLD TOM DISTILLERY')
    expect(r.rawResponses.record).toContain('Old Tom Distillery')
  })

  it('records per-stage timings for the latency budget (§9.1)', async () => {
    let t = 0
    const { provider } = stubProvider({ label: labelReading(), record: recordReading })
    const r = await verifySubmission(images, {
      provider,
      now: () => (t += 10),
      submittedOn: FILED,
    })
    expect(r.timings.extractMs).toBeGreaterThan(0)
    expect(r.timings.totalMs).toBeGreaterThanOrEqual(r.timings.extractMs)
  })
})

describe('dependency failure', () => {
  it('propagates rather than issuing a verdict (§8.3)', async () => {
    const provider: ExtractionProvider = {
      name: 'failing',
      extract: vi.fn(async () => {
        throw new Error('provider unavailable')
      }),
    }
    await expect(
      verifySubmission(images, { provider, now: clock(), submittedOn: FILED }),
    ).rejects.toThrow(/provider unavailable/)
  })
})
