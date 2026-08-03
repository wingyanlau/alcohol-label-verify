-- The quotable reference (D21) as a column, so looking one up is a seek.
--
-- The code is DERIVED from the submission id, not allocated — see
-- `src/batch/reference-code.ts`. This column therefore stores nothing new; it
-- is an index over a value that was always computable. That is why it can be
-- backfilled exactly for every submission ever processed, rather than leaving
-- the history unreachable by the identifier the history most needs.
--
-- Nullable, because a row is written before the code is computed and a
-- half-written row must not be rejected by the schema. The lookup treats a
-- NULL as "not yet indexed", not as "no such submission".
ALTER TABLE submission ADD COLUMN reference_code TEXT;

-- Not UNIQUE. Forty bits will not collide at prototype scale, but a collision
-- must surface as two rows sharing a code — which the lookup reports as
-- ambiguous — rather than as a failed INSERT that loses a submission. The
-- record is worth more than the label on it.
CREATE INDEX submission_by_reference ON submission (reference_code);
