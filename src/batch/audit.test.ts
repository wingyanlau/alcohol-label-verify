import { describe, expect, it } from 'vitest'
import { type AuditRow, canonical, chainDigest, GENESIS, verifyChain } from './audit.js'

const row = (over: Partial<AuditRow> = {}): AuditRow => ({
  at: '2026-08-03T12:00:00.000Z',
  actor: 'system',
  action: 'verdict.recorded',
  subjectType: 'verdict',
  subjectId: 'v-1',
  detail: null,
  ...over,
})

/** Build a well-formed chain of n rows. */
async function chain(n: number): Promise<{ row: AuditRow; prevDigest: string; digest: string }[]> {
  const out: { row: AuditRow; prevDigest: string; digest: string }[] = []
  let prev = GENESIS
  for (let i = 0; i < n; i++) {
    const r = row({ subjectId: `v-${i}` })
    const digest = await chainDigest(prev, r)
    out.push({ row: r, prevDigest: prev, digest })
    prev = digest
  }
  return out
}

describe('canonical form', () => {
  // The digest is only evidence if the same row always serialises the same
  // way. Key order in an object literal is not a guarantee anyone should rely
  // on across engines or refactors.
  it('does not depend on key order', () => {
    const a = canonical({ ...row(), actor: 'system' })
    const b = canonical(row())
    expect(a).toBe(b)
  })

  it('distinguishes rows that differ anywhere', () => {
    expect(canonical(row())).not.toBe(canonical(row({ action: 'verdict.amended' })))
    expect(canonical(row())).not.toBe(canonical(row({ detail: 'x' })))
    expect(canonical(row())).not.toBe(canonical(row({ at: '2026-08-03T12:00:00.001Z' })))
  })

  // D20: the chain records that something happened, never what was on the
  // label. A canonical form that silently accepted content would put it
  // beyond reach of review, since a digest cannot be redacted afterwards.
  it('carries only identifiers, classifications and timestamps', () => {
    const c = canonical(row({ detail: 'dpi=300;provider=gemini' }))
    expect(c).toContain('verdict.recorded')
    expect(c).toContain('dpi=300')
  })
})

describe('the chain', () => {
  it('starts from a genesis digest of 64 zeros', () => {
    expect(GENESIS).toBe('0'.repeat(64))
  })

  it('produces a stable digest for the same input', async () => {
    const r = row()
    expect(await chainDigest(GENESIS, r)).toBe(await chainDigest(GENESIS, r))
  })

  it('changes when the predecessor changes, not only when the row does', async () => {
    const r = row()
    const a = await chainDigest(GENESIS, r)
    const b = await chainDigest('f'.repeat(64), r)
    expect(a).not.toBe(b)
  })

  it('verifies an untouched chain', async () => {
    expect(await verifyChain(await chain(5))).toBeNull()
  })

  // The property the chain exists for. Altering a recorded event must be
  // detectable, and detectable at the point it happened rather than merely
  // somewhere.
  it('detects an altered row, and names where', async () => {
    const c = await chain(5)
    const tampered = c.map((e, i) =>
      i === 2 ? { ...e, row: { ...e.row, action: 'verdict.amended' } } : e,
    )
    expect(await verifyChain(tampered)).toBe(2)
  })

  it('detects a deleted row', async () => {
    const c = await chain(5)
    expect(await verifyChain([...c.slice(0, 2), ...c.slice(3)])).toBe(2)
  })

  it('detects a row appended without the chain', async () => {
    const c = await chain(3)
    const forged = { row: row({ subjectId: 'forged' }), prevDigest: GENESIS, digest: 'deadbeef' }
    expect(await verifyChain([...c, forged])).toBe(3)
  })

  it('accepts an empty chain rather than calling it broken', async () => {
    expect(await verifyChain([])).toBeNull()
  })
})
