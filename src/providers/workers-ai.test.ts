/**
 * Workers AI adapter.
 *
 * The provider is faked: these tests assert the adapter's own behaviour —
 * prompt construction, response salvage, provenance, and the blind-extraction
 * guarantee — not the model's reading ability. Whether a model can read a
 * 4.5 pt warning statement is B-Q4, measured against the corpus.
 */

import { describe, expect, it, vi } from 'vitest'
import { ExtractionContractError, type ExtractionRequest } from '../domain/extraction.js'
import { createWorkersAiProvider, PROMPT_VERSION } from './workers-ai.js'

const request: ExtractionRequest = {
  region: 'label',
  image: new ArrayBuffer(4),
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

/** A fake Ai binding that returns whatever text it is given. */
const fakeAi = (text: string, capture?: (input: unknown) => void) =>
  ({
    run: vi.fn(async (_model: string, input: unknown) => {
      capture?.(input)
      return { response: text }
    }),
  }) as unknown as Ai

const provider = (text: string, capture?: (input: unknown) => void) =>
  createWorkersAiProvider({
    ai: fakeAi(text, capture),
    modelId: '@cf/meta/llama-4-scout-17b-16e-instruct',
    now: (() => {
      let t = 1000
      return () => (t += 250)
    })(),
  })

describe('response handling', () => {
  it('parses a plain JSON response', async () => {
    const r = await provider(JSON.stringify(body)).extract(request)
    expect(r.extraction.fields.brandName.raw).toBe('OLD TOM DISTILLERY')
    expect(r.extraction.warningStatement).toContain('GOVERNMENT WARNING')
  })

  it('parses a fenced JSON response', async () => {
    const r = await provider(`\`\`\`json\n${JSON.stringify(body)}\n\`\`\``).extract(request)
    expect(r.extraction.fields.netContents.raw).toBe('750 mL')
  })

  it('salvages JSON wrapped in prose — once', async () => {
    const r = await provider(
      `Here is what I found:\n${JSON.stringify(body)}\nHope that helps.`,
    ).extract(request)
    expect(r.extraction.fields.classType.raw).toContain('Bourbon')
  })

  it('rejects a response that is not JSON at all', async () => {
    await expect(provider('The label says Old Tom, 45%.').extract(request)).rejects.toThrow(
      ExtractionContractError,
    )
  })

  it('rejects an empty response', async () => {
    await expect(provider('').extract(request)).rejects.toThrow(/empty response/)
  })

  it('propagates a contract violation rather than repairing it', async () => {
    // A malformed response is a dependency failure, never a verdict (§8.3).
    const broken = { fields: { brandName: { value: 42 } } }
    await expect(provider(JSON.stringify(broken)).extract(request)).rejects.toThrow(
      ExtractionContractError,
    )
  })
})

describe('provenance (§8.7.1)', () => {
  it('reports the model, prompt version, sampling parameters and latency', async () => {
    const r = await provider(JSON.stringify(body)).extract(request)
    expect(r.provenance.provider).toBe('workers-ai')
    expect(r.provenance.modelId).toBe('@cf/meta/llama-4-scout-17b-16e-instruct')
    expect(r.provenance.promptVersion).toBe(PROMPT_VERSION)
    expect(r.provenance.samplingParameters.temperature).toBe(0)
    expect(r.provenance.latencyMs).toBeGreaterThan(0)
  })

  it('retains the raw response verbatim — it is also the test fixture', async () => {
    const text = JSON.stringify(body)
    expect((await provider(text).extract(request)).rawResponse).toBe(text)
  })

  // The regression. The image used to travel as a sibling of `messages`, which
  // this model accepts and silently ignores — it does not error, it answers
  // from the prompt alone, and under a required JSON schema that means it
  // invents a value. Every field of every submission came back as the prompt's
  // own placeholder, and nothing objected.
  it('sends the image inside the message, not as a sibling of it', async () => {
    let sent: unknown
    await provider(JSON.stringify(body), (i) => {
      sent = i
    }).extract(request)

    const input = sent as { messages: { content: unknown }[]; image?: unknown }

    // A sibling `image` is the shape that was ignored. Its absence is the fix.
    expect(input.image).toBeUndefined()

    const content = input.messages[0]?.content
    expect(Array.isArray(content)).toBe(true)

    const parts = content as { type: string; image_url?: { url: string } }[]
    const image = parts.find((p) => p.type === 'image_url')
    expect(image).toBeDefined()
    expect(image?.image_url?.url).toMatch(/^data:image\/png;base64,.+/)
  })
})

/**
 * The prompt text, dug out of the message.
 *
 * The image travels as a content part alongside the text, so `content` is an
 * array rather than a string. Reading it as a string used to work and silently
 * yielded "[object Object]" — which still *contained* nothing, so an assertion
 * that the prompt names a field would have passed for the wrong reason had it
 * been written with `not.toContain`.
 */
function promptTextOf(sent: unknown): string {
  const content = (sent as { messages?: { content?: unknown }[] }).messages?.[0]?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((part): part is { type: string; text: string } => {
      return (
        typeof part === 'object' && part !== null && (part as { type?: string }).type === 'text'
      )
    })
    .map((part) => part.text)
    .join('\n')
}

describe('the prompt', () => {
  it('names the fields to find', async () => {
    let sent: unknown
    await provider(JSON.stringify(body), (i) => {
      sent = i
    }).extract(request)
    const prompt = promptTextOf(sent)
    expect(prompt).toContain('brandName')
    expect(prompt).toContain('netContents')
  })

  it('makes refusing as easy as answering (§8.3.2)', async () => {
    let sent: unknown
    await provider(JSON.stringify(body), (i) => {
      sent = i
    }).extract(request)
    const prompt = promptTextOf(sent)
    expect(prompt).toMatch(/CANNOT READ/)
    expect(prompt).toMatch(/Do not guess/)
    expect(prompt).toMatch(/correct and expected answer/)
  })

  it('asks for the warning verbatim, because FR-6 turns on capitalisation', async () => {
    let sent: unknown
    await provider(JSON.stringify(body), (i) => {
      sent = i
    }).extract(request)
    const prompt = promptTextOf(sent)
    expect(prompt).toMatch(/VERBATIM/)
    expect(prompt).toMatch(/capitalisation/i)
  })

  it('omits the warning instruction when it was not requested', async () => {
    let sent: unknown
    await provider(JSON.stringify({ fields: body.fields }), (i) => {
      sent = i
    }).extract({ ...request, includeWarning: false })
    const prompt = promptTextOf(sent)
    expect(prompt).not.toMatch(/VERBATIM/)
  })

  it('CT-10 — no expected value reaches the provider', async () => {
    // The adapter has no application data to leak: ExtractionRequest has no
    // slot for it. This asserts the whole payload, prompt included.
    let sent: unknown
    await provider(JSON.stringify(body), (i) => {
      sent = i
    }).extract(request)
    const payload = JSON.stringify(sent)
    for (const leak of ['Old Tom Distillery', '45%', '750 mL', 'Kentucky Straight']) {
      expect(payload).not.toContain(leak)
    }
  })
})
