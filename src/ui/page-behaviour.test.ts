/**
 * The page, actually run.
 *
 * `page.test.ts` asserts the document contains what it should. That catches a
 * missing option and nothing else — two defects reached staging under a green
 * suite because the only way to find them was to execute the script:
 *
 *   1. a judgement row rendering as "Checking…" forever, and
 *   2. the reset button leaving the page unable to start again.
 *
 * So this file runs the shipped script against a small DOM, drives it the way
 * an agent would, and asserts what ends up on screen. The shim implements only
 * what the page uses; it is not a browser and does not pretend to be one — no
 * layout, no CSS, no real network. What it does prove is control flow, which is
 * where both defects lived.
 */

import { describe, expect, it } from 'vitest'
import { PAGE_HTML } from './page.js'

class El {
  tagName: string
  children: El[] = []
  attrs: Record<string, string> = {}
  style: Record<string, string> = {}
  listeners: Record<string, Array<(e: unknown) => void>> = {}
  value = ''
  disabled = false
  className = ''
  tabIndex = 0
  private text = ''
  private classes = new Set<string>()
  classList = {
    add: (...c: string[]) => {
      for (const x of c) this.classes.add(x)
    },
    remove: (...c: string[]) => {
      for (const x of c) this.classes.delete(x)
    },
    contains: (c: string) => this.classes.has(c),
    toggle: (c: string, on?: boolean) =>
      on === undefined
        ? this.classes.has(c)
          ? this.classes.delete(c)
          : this.classes.add(c)
        : on
          ? this.classes.add(c)
          : this.classes.delete(c),
  }

  constructor(tag: string) {
    this.tagName = (tag || 'div').toUpperCase()
  }
  get textContent(): string {
    return this.text
  }
  set textContent(v: string) {
    this.text = String(v)
    this.children = []
  }
  appendChild(c: El): El {
    this.children.push(c)
    return c
  }
  removeChild(c: El) {
    this.children = this.children.filter((x) => x !== c)
  }
  setAttribute(k: string, v: string) {
    this.attrs[k] = v
  }
  removeAttribute(k: string) {
    delete this.attrs[k]
  }
  getAttribute(k: string) {
    return this.attrs[k]
  }
  addEventListener(t: string, fn: (e: unknown) => void) {
    const bucket = this.listeners[t] ?? []
    bucket.push(fn)
    this.listeners[t] = bucket
  }
  removeEventListener() {}
  focus() {}
  remove() {}
  click() {
    for (const f of this.listeners.click ?? []) f({ preventDefault() {} })
  }
  querySelector(): El | null {
    return null
  }
  /** The first descendant with this tag, for driving a control in a test. */
  find(tag: string): El | null {
    if (this.tagName === tag.toUpperCase()) return this
    for (const c of this.children) {
      const hit = c.find(tag)
      if (hit) return hit
    }
    return null
  }
  /** Every descendant with this tag, in document order. */
  findAll(tag: string): El[] {
    const out: El[] = this.tagName === tag.toUpperCase() ? [this] : []
    for (const c of this.children) out.push(...c.findAll(tag))
    return out
  }
  count(tag: string): number {
    let n = this.tagName === tag.toUpperCase() ? 1 : 0
    for (const c of this.children) n += c.count(tag)
    return n
  }
  /** Every bit of text under this element, for asserting what an agent reads. */
  words(): string {
    return [this.text, ...this.children.map((c) => c.words())].join(' ').replace(/\s+/g, ' ').trim()
  }
}

const JOB = 'job-1'

interface Item {
  itemId: string
  sourceName: string
  state: string
  outcome: string | null
  summary: string | null
  cause: string | null
  attempts: number
}

const corpusItems = (): Item[] => {
  const items: Item[] = Array.from({ length: 25 }, (_, i) => ({
    itemId: `id-${i}`,
    sourceName: `L${String(i + 1).padStart(2, '0')}-case.pdf`,
    state: 'COMPLETED',
    outcome: 'CLEAR',
    summary: 'Everything matches',
    cause: null,
    attempts: 1,
  }))
  items.push({
    itemId: 'id-rejected',
    sourceName: 'L26-truncated.pdf',
    state: 'REJECTED',
    outcome: null,
    summary: null,
    cause: 'The submission is truncated.',
    attempts: 0,
  })
  return items
}

/**
 * Boot the page against a stubbed service.
 *
 * `running` and `resetAnswer` are the two things that decide every branch under
 * test, so they are the only knobs.
 */
