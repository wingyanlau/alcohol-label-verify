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
