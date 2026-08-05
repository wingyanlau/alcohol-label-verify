/**
 * The corpus must not be able to grade itself.
 *
 * `testdata/manifest.json` is authored ground truth: for every submission it
 * states the application data AND the expected outcome, per-field states
 * included. The pipeline reads that file at runtime — it is where the warning
 * legibility measurement lives — so the file sitting one fetch away from the
 * code that produces verdicts is a standing hazard.
 *
 * This used to be guarded by a function: the declared record was reduced to the
 * four compared fields on the way in, so an expected outcome could not travel
 * with it. That function is gone, because the batch no longer takes the record
 * as data at all — it reads the record page, exactly as the single-review path
 * does. The hazard did not go with it, and this is what replaces the guard.
 *
 * Asserted against the source rather than by behaviour. A behavioural test
 * would only show that an expected outcome did not reach a verdict on the
 * inputs it happened to be given.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The source with comments removed, and nothing else removed.
 *
 * The comments had to go: they explain at length why the declared record was
 * dropped, so a test matching the bare word would fail on its own explanation —
 * which is how a guard gets deleted for being annoying.
 *
 * String literals are deliberately left in. Stripping them was the first
 * attempt and it desynced on an apostrophe inside a message, silently deleting
 * half the file and leaving a test that passed because there was nothing left
 * to match. The assertions below are written against **property access**
 * instead, which cannot appear in prose or in a message.
 */
const code = readFileSync('src/batch/pipeline.ts', 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/\/\/[^\n]*/g, ' ')

describe('what the pipeline may read from the corpus manifest', () => {
  it('takes the legibility measurement, which cannot be obtained any other way', () => {
    // Measured from the shipped raster at build time. The extractor cannot be
    // asked: shown an illegible warning it returns the statutory text from
    // memory and reports success either way.
    expect(code).toMatch(/warningLegibility/)
  })

  it('never reads the authored expected outcome', () => {
    // `expected` carries the verdict, the per-field states and whether the
    // warning should pass. Any of them reaching the pipeline would make the
    // corpus mark its own work, and the run would prove nothing.
    expect(code).not.toMatch(/\.expected\b/)
    expect(code).not.toMatch(/expectedOutcome/)
  })

  it('never reads the declared application data', () => {
    // The batch reads the record page like every other path. Taking the
    // manifest's values instead made the corpus a different check from an
    // upload — one trusting a build artefact, one reading pixels — and the two
    // could disagree about the same file while both looked correct.
    expect(code).not.toMatch(/\.application\b/)
    expect(code).not.toMatch(/\.declared\b/)
  })

  it('destructures the manifest narrowly, so a new key cannot arrive unnoticed', () => {
    // The parse names the fields it wants. A `cases?: unknown[]` would let
    // anything through the moment somebody indexed into it.
    expect(code).toMatch(/cases\?:\s*\{[^}]*\}\[\]/)
    const shape = /cases\?:\s*\{([^}]*)\}\[\]/.exec(code)?.[1] ?? ''
    expect(shape).toContain('warningLegibility')
    expect(shape).not.toContain('application')
    expect(shape).not.toContain('expected')
  })
})
