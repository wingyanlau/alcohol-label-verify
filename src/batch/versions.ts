/**
 * Versioned identity of the deterministic layers.
 *
 * Design reference: §9.4.6 (the versioned identity set), NFR-13 (replayability).
 *
 * A verdict is only re-derivable if the exact rules that produced it are
 * identifiable. These strings are recorded on every `verdict` row (see
 * migrations/0001_init.sql) alongside the extraction ids, so a stored verdict
 * can be reproduced from its inputs. Bump the relevant string whenever the
 * corresponding layer's behaviour changes.
 */

/** Field comparison rules — `src/domain/compare.ts`. */
export const RULESET_VERSION = 'compare@1'

/** Region maps and intake policy — `src/normalise/regions.ts`. */
export const POLICY_VERSION = 'policy@1'

/**
 * Outcome aggregation — `src/domain/aggregate.ts`.
 *
 * `@2` since D40: the outcome vocabulary gained `CLEAR_CONFIRM_POLICY` and
 * aggregation gained policy findings as an input. A verdict reached under `@1`
 * would not necessarily be reached again today, and replay must report that as
 * not-comparable rather than silently re-deriving it under the new rules
 * (§17.3).
 */
export const AGGREGATION_VERSION = 'aggregate@2'
