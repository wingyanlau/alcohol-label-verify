/**
 * Gemini adapter.
 *
 * `fetch` is injected, so these assert the adapter's own behaviour — request
 * shape, envelope handling, fault classification, provenance — and never reach
 * the network. Whether Gemini reads a 4.5pt warning better than Workers AI is
 * B-Q4, measured against the corpus, not here.
 */

import { describe, expect, it } from 'vitest'
import { ExtractionContractError, type ExtractionRequest } from '../domain/extraction.js'
import { createGeminiProvider, GEMINI_SPEC } from './gemini.js'
import { PROMPT_VERSION } from './prompt.js'

const request: ExtractionRequest = {
  region: 'label',
  image: new ArrayBuffer(8),
  mimeType: 'image/png',
  fields: ['brandName', 'classType', 'alcoholContent', 'netContents'],
  includeWarning: true,
}

const body = {
  fields: {
    brandName: { value: 'OLD TOM DISTILLERY', confidence: 0.96 },
    classType: { value: 'Kentucky Straight Bourbon Whiskey', confidence: 0.94 },
    alcoholContent: { value: '45% Alc./Vol.', confidence: 0.92 },
    netContents: { value: '750 mL', confidence: 0.9 },
  },
  warningStatement: 'GOVERNMENT WARNING: (1) According to the Surgeon General…',
}

const ok = (text: string) =>
  new Response(
    JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }] }),
    {
      status: 200,
      headers: { 'content-type': 'application/json' },
    },
  )

const raw = (envelope: unknown, status = 200) =>
  new Response(JSON.stringify(envelope), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const provider = (respond: (req: Request) => Response, capture?: (req: Request) => void) =>
  createGeminiProvider({
    apiKey: 'test-key',
    modelId: 'gemini-2.5-flash',
    now: (() => {
      let t = 1000
      return () => (t += 250)
    })(),
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input as RequestInfo, init)
      capture?.(req)
      return respond(req)
    }) as unknown as typeof fetch,
  })

describe('the request', () => {
  it('sends the prompt and the image as parts of one turn', async () => {
    let sent: unknown
    await provider(
      () => ok(JSON.stringify(body)),
      async (req) => {
        sent = await req.clone().json()
      },
    ).extract(request)

    const parts = (sent as { contents: { parts: Record<string, unknown>[] }[] }).contents[0]?.parts
    expect(parts?.[0]?.text).toContain('brandName')
    expect(parts?.[1]?.inline_data).toMatchObject({ mime_type: 'image/png' })
  })

  // A credential in a URL is captured by anything that logs one (§9.3, D20).
  it('carries the credential in a header, never the query string', async () => {
    let seen: Request | undefined
    await provider(
      () => ok(JSON.stringify(body)),
      (req) => {
        seen = req
      },
    ).extract(request)

    expect(seen?.headers.get('x-goog-api-key')).toBe('test-key')
    expect(seen?.url).not.toContain('test-key')
  })

  // CT-10, restated for the second adapter: ExtractionRequest has no slot for
  // application data, so no expected value can reach the wire.
  it('sends no expected value', async () => {
    let sent = ''
    await provider(
      () => ok(JSON.stringify(body)),
      async (req) => {
        sent = await req.clone().text()
      },
    ).extract(request)

    for (const leak of ['Old Tom', '45%', '750 mL', 'Bourbon']) {
      expect(sent).not.toContain(leak)
    }
  })
})

describe('the envelope', () => {
  it('reads the answer from the first candidate', async () => {
    const r = await provider(() => ok(JSON.stringify(body))).extract(request)
    expect(r.extraction.fields.brandName.raw).toBe('OLD TOM DISTILLERY')
    expect(r.extraction.warningStatement).toContain('GOVERNMENT WARNING')
  })

  it('joins multi-part answers before parsing', async () => {
    const text = JSON.stringify(body)
    const split = raw({
      candidates: [
        {
          finishReason: 'STOP',
          content: { parts: [{ text: text.slice(0, 20) }, { text: text.slice(20) }] },
        },
      ],
    })
    const r = await provider(() => split).extract(request)
    expect(r.extraction.fields.netContents.raw).toBe('750 mL')
  })

  // Collapsing every no-text case into "empty response" is the mistake that
  // cost three rounds of debugging against the other provider: an inference
  // reported as an observation. Each of these says which it was.
  it('says when the prompt was blocked', async () => {
    const blocked = raw({ promptFeedback: { blockReason: 'SAFETY' } })
    await expect(provider(() => blocked).extract(request)).rejects.toThrow(/blocked \(SAFETY\)/)
  })

  it('says when the answer was withheld', async () => {
    const withheld = raw({ candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }] })
    await expect(provider(() => withheld).extract(request)).rejects.toThrow(/withheld \(SAFETY\)/)
  })

  it('says when the answer was truncated before producing text', async () => {
    const cut = raw({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [] } }] })
    await expect(provider(() => cut).extract(request)).rejects.toThrow(/truncated/)
  })

  it('reports a genuinely empty answer as empty', async () => {
    const empty = raw({
      candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '  ' }] } }],
    })
    await expect(provider(() => empty).extract(request)).rejects.toThrow(/empty response/)
  })

  it('carries the HTTP status into the message, because classify reads it', async () => {
    const denied = new Response('PERMISSION_DENIED', { status: 403 })
    await expect(provider(() => denied).extract(request)).rejects.toThrow(/HTTP 403/)
  })

  it('never repairs a malformed answer into a finding', async () => {
    const nonsense = ok('the label says Old Tom, 45%')
    await expect(provider(() => nonsense).extract(request)).rejects.toThrow(ExtractionContractError)
  })
})

