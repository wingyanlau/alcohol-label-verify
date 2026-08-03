/**
 * How degraded a health warning may be before reading it stops meaning
 * anything (FR-6, D5).
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS CONFIGURATION AND NOT A CONSTANT
 *
 * The number decides verdicts. Above the floor a transcription is trusted;
 * below it the submission is INCOMPLETE regardless of what the model returned
 * — which is the whole point, because a model shown an illegible warning
 * returns the statute from memory and reports success (§8.3.2). It is the
 * check that stops a non-compliant label passing.
 *
 * The shipped value of 30 is calibrated, not guessed: across the corpus every
 * blurred case scores about 24 and every legible one 33 or above, including
 * the angle-and-glare scan at 68 which is degraded but readable and correctly
 * passes. Thirty sits in the gap.
 *
 * But that calibration is against synthetic vector text rendered at a known
 * DPI. A deployment reading real scans — different scanners, different paper,
 * different compression — will land somewhere else, and finding out is
 * measurement, not opinion. Compiling the number in would mean an agency
 * needs a release to act on its own evidence.
 *
 * WHICH DIRECTION IS DANGEROUS. Raising the floor fails more submissions as
 * unreadable, which costs a reviewer time and nothing else. Lowering it
 * accepts transcriptions of artwork nobody could actually read, and every one
 * of those is a non-compliant label passing review. The asymmetry is why there
 * is no default: an invented threshold is a policy nobody stated, and the
 * error it enables is the silent one.
 *
 * This module holds no I/O and no platform types — it reads a record of
 * strings, which is what configuration is by the time it reaches here.
 */

/**
 * The configured floor, or null if it is missing or unusable.
 *
 * Null rather than a fallback: `validateConfig` turns it into a startup
 * problem, and the pipeline declines to apply a measurement rather than judge
 * one against a number nobody chose.
 *
 * Fractional values are allowed. Edge energy is a continuous measurement, so
 * 29.5 is a meaningful boundary in a way that half a day of retention is not.
 */
export function configuredLegibilityFloor(env: { LEGIBILITY_FLOOR?: string }): number | null {
  const raw = (env.LEGIBILITY_FLOOR ?? '').trim()
  if (raw === '') return null
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}
