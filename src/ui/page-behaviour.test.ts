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
function boot(opts: { running?: boolean; items?: Item[]; resetStops?: number | null } = {}) {
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
  const fetchStub = (url: string, init?: { method?: string }) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`)
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
                quote: 'Alcoholic content shall be stated in terms of percentage',
                proposedBy: 'claude-opus-5',
              },
            ],
            retired: [],
          }),
      })
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
  return { byId, calls, settle, sockets, snapshot }
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

describe('clearing the single-review form', () => {
  /*
   * An agent checks one label, then the next. Without this the only ways to
   * start again were to edit five fields by hand or reload the page, and the
   * field most likely to be missed is product type — the one that decides
   * which regulations the next label is judged against.
   */
  const filled = (byId: Record<string, El>) => {
    for (const id of ['brandName', 'classType', 'alcoholContent', 'netContents', 'productType']) {
      const field = byId[id]
      if (field) field.value = 'something'
    }
    const result = byId.singleResult
    if (result) result.textContent = 'a previous verdict'
  }

  it('empties every application field', async () => {
    const { byId, settle } = boot()
    await settle()
    filled(byId)
    byId.clearBtn?.click()
    for (const id of ['brandName', 'classType', 'alcoholContent', 'netContents']) {
      expect(byId[id]?.value, id).toBe('')
    }
  })

  it('clears the product type rather than carrying it into the next label', async () => {
    // The one field that would otherwise persist unnoticed, and the one that
    // selects the rule set (D25).
    const { byId, settle } = boot()
    await settle()
    filled(byId)
    byId.clearBtn?.click()
    expect(byId.productType?.value).toBe('')
  })

  it('removes the attached artwork', async () => {
    const { byId, settle } = boot()
    await settle()
    filled(byId)
    // Put the panel into the state an attached file leaves it in, so the
    // assertion is about the flip rather than about where it already was.
    byId.picked?.classList.remove('hidden')
    byId.drop?.classList.add('hidden')
    expect(byId.picked?.classList.contains('hidden')).toBe(false)

    byId.clearBtn?.click()

    // The thumbnail is gone and the picker is back.
    expect(byId.picked?.classList.contains('hidden')).toBe(true)
    expect(byId.drop?.classList.contains('hidden')).toBe(false)
    expect(byId.file?.value).toBe('')
  })

  it('takes the previous verdict off the screen', async () => {
    const { byId, settle } = boot()
    await settle()
    filled(byId)
    byId.clearBtn?.click()
    expect(byId.singleResult?.textContent).toBe('')
  })

  it('leaves the check button usable', async () => {
    // Clearing is not a failure state; nothing should be disabled by it.
    const { byId, settle } = boot()
    await settle()
    byId.clearBtn?.click()
    expect(byId.checkBtn?.disabled).toBe(false)
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

  it('offers nothing that would write', async () => {
    // The property D45 depends on. If an approve button ever appears here, the
    // reconciler and the screen are fighting over who authors policy.
    const { byId } = await openPolicy()
    expect(byId.policyBody?.count('button')).toBe(0)
  })
})
