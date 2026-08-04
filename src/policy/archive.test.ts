/**
 * Reconciliation against real SQL.
 *
 * The planning half is pure and tested in `reconcile.test.ts`. This runs the
 * other half against an actual database with the actual migrations applied,
 * because the properties that matter here are properties of the schema as much
 * as of the code: the append-only triggers, the atomicity of a supersede, and
 * idempotency across a second run.
 *
 * A D1 shim over `node:sqlite` stands in for the binding. It implements only
 * what this module calls. D1 runs the same engine, so the SQL, the triggers and
 * the constraints under test are the ones that will run in production — which
 * is the whole reason not to use a stub that merely records statements.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it } from 'vitest'
import type { PolicyRule } from '../domain/policy.js'
import { currentRules, reconcileArchive, ruleSetAsAt } from './archive.js'

const MIGRATIONS = [
  '0001_init',
  '0002_verdict_legibility',
  '0003_submission_reference_code',
  '0004_retention_policy',
  '0005_policy_layer',
  '0006_job_kind',
  '0007_policy_archive',
  '0008_verdict_bitemporal',
  '0009_agent',
]

/** Just enough of the D1 surface for `archive.ts`, over a real SQLite engine. */
function fakeD1(): D1Database & { raw: DatabaseSync } {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  for (const name of MIGRATIONS) {
    const sql = readFileSync(join(process.cwd(), 'migrations', `${name}.sql`), 'utf8')
    db.exec(sql)
  }

  const prepare = (sql: string) => {
    let bound: unknown[] = []
    const stmt = {
      bind: (...args: unknown[]) => {
        bound = args
        return stmt
      },
      all: async <T>() => ({ results: db.prepare(sql).all(...(bound as never[])) as T[] }),
      first: async <T>() => (db.prepare(sql).get(...(bound as never[])) ?? null) as T | null,
      run: async () => {
        db.prepare(sql).run(...(bound as never[]))
        return { meta: { changes: 1 } }
      },
      __exec: () => db.prepare(sql).run(...(bound as never[])),
    }
    return stmt
  }

  const api = {
    prepare,
    // D1 batches atomically. A supersede is two statements that must not be
    // separable, so the shim wraps them in a transaction rather than looping.
    batch: async (statements: Array<{ __exec: () => unknown }>) => {
      db.exec('BEGIN')
      try {
        for (const s of statements) s.__exec()
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
      return []
    },
    raw: db,
  }
  return api as unknown as D1Database & { raw: DatabaseSync }
}

const rule = (over: Partial<PolicyRule> = {}): PolicyRule =>
  ({
    id: 'DS-STANDARD-OF-FILL',
    ruleVersion: 1,
    regulation: '27-CFR-5.203',
    effectiveFrom: '2025-01-10',
    effectiveTo: null,
    supersedes: null,
    requirement: 'Net contents must be an authorised standard of fill',
    appliesWhen: { productType: ['Distilled spirits'] },
    check: { kind: 'value-in-set', field: 'netContents', unit: 'mL', permitted: [750] },
    severity: 'blocking',
    status: 'active',
    automation: 'advisory',
    ...over,
  }) as PolicyRule

let db: D1Database & { raw: DatabaseSync }
const opts = (over: Partial<{ now: string; reconciliationId: string }> = {}) => ({
  now: '2026-08-04T10:00:00.000Z',
  reconciliationId: 'rec-1',
  setApprovedBy: 'IT Systems Administrator',
  ...over,
})

beforeEach(() => {
  db = fakeD1()
})

const rows = () =>
  db.raw
    .prepare(
      'SELECT rule_id, body_digest, recorded_at, retired_at, status FROM policy_rule ORDER BY recorded_at, rule_id',
    )
    .all() as Array<Record<string, unknown>>

const events = () =>
  db.raw
    .prepare(
      "SELECT action, subject_id, actor FROM audit_event WHERE subject_type='config' ORDER BY seq",
    )
    .all() as Array<Record<string, unknown>>

describe('seeding an empty archive', () => {
  it('writes a row per rule and announces each one', async () => {
    const report = await reconcileArchive(db, [rule(), rule({ id: 'WINE-X' })], opts())
    expect(report.actions).toBe(2)
    expect(rows()).toHaveLength(2)
    expect(events().map((e) => e.action)).toEqual(['policy.rule.enacted', 'policy.rule.enacted'])
  })

  it('records a draft as proposed, and never as enacted', async () => {
    // §18.5a. A model may propose; only a person may enact.
    await reconcileArchive(db, [rule({ id: 'W', status: 'draft' })], opts())
    expect(events()[0]?.action).toBe('policy.rule.proposed')
  })

  it('attributes the change to whoever approved the rule', async () => {
    await reconcileArchive(
      db,
      [
        rule({
          approval: { by: 'IT Systems Administrator', at: '2026-08-03' },
        } as Partial<PolicyRule>),
      ],
      opts(),
    )
    expect(events()[0]?.actor).toBe('IT Systems Administrator')
  })
})

describe('running it again changes nothing', () => {
  /*
   * The property that lets this run on every deploy. Without it the archive
   * would gain a row and the chain an event every time anything shipped, and
   * the policy history would become noise that hid the real changes.
   */
  it('writes no second row and no second event', async () => {
    await reconcileArchive(db, [rule()], opts())
    const report = await reconcileArchive(
      db,
      [rule()],
      opts({ now: '2026-09-01T00:00:00.000Z', reconciliationId: 'rec-2' }),
    )

    expect(report.actions).toBe(0)
    expect(report.summary).toMatch(/already agrees/)
    expect(rows()).toHaveLength(1)
    expect(events()).toHaveLength(1)
  })
})

describe('a changed rule supersedes its predecessor', () => {
  const v2 = rule({
    check: { kind: 'value-in-set', field: 'netContents', unit: 'mL', permitted: [750, 500] },
  } as Partial<PolicyRule>)

  it('closes the old window and opens a new one', async () => {
    await reconcileArchive(db, [rule()], opts())
    await reconcileArchive(
      db,
      [v2],
      opts({ now: '2026-09-01T00:00:00.000Z', reconciliationId: 'rec-2' }),
    )

    const all = rows()
    expect(all).toHaveLength(2)
    expect(all[0]?.retired_at).toBe('2026-09-01T00:00:00.000Z')
    expect(all[1]?.retired_at).toBeNull()
    expect(events().map((e) => e.action)).toEqual(['policy.rule.enacted', 'policy.rule.superseded'])
  })

  it('keeps the predecessor readable — nothing is lost', async () => {
    // The reason rows exist at all. The file has moved on; a verdict that cited
    // the old rule still needs it to exist somewhere.
    await reconcileArchive(db, [rule()], opts())
    const before = rows()[0]?.body_digest
    await reconcileArchive(
      db,
      [v2],
      opts({ now: '2026-09-01T00:00:00.000Z', reconciliationId: 'rec-2' }),
    )
    expect(rows().map((r) => r.body_digest)).toContain(before)
  })
})

describe('a rule removed from the file is retired', () => {
  it('closes its window and leaves the row', async () => {
    // D27: supersede, never delete. A verdict citing it is exactly the one
    // somebody is disputing.
    await reconcileArchive(db, [rule()], opts())
    await reconcileArchive(
      db,
      [],
      opts({ now: '2026-09-01T00:00:00.000Z', reconciliationId: 'rec-2' }),
    )

    expect(rows()).toHaveLength(1)
    expect(rows()[0]?.retired_at).toBe('2026-09-01T00:00:00.000Z')
    expect(events()[1]?.action).toBe('policy.rule.retired')
  })
})

describe('the rule set as at two dates (D41, D42)', () => {
  beforeEach(async () => {
    await reconcileArchive(db, [rule()], opts())
  })

  it('applies a rule to a filing on or after its effective date', async () => {
    expect(await ruleSetAsAt(db, '2026-08-01', '2026-08-04T10:00:00.000Z')).toHaveLength(1)
  })

  it('does not apply it to a filing that predates it', async () => {
    // Standards of fill changed in January 2025. A 2024 filing judged by
    // today's list is judged by a rule that never governed it.
    expect(await ruleSetAsAt(db, '2024-06-01', '2026-08-04T10:00:00.000Z')).toHaveLength(0)
  })

  it('does not apply it as of a moment before this deployment held it', async () => {
    // Transaction time. Replaying a verdict from before the rule was recorded
    // must not judge it by a rule the system did not yet have.
    expect(await ruleSetAsAt(db, '2026-08-01', '2026-01-01T00:00:00.000Z')).toHaveLength(0)
  })

  it('still applies it as of a moment before it was retired', async () => {
    // The point of the whole exercise: a verdict remains reproducible after the
    // rule that produced it has gone.
    await reconcileArchive(
      db,
      [],
      opts({ now: '2026-09-01T00:00:00.000Z', reconciliationId: 'rec-2' }),
    )
    expect(await ruleSetAsAt(db, '2026-08-01', '2026-08-15T00:00:00.000Z')).toHaveLength(1)
    expect(await ruleSetAsAt(db, '2026-08-01', '2026-10-01T00:00:00.000Z')).toHaveLength(0)
  })

  it('never returns a draft', async () => {
    await reconcileArchive(
      db,
      [rule(), rule({ id: 'PROPOSED', status: 'draft' })],
      opts({ now: '2026-08-05T00:00:00.000Z', reconciliationId: 'rec-2' }),
    )
    const set = await ruleSetAsAt(db, '2026-08-06', '2026-08-06T00:00:00.000Z')
    expect(set.map((r) => r.id)).not.toContain('PROPOSED')
  })
})

describe('the archive refuses to be rewritten', () => {
  it('will not let a recorded rule body be edited', async () => {
    // Enforced by the database, not by this module. A row that could be edited
    // is a row that cannot answer for a verdict.
    await reconcileArchive(db, [rule()], opts())
    expect(() => db.raw.exec("UPDATE policy_rule SET body = '{}'")).toThrow(/immutable/)
  })

  it('will not let a rule be deleted', async () => {
    await reconcileArchive(db, [rule()], opts())
    expect(() => db.raw.exec('DELETE FROM policy_rule')).toThrow(/append-only/)
  })

  it('will not let a closed window be reopened', async () => {
    await reconcileArchive(db, [rule()], opts())
    await reconcileArchive(
      db,
      [],
      opts({ now: '2026-09-01T00:00:00.000Z', reconciliationId: 'rec-2' }),
    )
    expect(() => db.raw.exec('UPDATE policy_rule SET retired_at = NULL')).toThrow(/immutable/)
  })
})

describe('what the archive reports about itself', () => {
  it('lists only open windows as current', async () => {
    await reconcileArchive(db, [rule(), rule({ id: 'B' })], opts())
    await reconcileArchive(
      db,
      [rule()],
      opts({ now: '2026-09-01T00:00:00.000Z', reconciliationId: 'rec-2' }),
    )
    expect((await currentRules(db)).map((r) => r.ruleId)).toEqual(['DS-STANDARD-OF-FILL'])
  })
})