function boot(
  opts: {
    running?: boolean
    items?: Item[]
    resetStops?: number | null
    samplesFail?: boolean
    startFails?: boolean
    noDecisions?: boolean
  } = {},
) {
  const items = opts.items ?? corpusItems()
  const running = opts.running ?? false
  const script = /<script>([\s\S]*?)<\/script>/.exec(PAGE_HTML)?.[1] ?? ''
  const byId: Record<string, El> = {}
  for (const m of PAGE_HTML.matchAll(/id="([a-zA-Z]+)"/g)) {
    const id = m[1]
    if (id !== undefined) byId[id] = new El('div')
  }

  const snapshot = {
    type: 'snapshot',
    snapshot: {
      jobId: JOB,
      progress: {
        total: items.length,
        queued: 0,
        running: 0,
        completed: items.filter((i) => i.state === 'COMPLETED').length,
        failed: items.filter((i) => i.state !== 'COMPLETED').length,
        done: !running,
      },
      items,
    },
  }

  const sockets: FakeSocket[] = []
  class FakeSocket {
    listeners: Record<string, Array<(e: unknown) => void>> = {}
    closed = false
    constructor(readonly url: string) {
      sockets.push(this)
      // The coordinator sends a full snapshot on connect — and, once a job has
      // settled, nothing afterwards. A page that never reconnects therefore
      // never hears anything again, which is the defect this file exists for.
      setTimeout(() => {
        if (!this.closed) this.deliver(snapshot)
      }, 1)
    }
    addEventListener(t: string, fn: (e: unknown) => void) {
      const bucket = this.listeners[t] ?? []
      bucket.push(fn)
      this.listeners[t] = bucket
    }
    close() {
      this.closed = true
      for (const f of this.listeners.close ?? []) f({})
    }
    deliver(obj: unknown) {
      for (const f of this.listeners.message ?? []) f({ data: JSON.stringify(obj) })
    }
  }

  const calls: string[] = []
  const recordedAudits: Array<Record<string, unknown>> = []
  const fetchStub = (url: string, init?: { method?: string; body?: unknown }) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`)
    if (url.includes('/decisions')) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            decided: {
              'id-0': {
                decision: 'APPROVED',
                decidedBy: 'Jenny Alvarez',
                decidedAt: '2026-08-04T20:00:00.000Z',
              },
            },
          }),
      })
    }
    if (url.includes('/samples')) {
      if (opts.samplesFail) return Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            samples: [
              {
                id: 'L01',
                title: 'Fully compliant',
                expected: 'CLEAR',
                shows: 'Everything agrees.',
                url: '/samples/L01',
              },
              {
                id: 'L04',
                title: 'Alcohol content genuinely differs',
                expected: 'DISCREPANCIES_FOUND',
                shows: 'The record says 45% and the label says 40%.',
                url: '/samples/L04',
              },
            ],
          }),
      })
    }
    if (url.includes('/users')) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({ users: [{ name: 'Dave Mitchell', role: 'Compliance agent' }] }),
      })
    }
    if (url.includes('/audit/records')) {
      if (opts.noDecisions) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              records: [],
              note: 'No determination has been recorded yet, so there is nothing to audit.',
            }),
        })
      }
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            note: 'Every determination a person has recorded.',
            records: [
              {
                submission_id: 'sub-1',
                verdict_id: 'v-1',
                decided_by: 'Jenny Alvarez',
                decided_at: '2026-08-05T09:00:00.000Z',
                decision: 'APPROVED',
                recommended_outcome: 'CLEAR',
                reference_code: 'ABCD-1234',
                source_name: 'L01-fully-compliant.pdf',
                content_purged_at: null,
                audits: 0,
                last_result: null,
                last_by: null,
              },
            ],
          }),
      })
    }
    if (url.includes('/audit/run/')) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            submissionId: 'sub-1',
            verdictId: 'v-1',
            chain: { status: 'ok', events: 42, brokenAt: null },
            replay: { status: 'identical', differences: [] },
            sideBySide: {
              outcome: { recorded: 'CLEAR', rederived: 'CLEAR' },
              differences: [],
            },
          }),
      })
    }
    if (url.includes('/audit/record/')) {
      recordedAudits.push(JSON.parse(String(init?.body ?? '{}')))
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({ result: 'UPHELD', auditedBy: 'Dave Mitchell', auditedAt: 'now' }),
      })
    }
    if (url.includes('/audit/verify')) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({ status: 'ok', events: 306, brokenAt: null, head: 'a1b2c3d4e5f60718' }),
      })
    }
    if (url.includes('/audit/replay')) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            checked: 25,
            identical: 25,
            differs: 0,
            'not-comparable': 0,
            'not-re-derivable': 0,
            'record-altered': 0,
            findings: [],
          }),
      })
    }
    if (url.includes('/measurement')) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            reads: [
              {
                region: 'label',
                latency: { count: 4, p50: 3000, p95: 9000, max: 9000 },
                tokensReported: 4,
              },
              {
                region: 'record',
                latency: { count: 4, p50: 800, p95: 900, max: 900 },
                tokensReported: 0,
              },
            ],
            verification: {
              interactive: { count: 2, p50: 2400, p95: 2600, max: 2600 },
              batch: { count: 2, p50: 9900, p95: 9900, max: 9900 },
              total: { count: 4, p50: 3800, p95: 9900, max: 9900 },
              extract: { count: 4, p50: 3700, p95: 9800, max: 9800 },
              compare: { count: 4, p50: 2, p95: 3, max: 3 },
              meetsTarget: true,
              targetMs: 5000,
            },
            cost: [
              {
                provider: 'gemini',
                modelId: 'gemini-3.5-flash',
                reads: 8,
                reported: 4,
                promptTokens: 4800,
                completionTokens: 240,
                totalTokens: 5040,
              },
            ],
            gateway: {
              configured: true,
              id: 'ttb-labels',
              url: 'https://dash.example/gw',
              note: 'held by Cloudflare',
            },
            window: {
              sampleLimit: 2000,
              note: 'Distributions are drawn from the most recent 2000 reads.',
            },
          }),
      })
    }
    if (url.includes('/agents')) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            note: 'Deliberately no counts of what anyone did (D47).',
            activity: [
              { kind: 'model', action: 'model.fingerprinted', n: 2 },
              { kind: 'system', action: 'verdict.recorded', n: 25 },
              { kind: 'human', action: 'decision.recorded', n: 3 },
            ],
            progression: [
              { stage: 'Reads', may: 'Perceive a label', before: 'Today' },
              { stage: 'Enacts a rule', may: 'Never', before: 'No safety story' },
            ],
            agents: [
              {
                kind: 'human',
                id: 'human:Sarah Peterson',
                display: 'Sarah Peterson',
                role: 'Policy author',
                entitlements: ['Propose a rule for approval — and never enact their own proposal'],
                mayDecide: true,
                source: 'Named in the user register.',
              },
              {
                kind: 'model',
                id: 'model:workers-ai:@cf/meta/llama-4-scout-17b-16e-instruct',
                display: 'workers-ai @cf/meta/llama-4-scout-17b-16e-instruct',
                role: 'Reader',
                entitlements: ['Read a label, and report what it could not read'],
                mayDecide: false,
                source: 'Approved to read labels (D29).',
              },
              {
                kind: 'system',
                id: 'system',
                display: 'system',
                role: 'The deployment executing',
                entitlements: ['Open and close a job'],
                mayDecide: false,
                source: 'Execution, not anyone deciding.',
              },
            ],
          }),
      })
    }
    if (url.includes('/policy/rules')) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            policySetVersion: 2,
            approvedBy: 'IT Systems Administrator',
            inForce: [
              {
                ruleId: 'DS-STANDARD-OF-FILL',
                status: 'active',
                requirement: 'Net contents must be an authorised standard of fill',
                regulation: '27 CFR 5.203',
                productTypes: ['Distilled spirits'],
                effectiveFrom: '2025-01-10',
                effectiveTo: null,
                recordedAt: '2026-08-04T10:00:00.000Z',
                retiredAt: null,
                approvedBy: 'IT Systems Administrator',
                approvalInherited: true,
                quote: null,
                proposedBy: null,
              },
            ],
            awaitingApproval: [
              {
                ruleId: 'WINE-ALCOHOL-CONTENT-FORMAT',
                status: 'draft',
                requirement: 'Alcohol content is stated as a percentage of alcohol by volume',
                regulation: '27 CFR 4.36',
                productTypes: ['Wine'],
                effectiveFrom: null,
                effectiveTo: null,
                recordedAt: '2026-08-04T10:00:00.000Z',
                retiredAt: null,
                approvedBy: null,
                approvalInherited: false,
                quote: 'Alcoholic content shall be stated in terms of percentage',
                proposedBy: 'Sarah Peterson — Policy author',
                draftedBy: 'claude-opus-5',
              },
            ],
            retired: [],
          }),
      })
    }
    if (url === '/batch' && init?.method === 'POST') {
      if (opts.startFails) {
        return Promise.resolve({
          ok: false,
          json: () => Promise.resolve({ detail: 'queue unavailable' }),
        })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ jobId: JOB }) })
    }
    const body = url.includes('/batch/current')
      ? { jobId: JOB, running, counts: { queued: 0, running: 0, settled: items.length } }
      : url.includes('/batch/reset')
        ? opts.resetStops === null
          ? { jobId: null, stopped: 0 }
          : { jobId: JOB, stopped: opts.resetStops ?? 0 }
        : {}
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) })
  }

  const sandbox: Record<string, unknown> = {
    document: {
      getElementById: (id: string) => {
        const existing = byId[id]
        if (existing !== undefined) return existing
        const made = new El('div')
        byId[id] = made
        return made
      },
      createElement: (t: string) => new El(t),
      createTextNode: (t: string) => {
        const e = new El('#text')
        e.textContent = t
        return e
      },
      addEventListener: () => {},
      removeEventListener: () => {},
      activeElement: null,
      body: new El('body'),
    },
    WebSocket: FakeSocket,
    fetch: fetchStub,
    setTimeout,
    clearTimeout,
    location: { protocol: 'https:', host: 'test', href: '/' },
    FormData: class {
      append() {}
    },
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    confirm: () => true,
    console,
  }
  sandbox.window = sandbox

  new Function('sandbox', `with (sandbox) { ${script} }`)(sandbox)

  const settle = async () => {
    for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 5))
  }
  return { byId, calls, settle, sockets, snapshot, recordedAudits }
}

describe('the worklist lists what the coordinator sent', () => {
  it('renders every corpus item, rejected ones included', async () => {
    const { byId, settle } = boot()
    await settle()
    // 26 rows plus the single "Matched" divider.
    expect(byId.worklist?.count('li')).toBe(27)
  })

  it('counts them without losing any to an unhandled outcome', async () => {
    const items = corpusItems()
    items[0] = { ...items[0], outcome: 'CLEAR_CONFIRM_POLICY' } as Item
    const { byId, settle } = boot({ items })
    await settle()
    const text = byId.counts?.words() ?? ''
    expect(text).toMatch(/need your judgement/i)
    // 24 clean + 1 judgement + 1 rejected — nothing silently dropped.
    expect(byId.worklist?.count('li')).toBe(27)
  })

  it('never leaves a settled row reading as still in progress', async () => {
    // The regression that shipped: a new outcome fell through `present()`'s
    // default and rendered "Checking…" on a submission that had finished.
    const items = corpusItems().map((i) => ({ ...i, outcome: 'CLEAR_CONFIRM_POLICY' }))
    const { byId, settle } = boot({ items })
    await settle()
    expect(byId.worklist?.words()).not.toMatch(/Checking…/)
  })
})

describe('removing the attached submission', () => {
  /*
   * There used to be a separate "Start again" button beside the primary
   * action. It was justified by a screen with five typed fields, where starting
   * over meant editing all of them — and it outlived that screen. With one
   * upload, Remove IS starting over, and checking a submission already clears
   * the previous result, so the button only ever reached a state the next
   * action reached anyway.
   *
   * What it did carry was one thing Remove did not: taking the verdict off the
   * screen. That belongs with Remove, because a result describing a document
   * that is no longer attached is a panel pointing at evidence that is not
   * there.
   */
  const withResultOnScreen = (byId: Record<string, El>) => {
    byId.picked?.classList.remove('hidden')
    byId.drop?.classList.add('hidden')
    const result = byId.singleResult
    if (result) result.textContent = 'a previous verdict'
  }

  it('takes the verdict with it', async () => {
    const { byId, settle } = boot()
    await settle()
    withResultOnScreen(byId)

    byId.removeBtn?.click()

    expect(byId.singleResult?.textContent).toBe('')
  })

  it('puts the picker back', async () => {
    const { byId, settle } = boot()
    await settle()
    withResultOnScreen(byId)
    expect(byId.picked?.classList.contains('hidden')).toBe(false)

    byId.removeBtn?.click()

    expect(byId.picked?.classList.contains('hidden')).toBe(true)
    expect(byId.drop?.classList.contains('hidden')).toBe(false)
    expect(byId.file?.value).toBe('')
  })

  it('leaves the check button usable', async () => {
    // Removing a document is not a failure state; nothing should be disabled.
    const { byId, settle } = boot()
    await settle()
    byId.removeBtn?.click()
    expect(byId.checkBtn?.disabled).toBe(false)
  })

  it('offers no separate button for starting over', async () => {
    // The screen has three controls: choose, remove, check. A fourth that
    // duplicated one of them was a control an agent had to reason about.
    const { byId, settle } = boot()
    await settle()
    expect(byId.clearBtn?.listeners.click ?? []).toHaveLength(0)
  })
})

describe('reset leaves the page usable (the reported wedge)', () => {
  /*
   * Reported from staging: the start button stuck disabled on "Checking…" with
   * an empty worklist and no way back but a reload.
   *
   * `/batch/reset` on an ALREADY-SETTLED job stops nothing and the coordinator
   * broadcasts nothing. The page had decided how to recover by reading
   * `startBtn.disabled` — a button, which is also disabled while a start is
   * merely in flight — and its "was running" branch did nothing but wait for
   * that broadcast.
   */
  it('re-enables the start button when the reset stopped nothing', async () => {
    const { byId, settle } = boot({ resetStops: 0 })
    await settle()

    // The state the agent was in: a start had been pressed, so the button is
    // disabled, but the job had already settled.
    const start = byId.startBtn as El
    start.disabled = true
    start.textContent = 'Checking…'

    byId.resetBtn?.click()
    await settle()

    expect(start.disabled).toBe(false)
    expect(start.textContent).not.toBe('Checking…')
  })

  it('asks the service what is true rather than inferring it from a button', async () => {
    const { calls, settle, byId } = boot({ resetStops: 0 })
    await settle()
    const before = calls.length
    byId.resetBtn?.click()
    await settle()
    // The reset, and then a reconciliation against the service.
    expect(calls.slice(before).join(' ')).toMatch(/POST \/batch\/reset.*GET \/batch\/current/)
  })

  it('still lists the job the service still has', async () => {
    // "the old one will have 26 listed, and allow reset to process again"
    const { byId, settle } = boot({ resetStops: 0 })
    await settle()
    byId.resetBtn?.click()
    await settle()
    expect(byId.worklist?.count('li')).toBe(27)
  })

  it('goes idle when there is genuinely nothing to reset', async () => {
    const { byId, settle } = boot({ resetStops: null })
    await settle()
    byId.resetBtn?.click()
    await settle()
    expect((byId.startBtn as El).disabled).toBe(false)
    expect(byId.worklist?.count('li')).toBe(0)
  })
})

describe('the policy view (ui-design §2.3)', () => {
  /*
   * Read only, and that is a decision rather than a stage. D45 keeps the
   * reviewed file as the source and the rows as derived; a button here that
   * wrote a rule or an approval would make the rows authored, and the next
   * reconciliation would supersede whatever it wrote.
   *
   * It exists because you cannot review what you cannot read, and six rules
   * are waiting on exactly that.
   */
  const openPolicy = async () => {
    const boot_ = boot()
    await boot_.settle()
    boot_.byId.modePolicy?.click()
    await boot_.settle()
    return boot_
  }

  it('shows what is in force and what is waiting on a person', async () => {
    const { byId } = await openPolicy()
    const words = byId.policyBody?.words() ?? ''
    expect(words).toMatch(/In force \(1\)/)
    expect(words).toMatch(/Awaiting approval \(1\)/)
    expect(words).toContain('DS-STANDARD-OF-FILL')
    expect(words).toContain('WINE-ALCOHOL-CONTENT-FORMAT')
  })

  it('says plainly when a rule has nobody answerable for it', async () => {
    // The draft is unapproved, and that is the whole reason it is on the
    // screen. Showing it identically to an enacted rule would hide the ask.
    const { byId } = await openPolicy()
    expect(byId.policyBody?.words()).toContain('NOT APPROVED')
  })

  it('shows both time windows, which are different questions', async () => {
    // Which filings a rule covers, and since when this deployment held it.
    const { byId } = await openPolicy()
    const words = byId.policyBody?.words() ?? ''
    expect(words).toMatch(/filings from 2025-01-10/)
    expect(words).toMatch(/recorded 2026-08-04/)
  })

  it('says when a rule records no source quote rather than leaving a gap', async () => {
    // The enacted rules carry none. An empty space reads as an oversight; the
    // sentence says it is a known state.
    const { byId } = await openPolicy()
    expect(byId.policyBody?.words()).toContain('No source quote recorded')
  })

  it('distinguishes a rule signed for itself from one the set covers', async () => {
    // Two different assurances. A reviewer deciding whether to trust a rule
    // should be told which one they have, not shown both as "approved".
    const { byId } = await openPolicy()
    const words = byId.policyBody?.words() ?? ''
    expect(words).toContain('covered by the set approval of IT Systems Administrator')
  })

  it('never claims a draft is approved by anyone', async () => {
    // The set has an approver, and inheriting it here would put a person's
    // name against a rule they have not seen — the exact claim this screen
    // exists to let them make or withhold.
    const { byId } = await openPolicy()
    const words = byId.policyBody?.words() ?? ''
    const draft = words.slice(words.indexOf('WINE-ALCOHOL-CONTENT-FORMAT'))
    expect(draft).toContain('NOT APPROVED')
  })

  it('names the person who proposed a rule, not the tool', async () => {
    // "proposed by claude-opus-5" named the tool and nobody else, and a tool
    // cannot be answerable for having judged its own output worth proposing.
    const { byId } = await openPolicy()
    const words = byId.policyBody?.words() ?? ''
    expect(words).toContain('proposed by Sarah Peterson — Policy author')
  })

  it('keeps the drafting model out of the reviewer’s way', async () => {
    // Still in the record — the contract requires it and /policy/rules returns
    // it — but a reviewer deciding whether to approve a rule is not helped by
    // which model typed it.
    const { byId } = await openPolicy()
    expect(byId.policyBody?.words()).not.toContain('claude-opus-5')
  })

  it('offers nothing that would write', async () => {
    // The property D45 depends on. If an approve button ever appears here, the
    // reconciler and the screen are fighting over who authors policy.
    const { byId } = await openPolicy()
    expect(byId.policyBody?.count('button')).toBe(0)
  })
})

describe('the worklist an agent works through', () => {
  const mixed = () => {
    const items = corpusItems()
    items[1] = { ...items[1], outcome: 'DISCREPANCIES_FOUND' } as Item
    items[2] = { ...items[2], outcome: 'CLEAR_CONFIRM_POLICY' } as Item
    return items
  }

  it('puts what is settled first and what needs work last', async () => {
    // Reversed deliberately. An agent clears the rows needing nothing, then
    // spends the remaining time on the ones that do; leading with problems put
    // the longest work at the top of a list somebody was trying to get through.
    const { byId, settle } = boot({ items: mixed() })
    await settle()
    const words = byId.worklist?.words() ?? ''
    expect(words.indexOf('Everything matches')).toBeLessThan(words.indexOf('Problems found'))
  })

  it('divides the two groups rather than blending them', async () => {
    const { byId, settle } = boot({ items: mixed() })
    await settle()
    const words = byId.worklist?.words() ?? ''
    expect(words).toContain('Needs your attention')
    // The divider sits before the work, not before the clean passes.
    expect(words.indexOf('Everything matches')).toBeLessThan(words.indexOf('Needs your attention'))
  })

  it('marks a row a person has already dealt with', async () => {
    // The point is not to show the decision — that is on the detail screen —
    // but to stop an agent reopening a row they have already judged.
    const { byId, settle } = boot()
    await settle()
    expect(byId.worklist?.words()).toContain('Approved by Jenny Alvarez')
  })

  it('leaves undecided rows unmarked', async () => {
    const { byId, settle } = boot()
    await settle()
    // Only one row was decided in the stub; the mark must not spread.
    const marks = (byId.worklist?.words() ?? '').match(/Approved by/g) ?? []
    expect(marks).toHaveLength(1)
  })
})

describe('the sample submissions on the review screen', () => {
  /*
   * They exist so somebody with no TTB filing to hand can still use the screen
   * — a reviewer looking at the deployment. Without them the single-review path
   * is a file picker that refuses every file the visitor owns.
   */
  it('offers each sample as a download', async () => {
    const { byId, settle } = boot()
    await settle()
    expect(byId.sampleList?.count('a')).toBe(2)
  })

  it('says what each one will show, not just its name', async () => {
    const { byId, settle } = boot()
    await settle()
    const text = byId.sampleList?.words() ?? ''
    expect(text).toContain('Fully compliant')
    expect(text).toContain('The record says 45% and the label says 40%.')
  })

  it('leaves the screen usable when samples cannot be loaded', async () => {
    // A convenience, and its absence is not the agent's problem. An error over
    // a form that works perfectly well would report a problem they do not have.
    const { byId, settle } = boot({ samplesFail: true })
    await settle()
    expect(byId.sampleList?.count('a')).toBe(0)
    expect(byId.checkBtn?.disabled).toBe(false)
    // No message written anywhere: the agent is never told about a failure
    // that costs them nothing.
    expect(byId.fileErr?.textContent).toBe('')
    expect(byId.sampleList?.words()).toBe('')
  })
})

describe('starting a second run (the stall that was not one)', () => {
  /*
   * Reported from staging. Pressing "Check the 26 test submissions again" put
   * the button into "Starting…" and left the previous run's 26 rows, counts and
   * full progress bar on screen — because nothing changes until the new job's
   * first snapshot arrives, and that takes a moment.
   *
   * So the screen said "Checked 26 of 26" and showed a finished list while a new
   * run was starting. Every visible signal said nothing was happening, and the
   * one that said otherwise was a word on a button. The old results are also
   * not merely stale: they belong to a job the agent is no longer looking at.
   */
  const startFresh = async () => {
    const { byId, settle, calls } = boot()
    await settle()
    // The previous run is on screen: 26 rows and a completed bar.
    expect(byId.worklist?.count('li')).toBe(27)
    byId.startBtn?.click()
    return { byId, settle, calls }
  }

  it('clears the previous run before the new one reports anything', async () => {
    const { byId } = await startFresh()
    // Synchronously, on the click — not after a round trip. The whole problem
    // was the gap between the two.
    expect(byId.worklist?.count('li')).toBe(0)
  })

  it('puts the progress back to nothing done', async () => {
    const { byId } = await startFresh()
    expect(byId.progressLabel?.textContent).toBe('Checked 0 of 0')
    expect(byId.bar?.style.width).toBe('0%')
  })

  it('empties the counts rather than carrying the old ones', async () => {
    const { byId } = await startFresh()
    // "26 matched" beside an empty list is a screen contradicting itself.
    expect(byId.counts?.words()).not.toMatch(/[1-9]/)
  })

  it('shows the progress area, so there is something visibly underway', async () => {
    const { byId } = await startFresh()
    expect(byId.batch?.classList.contains('hidden')).toBe(false)
  })

  it('brings the previous run back if the start fails', async () => {
    // Clearing on click is a promise that a new run is beginning. If it is not,
    // the page must not be left blank — the earlier job still exists, and the
    // agent has lost sight of it.
    const { byId, settle } = boot({ startFails: true })
    await settle()
    byId.startBtn?.click()
    await settle()
    expect(byId.worklist?.count('li')).toBe(27)
    expect(byId.startErr?.classList.contains('hidden')).toBe(false)
  })
})

describe('the agent register (§19)', () => {
  /*
   * D46 made "who or what acted" one concept with three kinds, and then the
   * register existed only for code: an audit line reading
   * `model:workers-ai:@cf/…` identified an agent exactly and gave a reader
   * nowhere to look up what it is or what it may do.
   */
  const openAgents = async () => {
    const { byId, settle, calls } = boot()
    await settle()
    byId.modeAgents?.click()
    await settle()
    return { byId, calls }
  }

  it('groups the three kinds, people first', async () => {
    const { byId } = await openAgents()
    const words = byId.agentsBody?.words() ?? ''
    expect(words).toContain('People')
    expect(words).toContain('Models')
    expect(words).toContain('The system itself')
    expect(words.indexOf('People')).toBeLessThan(words.indexOf('Models'))
  })

  it('says of each agent whether it may decide', async () => {
    const { byId } = await openAgents()
    const words = byId.agentsBody?.words() ?? ''
    expect(words).toContain('Decides')
    // Sarah Peterson is human and may; the reader is a model and may not.
    expect(words).toMatch(/Sarah Peterson[^|]*yes/)
    expect(words).toMatch(/gemini-3\.5-flash[^|]*no|workers-ai[^|]*no/)
  })

  it('shows the division of labour rather than only the register', async () => {
    // The page was a rendered table of who exists. What it is for is showing
    // three kinds of actor on one piece of work, with the boundary stated.
    const { byId } = await openAgents()
    const words = byId.agentsBody?.words() ?? ''
    expect(words).toContain('Who does what, on one submission')
    expect(words).toMatch(/two blind reads/)
    expect(words).toMatch(/this is the only kind that may/)
  })

  it('shows what each kind has actually done, by kind and never by person', async () => {
    // Volume per named individual is deliberately not reported, and a screen
    // listing people beside counts is where that line gets crossed by accident.
    const { byId } = await openAgents()
    const words = byId.agentsBody?.words() ?? ''
    expect(words).toContain('What each kind has done here')
    expect(words).toMatch(/By kind, never by person/)
  })

  it('shows how a model would earn more work', async () => {
    const { byId } = await openAgents()
    const words = byId.agentsBody?.words() ?? ''
    expect(words).toContain('How a model earns more work')
    expect(words).toMatch(/Enacts a rule Never/)
  })

  it('shows no count of what anyone did', async () => {
    // A roster is exactly where a productivity number arrives by accident, and
    // its absence is a decision rather than an omission.
    const { byId } = await openAgents()
    const words = byId.agentsBody?.words() ?? ''
    expect(words).toMatch(/no counts of what anyone did/i)
    expect(words).not.toMatch(/\b\d+ (checks|decisions|labels|submissions) /i)
  })

  it('does not fetch the register until the tab is opened', async () => {
    const { byId, settle, calls } = boot()
    await settle()
    expect(calls.filter((c) => c.includes('/agents'))).toEqual([])
    byId.modeAgents?.click()
    await settle()
    expect(calls.filter((c) => c.includes('/agents')).length).toBe(1)
  })
})

describe('the measurement screen (§16)', () => {
  /*
   * §16 opens by saying a criterion without a measurement is an intention
   * rather than a claim. S1 — p95 within five seconds — went unmeasured by the
   * product itself, knowable only by watching a page and counting.
   */
  const openMeasure = async () => {
    const { byId, settle, calls } = boot()
    await settle()
    byId.modeMeasure?.click()
    await settle()
    return { byId, calls }
  }

  it('judges the target on single review, and says why', async () => {
    // A worklist prepared in batch once produced a twenty-second p95 and the
    // page reported the stated criterion as failed. Nobody had waited for any
    // of it.
    const { byId } = await openMeasure()
    const words = byId.measureBody?.words() ?? ''
    expect(words).toMatch(/Target 5\.00 s p95, single review — met/)
    expect(words).toMatch(/Batch runs ahead of the agent/)
  })

  it('separates the path where somebody waits from the one where nobody does', async () => {
    const { byId } = await openMeasure()
    const words = byId.measureBody?.words() ?? ''
    expect(words).toContain('Single review')
    expect(words).toContain('Batch')
    expect(words).toContain('Response time')
  })

  it('shows every figure with the sample it was drawn from', async () => {
    // A p95 over four readings and one over four hundred are different claims,
    // and a number without its denominator is the kind that gets quoted.
    const { byId } = await openMeasure()
    const words = byId.measureBody?.words() ?? ''
    // Every row carries its n, so a p95 over two readings is visibly that.
    expect(words).toMatch(/p50 p95 slowest n/)
  })

  it('separates the label read from the record read', async () => {
    const { byId } = await openMeasure()
    const words = byId.measureBody?.words() ?? ''
    expect(words).toContain('Reads')
    expect(words).toContain('Label')
    expect(words).toContain('Record')
  })

  it('says how many reads actually reported a cost', async () => {
    // 8 reads, 4 counted. A total shown flat against "8 reads" would read as
    // the cost of all eight.
    const { byId } = await openMeasure()
    expect(byId.measureBody?.words()).toMatch(/4 of 4/)
  })

  it('links the gateway rather than copying its numbers in', async () => {
    const { byId } = await openMeasure()
    // One gateway link, plus the three event-stream examples beside it.
    expect(byId.measureBody?.count('a')).toBe(4)
  })

  it('points integration tooling at the event stream', async () => {
    // The question a stack asks on arrival is "how do I plug this in?", and
    // both answers — the stream and the vendor's own analytics — belong in the
    // same place rather than scattered.
    const { byId } = await openMeasure()
    const words = byId.measureBody?.words() ?? ''
    expect(words).toContain('Integration')
    expect(words).toMatch(/verify the stream rather than trust/i)
    expect(words).toMatch(/Runtime logs belong to the platform/i)
  })

  it('does not fetch until the tab is opened', async () => {
    const { byId, settle, calls } = boot()
    await settle()
    expect(calls.filter((c) => c.includes('/measurement'))).toEqual([])
    byId.modeMeasure?.click()
    await settle()
    expect(calls.filter((c) => c.includes('/measurement')).length).toBe(1)
  })
})

describe('auditing a record (NFR-13)', () => {
  /*
   * This screen reported chain integrity and replay counts across every
   * verdict, which is a health check rather than an audit. An audit is somebody
   * examining ONE determination and concluding something about it — and a
   * conclusion nobody recorded is a conversation.
   */
  const openAudit = async (opts: Parameters<typeof boot>[0] = {}) => {
    const b = boot(opts)
    await b.settle()
    b.byId.modeAudit?.click()
    await b.settle()
    return b
  }

  it('lists the records a person actually decided', async () => {
    // Scoped to determinations, because a verdict nobody acted on is an
    // opinion and an auditor is asking about consequences.
    const { byId } = await openAudit()
    const words = byId.auditBody?.words() ?? ''
    expect(words).toContain('Records ready for audit')
    expect(words).toContain('L01-fully-compliant.pdf')
    expect(words).toContain('Jenny Alvarez')
  })

  it('says why the list is empty rather than showing nothing', async () => {
    // "Nothing to audit" and "nobody has decided anything" look identical
    // otherwise, and only one of them means the system is idle.
    const { byId } = await openAudit({ noDecisions: true })
    expect(byId.auditBody?.words()).toMatch(/nothing to audit/i)
  })

  it('shows the two things being compared, side by side', async () => {
    const { byId, settle } = await openAudit()
    const run = byId.auditBody?.find('BUTTON')
    run?.click()
    await settle()
    const words = byId.auditBody?.words() ?? ''
    expect(words).toContain('Side by side')
    expect(words).toMatch(/Recorded outcome: CLEAR/)
    expect(words).toMatch(/Re-derived outcome: CLEAR/)
  })

  it('draws no conclusion of its own', async () => {
    // The evidence is presented and the result is left blank. A system that
    // pre-selected an answer would be auditing itself and asking a person to
    // countersign.
    const { byId, settle } = await openAudit()
    byId.auditBody?.find('BUTTON')?.click()
    await settle()
    const words = byId.auditBody?.words() ?? ''
    expect(words).toMatch(/evidence, not a finding/i)
    expect(words).toContain('Your conclusion')
  })

  it('refuses to record without a name and a conclusion', async () => {
    const { byId, settle, recordedAudits } = await openAudit()
    byId.auditBody?.find('BUTTON')?.click()
    await settle()
    // The last button is "Record this audit"; pressing it unfilled must not post.
    const buttons = byId.auditBody?.findAll('BUTTON') ?? []
    buttons[buttons.length - 1]?.click()
    await settle()
    expect(recordedAudits).toHaveLength(0)
  })

  it('sends the evidence alongside the conclusion', async () => {
    // An audit is a statement about a moment. Storing the conclusion without
    // what it was formed on would leave a later reader unable to weigh it.
    const { byId, settle, recordedAudits } = await openAudit()
    byId.auditBody?.find('BUTTON')?.click()
    await settle()

    const selects = byId.auditBody?.findAll('SELECT') ?? []
    if (selects[0]) selects[0].value = 'Dave Mitchell'
    if (selects[1]) selects[1].value = 'UPHELD'
    const buttons = byId.auditBody?.findAll('BUTTON') ?? []
    buttons[buttons.length - 1]?.click()
    await settle()

    expect(recordedAudits).toHaveLength(1)
    expect(recordedAudits[0]?.auditedBy).toBe('Dave Mitchell')
    expect(recordedAudits[0]?.result).toBe('UPHELD')
    expect(recordedAudits[0]?.evidence).toEqual({
      chainStatus: 'ok',
      replayStatus: 'identical',
      rereadStatus: 'not-run',
    })
  })

  it('does not fetch until the tab is opened', async () => {
    const { byId, settle, calls } = boot()
    await settle()
    expect(calls.filter((c) => c.includes('/audit/'))).toEqual([])
    byId.modeAudit?.click()
    await settle()
    expect(calls.filter((c) => c.includes('/audit/records')).length).toBe(1)
  })
})
