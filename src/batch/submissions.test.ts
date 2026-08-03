import { describe, expect, it } from 'vitest'
import { corpus, SUBMISSION_FILES, submissionIdFor } from './submissions.js'

describe('demonstration corpus', () => {
  it('lists all 26 authored submissions', () => {
    expect(SUBMISSION_FILES).toHaveLength(26)
  })

  it('derives a stable Lnn id from each filename', () => {
    expect(submissionIdFor('L07-health-warning-altered-by-one-word.pdf')).toBe('L07')
    expect(submissionIdFor('L26-corrupt-truncated-file.pdf')).toBe('L26')
  })

  it('produces a unique id per submission', () => {
    const ids = corpus().map((s) => s.submissionId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('points each submission at an asset under the submissions prefix', () => {
    for (const s of corpus()) {
      expect(s.assetPath).toBe(`submissions/${s.sourceName}`)
    }
  })

  // These paths are a contract with generate.py, which writes the files. A
  // mismatch does not fail loudly: the worker simply finds no render and falls
  // back to launching a browser per submission, which is the cost the
  // pre-rendering exists to avoid.
  it('names a pre-rasterised label and record for each submission', () => {
    for (const s of corpus()) {
      expect(s.labelRasterPath).toBe(`rasters/${s.submissionId}-label.png`)
      expect(s.recordRasterPath).toBe(`rasters/${s.submissionId}-record.png`)
    }
  })
})
