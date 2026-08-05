/**
 * The sample submissions offered on the single-review screen.
 *
 * They exist so somebody with no TTB filing to hand can still use the thing —
 * a reviewer looking at the deployment, or anyone who wants to see what a
 * discrepancy looks like before trusting the screen that reports one.
 *
 * The properties worth pinning are about honesty rather than presentation.
 * These files are the corpus, and the corpus is ground truth: a sample offered
 * under a description that does not match what the record says it is would be a
 * demonstration of the wrong thing, which is worse than no demonstration.
 */

import { describe, expect, it } from 'vitest'
import manifest from '../../testdata/manifest.json' with { type: 'json' }
import { SAMPLE_IDS, sampleCatalogue, sampleFileFor } from './samples.js'

const catalogue = sampleCatalogue(manifest)

describe('the sample submissions', () => {
  it('offers a handful rather than the whole corpus', () => {
    // Twenty-six is a test suite; six is an invitation. A list nobody reads to
    // the end demonstrates nothing.
    expect(catalogue.length).toBeGreaterThan(2)
    expect(catalogue.length).toBeLessThan(10)
  })

  it('shows what each one proves, not what it tests', () => {
    // The manifest's own note is test-case shorthand — "UT-W05, IT-03". A
    // person choosing a file needs to know what they will see happen.
    for (const sample of catalogue) {
      expect(sample.shows.length, sample.id).toBeGreaterThan(20)
      expect(sample.shows, sample.id).not.toMatch(/UT-|IT-|E2E-|FR-/)
    }
  })

  it('covers a pass, a discrepancy and an unreadable field', () => {
    // A demonstration made only of passes shows nothing about judgement, and
    // one made only of failures reads as a broken system.
    const outcomes = new Set(catalogue.map((s) => s.expected))
    expect(outcomes).toContain('CLEAR')
    expect(outcomes).toContain('DISCREPANCIES_FOUND')
    expect(outcomes).toContain('INCOMPLETE')
  })

  it('states the outcome the corpus records, never one written here', () => {
    // The expected outcome is authored ground truth (testdata/README). Retyping
    // it beside the sample would create a second copy that can drift, and the
    // screen would be the one that looked authoritative.
    for (const sample of catalogue) {
      const entry = manifest.cases.find((c) => c.id === sample.id)
      expect(sample.expected, sample.id).toBe(entry?.expected.outcome)
      expect(sample.title, sample.id).toBe(entry?.title)
    }
  })

  it('drops a sample the corpus does not contain rather than inventing it', () => {
    // A curated id that no longer exists must disappear, not become an entry
    // with a made-up title and a download that 404s.
    const thinned = sampleCatalogue({ cases: manifest.cases.filter((c) => c.id !== 'L01') })
    expect(thinned.map((s) => s.id)).not.toContain('L01')
    expect(thinned.length).toBe(catalogue.length - 1)
  })
})

describe('serving a sample file', () => {
  it('resolves a curated id to the corpus file', () => {
    expect(sampleFileFor('L01', manifest)).toBe('L01-fully-compliant.pdf')
  })

  it('refuses an id that is not on the curated list', () => {
    // The whitelist is the whole defence: this value reaches an asset path, and
    // an id taken on trust is a path taken on trust.
    expect(sampleFileFor('L02', manifest)).toBeNull()
  })

  it('refuses a traversal attempt outright', () => {
    for (const attempt of ['../manifest.json', 'L01/../../etc/passwd', '', 'L01.pdf']) {
      expect(sampleFileFor(attempt, manifest), attempt).toBeNull()
    }
  })

  it('never returns a name that could escape the corpus directory', () => {
    for (const id of SAMPLE_IDS) {
      const file = sampleFileFor(id, manifest)
      expect(file, id).toMatch(/^[A-Za-z0-9][A-Za-z0-9-]*\.pdf$/)
    }
  })
})

describe('the real filing is a fixture, not a sample (D50)', () => {
  /*
   * F01 — the TTB form filed on its own — was offered here for one revision.
   * It is a fair test of the region map that reads such a filing, and a poor
   * demonstration of the system: the paper form has no box for class/type,
   * alcohol content or net contents, so three of the four comparisons come back
   * unassessed. To somebody forming a first impression that reads as a tool
   * that could not read the document.
   *
   * It stays in the corpus with authored ground truth, and off the screen.
   */
  it('is not offered as a demo', () => {
    expect(catalogue.map((s) => s.id)).not.toContain('F01')
    expect(sampleFileFor('F01', manifest)).toBeNull()
  })

  it('is still in the corpus, with what it can and cannot be checked against', () => {
    const entry = manifest.cases.find((c) => c.id === 'F01') as
      | { expected: { fields: Record<string, string> } }
      | undefined
    expect(entry, 'F01 must remain as a fixture').toBeDefined()
    // The guard that matters: if a future change starts defaulting the three
    // fields the form has no box for, this is what fails. A default would be
    // compared against the label, and agreement with an invented expectation is
    // a false MATCH.
    expect(entry?.expected.fields.classType).toBe('NOT_SUPPLIED')
    expect(entry?.expected.fields.alcoholContent).toBe('NOT_SUPPLIED')
    expect(entry?.expected.fields.netContents).toBe('NOT_SUPPLIED')
    expect(entry?.expected.fields.brandName).toBe('MATCH')
  })

  it('every offered sample is a complete submission', () => {
    // Two pages: the form, and the record carrying what the form has no box
    // for. That is the input this system is for.
    for (const sample of catalogue) {
      expect(sample.id, sample.id).toMatch(/^L\d\d$/)
    }
  })
})
