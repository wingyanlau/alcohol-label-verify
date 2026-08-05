/**
 * The event stream as an integration point.
 *
 * The failure modes are a consumer's, not ours, and they are all silent: a
 * poller that stops at a page boundary and believes it is up to date, a filter
 * that quietly matches more than it named, a cursor that repeats or skips.
 */

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PAGE,
  type EventRow,
  eventSql,
  MAX_PAGE,
  nextCursor,
  parseEventQuery,
  toEvent,
} from './events.js'

const url = (qs: string) => new URL(`https://x.test/events${qs}`)

describe('reading a query from the URL', () => {
  it('works with no parameters at all', () => {
    // A consumer's first call should not need documentation.
    const q = parseEventQuery(url(''))
    expect(q.afterSeq).toBe(0)
    expect(q.limit).toBe(DEFAULT_PAGE)
  })

  it('caps the page however large a caller asks for', () => {
    expect(parseEventQuery(url('?limit=999999')).limit).toBe(MAX_PAGE)
  })

  it('falls back rather than coercing nonsense', () => {
    // A limit of "abc" is a caller bug; silently serving 200 rows hides it as
    // effectively as serving zero would.
    expect(parseEventQuery(url('?limit=abc')).limit).toBe(DEFAULT_PAGE)
    expect(parseEventQuery(url('?afterSeq=-5')).afterSeq).toBe(0)
  })

  it('treats an empty filter as no filter', () => {
    expect(parseEventQuery(url('?action=')).action).toBeUndefined()
  })
})

describe('the SQL it builds', () => {
  it('always bounds by the cursor', () => {
    const { sql, binds } = eventSql(parseEventQuery(url('?afterSeq=42')))
    expect(sql).toContain('seq > ?')
    expect(binds[0]).toBe(42)
  })

  it('filters by equality, not by pattern', () => {
    // A consumer asking for `decision.recorded` must not also receive
    // `decision.recorded.retracted` if such a thing is ever added.
    const { sql } = eventSql(parseEventQuery(url('?action=decision.recorded')))
    expect(sql).toContain('action = ?')
    expect(sql).not.toMatch(/LIKE/i)
  })

  it('parameterises every filter', () => {
    // Nothing from the URL reaches the statement text.
    const { sql, binds } = eventSql(
      parseEventQuery(url("?action=a'; DROP TABLE audit_event;--&actorKind=human")),
    )
    expect(sql).not.toContain('DROP')
    expect(binds).toContain("a'; DROP TABLE audit_event;--")
  })

  it('orders ascending, so a cursor can walk forward', () => {
    expect(eventSql(parseEventQuery(url(''))).sql).toContain('ORDER BY seq ASC')
  })
})

describe('the cursor', () => {
  const rows = (n: number): EventRow[] =>
    Array.from({ length: n }, (_, i) => ({ seq: i + 1 }) as EventRow)

  it('is null at the end of the stream', () => {
    // Told, not inferred. A poller comparing counts to the page size is one
    // off-by-one from stopping early and believing it is current.
    expect(nextCursor(rows(3), 200)).toBeNull()
  })

  it('is the last sequence when a full page came back', () => {
    expect(nextCursor(rows(200), 200)).toBe(200)
  })

  it('is null for an empty page', () => {
    expect(nextCursor([], 200)).toBeNull()
  })
})

describe('the shape a consumer reads', () => {
  const row: EventRow = {
    seq: 7,
    at: '2026-08-05T10:00:00.000Z',
    action: 'decision.recorded',
    actor: 'human',
    actor_kind: 'human',
    actor_id: 'human:Dave Mitchell',
    subject_type: 'verdict',
    subject_id: 'v-1',
    detail: 'submission=s-1;decision=APPROVED',
    prev_digest: 'aaaa',
    digest: 'bbbb',
  }

  it('does not couple a consumer to the column names', () => {
    const e = toEvent(row)
    expect(e.agent).toEqual({ kind: 'human', id: 'human:Dave Mitchell' })
    expect(e.subject).toEqual({ type: 'verdict', id: 'v-1' })
  })

  it('carries the chain digests, so a consumer can verify rather than trust', () => {
    // The property that distinguishes this from a log file: a downstream
    // system can re-compute the chain instead of taking the exporter's word.
    expect(toEvent(row).chain).toEqual({ previous: 'aaaa', digest: 'bbbb' })
  })

  it('falls back to the older actor column for events predating agent kinds', () => {
    const legacy = { ...row, actor_kind: null, actor_id: null }
    expect(toEvent(legacy).agent.kind).toBe('human')
    expect(toEvent(legacy).agent.id).toBeNull()
  })
})
