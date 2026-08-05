/**
 * The archive's own identity.
 *
 * `policySetVersion` is a number a person maintains, and nothing checked it
 * against what the file actually contains. That matters more than it sounds:
 * a verdict binds the version it was judged under (D26), and replay refuses to
 * re-derive across a version change (§18.3). Both mechanisms trust the number.
 *
 * So an edited set that still calls itself version 1 is worse than an unversioned
 * one. Every verdict bound to "1" then replays as *comparable* against rules it
 * was never judged by, and agreement means nothing — which is precisely the
 * failure §17.3 exists to prevent, arriving through the one door nobody watched.
 *
 * It happened on the first change after the mechanism was built: four
 * regulations, fourteen documents and five rules were added and the version
 * stayed at 1.
 *
 * The regulations already carry a `textDigest` so a moved regulation is
 * visible. This gives the set the same tripwire.
 */

import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import raw from '../../config/policy-set.json' with { type: 'json' }
import { POLICY_SET } from './findings.js'

/**
 * Every version this archive has ever declared, and the content that went with
 * it.
 *
 * Adding a row is the deliberate act. Changing a rule changes the digest, which
 * fails against the row for the current version — and the only way to make it
 * pass is to bump the version and add a row, which is exactly the decision that
 * should not be reachable by accident.
 */
const RELEASED: Readonly<Record<number, string>> = {
  2: 'c934ed02345c2925',
  3: 'db001feca5f640ca',
  4: '17e71ef1e1d758f8',
}

/** The governing content, in a form whose digest cannot depend on key order. */
function contentDigest(set: Record<string, unknown>): string {
  const body = {
    regulations: set.regulations,
    sourceDocuments: set.sourceDocuments,
    rules: set.rules,
  }
  return createHash('sha256')
    .update(JSON.stringify(sortDeep(body)))
    .digest('hex')
    .slice(0, 16)
}

/** Key order is an implementation detail no digest should depend on. */
function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep)
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    )
    return Object.fromEntries(entries.map(([k, v]) => [k, sortDeep(v)]))
  }
  return value
}

const set = raw as unknown as Record<string, unknown>

describe('the policy set declares what it actually contains', () => {
  it('carries a digest of its own content', () => {
    expect(typeof set.contentDigest).toBe('string')
    expect(String(set.contentDigest)).toHaveLength(16)
  })

  it('matches the content it ships with', () => {
    // If this fails you changed a rule, a regulation or a source document.
    // That is fine — but the set is now a different document, so bump
    // `policySetVersion`, set `supersedes` to the version it replaces, update
    // `contentDigest`, and add the new version to RELEASED above.
    expect(contentDigest(set)).toBe(set.contentDigest)
  })

  it('has not changed its content without changing its version', () => {
    // The assertion the mechanism was missing. A silent edit under an unchanged
    // version makes every verdict bound to that version replay as comparable
    // against rules it was never judged by.
    const version = POLICY_SET.policySetVersion
    expect(RELEASED[version], `version ${version} is not a released version`).toBeDefined()
    expect(contentDigest(set), `content changed but policySetVersion is still ${version}`).toBe(
      RELEASED[version],
    )
  })

  it('says which version it replaces, once there is one to replace', () => {
    // A version chain, not a bare number: "2" alone does not say what came
    // before it, and an auditor reading an old verdict needs to know.
    const version = POLICY_SET.policySetVersion
    if (version > 1) expect(set.supersedes).toBe(version - 1)
  })

  it('names who approved it and when', () => {
    // A set that cannot be attributed is a set whose findings cannot be
    // defended (§18.5a).
    expect(POLICY_SET.approvedBy.trim().length).toBeGreaterThan(0)
    expect(POLICY_SET.approvedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
