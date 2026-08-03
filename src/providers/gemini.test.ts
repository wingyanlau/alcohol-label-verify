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
    modelId: 'gemini-2.5-flash-002',
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

describe('provenance', () => {
  it('reports the vendor, the model and the shared prompt version', async () => {
    const r = await provider(() => ok(JSON.stringify(body))).extract(request)
    expect(r.provenance.provider).toBe('gemini')
    expect(r.provenance.modelId).toBe('gemini-2.5-flash-002')
    // The same lineage as the other adapter: one instruction, two readers.
    expect(r.provenance.promptVersion).toBe(PROMPT_VERSION)
    expect(r.provenance.samplingParameters.temperature).toBe(0)
  })
})

describe('the spec', () => {
  it('requires a credential, unlike a binding-authed provider', () => {
    expect(GEMINI_SPEC.requiresCredential).toBe(true)
  })

  // Google floats by OMITTING a version, not by suffix. The suffix list that
  // guards D29 for Cloudflare would wave `gemini-2.5-flash` straight through.
  it('treats an unversioned model id as floating', () => {
    expect(GEMINI_SPEC.isFloatingModelId('gemini-2.5-flash')).toBe(true)
    expect(GEMINI_SPEC.isFloatingModelId('gemini-2.5-pro-latest')).toBe(true)
    expect(GEMINI_SPEC.isFloatingModelId('gemini-2.0-flash-exp')).toBe(true)
    expect(GEMINI_SPEC.isFloatingModelId('gemini-2.5-flash-002')).toBe(false)
  })

  // Gemini reports both a per-minute limit and a spent daily quota as
  // RESOURCE_EXHAUSTED, and they demand opposite responses. Read
  // conservatively: only explicitly daily wording abandons the job, because a
  // wrong 'rate-limited' costs minutes and a wrong 'quota-exhausted' costs a
  // batch that would have succeeded.
  it('treats a bare RESOURCE_EXHAUSTED as something to wait out', () => {
    expect(GEMINI_SPEC.classify(new Error('429 RESOURCE_EXHAUSTED'))).toBe('rate-limited')
  })

  it('abandons the job only when the wording is daily or billing shaped', () => {
    expect(GEMINI_SPEC.classify(new Error('429 RESOURCE_EXHAUSTED: quota exceeded per day'))).toBe(
      'quota-exhausted',
    )
    expect(GEMINI_SPEC.classify(new Error('RESOURCE_EXHAUSTED: free tier limit'))).toBe(
      'quota-exhausted',
    )
  })

  it('never waits on a credential or request fault', () => {
    expect(GEMINI_SPEC.classify(new Error('HTTP 403: PERMISSION_DENIED'))).toBe('permanent')
    expect(GEMINI_SPEC.classify(new Error('HTTP 400: invalid API_KEY'))).toBe('permanent')
  })
})