describe('the liveness check', () => {
  // It failed a healthy deployment. At 8 output tokens with thinking left on,
  // the budget went entirely to reasoning and no answer was ever emitted, so
  // the probe reported a truncation for a model that was answering fine
  // through the extraction path beside it. A liveness check configured
  // differently from production is not checking production.
  it('asks under the same thinking settings the real call uses', async () => {
    let sent: Record<string, unknown> = {}
    await provider(
      () => ok('ready'),
      async (req) => {
        sent = (await req.clone().json()) as Record<string, unknown>
      },
    ).ping()

    const cfg = sent.generationConfig as Record<string, unknown>
    expect((cfg.thinkingConfig as Record<string, unknown>).thinkingBudget).toBe(0)
    expect(cfg.maxOutputTokens as number).toBeGreaterThan(8)
  })

  it('reports an unreachable model rather than staying silent', async () => {
    const denied = new Response('PERMISSION_DENIED', { status: 403 })
    await expect(provider(() => denied).ping()).rejects.toThrow(/HTTP 403/)
  })
})

describe('provenance', () => {
  it('reports the vendor, the model and the shared prompt version', async () => {
    const r = await provider(() => ok(JSON.stringify(body))).extract(request)
    expect(r.provenance.provider).toBe('gemini')
    expect(r.provenance.modelId).toBe('gemini-2.5-flash')
    // The same lineage as the other adapter: one instruction, two readers.
    expect(r.provenance.promptVersion).toBe(PROMPT_VERSION)
    expect(r.provenance.samplingParameters.temperature).toBe(0)
  })
})

describe('the spec', () => {
  it('requires a credential, unlike a binding-authed provider', () => {
    expect(GEMINI_SPEC.requiresCredential).toBe(true)
  })

  // Written the other way round first, demanding a `-NNN` pin, on the
  // assumption that a bare name must be an alias. The API disagreed with a
  // 404: Google retired numbered pins after 1.5/2.0, and the stable name is
  // the durable identifier. What is refused is what actually moves.
  it('refuses the identifiers that genuinely move', () => {
    expect(GEMINI_SPEC.isFloatingModelId('gemini-2.5-pro-latest')).toBe(true)
    expect(GEMINI_SPEC.isFloatingModelId('gemini-2.0-flash-exp')).toBe(true)
    expect(GEMINI_SPEC.isFloatingModelId('gemini-2.5-flash-preview-05-20')).toBe(true)
    expect(GEMINI_SPEC.isFloatingModelId('gemini-2.5-flash-preview')).toBe(true)
  })

  it('accepts a stable name, which is the strongest pin Google offers', () => {
    expect(GEMINI_SPEC.isFloatingModelId('gemini-2.5-flash')).toBe(false)
    expect(GEMINI_SPEC.isFloatingModelId('gemini-2.5-pro')).toBe(false)
    // Older families did publish numbered pins; those remain acceptable.
    expect(GEMINI_SPEC.isFloatingModelId('gemini-2.0-flash-001')).toBe(false)
  })

  // Gemini reports both a per-minute limit and a spent daily quota as
  // RESOURCE_EXHAUSTED, and they demand opposite responses. Read
  // conservatively: only explicitly daily wording abandons the job, because a
  // wrong 'rate-limited' costs minutes and a wrong 'quota-exhausted' costs a
  // batch that would have succeeded.
  it('treats a bare RESOURCE_EXHAUSTED as something to wait out', () => {
    expect(GEMINI_SPEC.classify(new Error('429 RESOURCE_EXHAUSTED'))).toBe('rate-limited')
  })

  it('abandons the job only when the exhausted quota is a daily one', () => {
    expect(GEMINI_SPEC.classify(new Error('429 RESOURCE_EXHAUSTED: quota exceeded per day'))).toBe(
      'quota-exhausted',
    )
    expect(GEMINI_SPEC.classify(new Error('429: limit: GenerateRequestsPerDayPerProject'))).toBe(
      'quota-exhausted',
    )
  })

  // Every 429 carries the same advice — "check your plan and billing details" —
  // whether the limit was per minute or per day, and the earlier rule matched
  // on exactly that boilerplate. It read a routine rate limit as a spent
  // allowance, which abandons a batch that only needed to wait a moment.
  it('is not fooled by the billing advice attached to every 429', () => {
    const perMinute = new Error(
      '429: You exceeded your current quota, please check your plan and billing details. ' +
        'Quota exceeded for quota metric: generate_content_requests, limit: per minute',
    )
    expect(GEMINI_SPEC.classify(perMinute)).toBe('rate-limited')
  })

  // "This model is currently experiencing high demand. Spikes in demand are
  // usually temporary. Please try again later." — observed live. It is an
  // instruction to wait, so it belongs with the rate limits rather than with
  // the faults that redeliver immediately: treating it as merely transient
  // spends queue attempts hammering a model that has asked for a pause.
  it('waits out an overloaded model rather than hammering it', () => {
    const busy = new Error(
      'provider returned HTTP 503: {"error":{"code":503,"message":"This model is ' +
        'currently experiencing high demand. Spikes in demand are usually temporary. ' +
        'Please try again later.","status":"UNAVAILABLE"}}',
    )
    expect(GEMINI_SPEC.classify(busy)).toBe('rate-limited')
    expect(GEMINI_SPEC.classify(new Error('UNAVAILABLE'))).toBe('rate-limited')
    expect(GEMINI_SPEC.classify(new Error('HTTP 500: INTERNAL'))).toBe('transient')
  })

  it('never waits on a credential or request fault', () => {
    expect(GEMINI_SPEC.classify(new Error('HTTP 403: PERMISSION_DENIED'))).toBe('permanent')
    expect(GEMINI_SPEC.classify(new Error('HTTP 400: invalid API_KEY'))).toBe('permanent')
  })
})
