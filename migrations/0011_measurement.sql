-- What a verdict cost, and how long it took (D52).
--
-- Two things this deployment produced and then discarded. Latency has been
-- recorded per read since 0001; the counts that say what an inference
-- allowance was spent on were in every vendor response and were thrown away,
-- which is the gap AI Gateway was added to close from the outside.
--
-- Every column is nullable, and that is load-bearing rather than lenient. A
-- vendor may not report usage, a model may omit it, a cached response has
-- none, and every row written before this migration has none. NULL means "not
-- reported"; a zero would mean "this read was free", and a column of invented
-- zeroes sums to a number that looks like a measurement.

ALTER TABLE extraction ADD COLUMN prompt_tokens     INTEGER;
ALTER TABLE extraction ADD COLUMN completion_tokens INTEGER;
ALTER TABLE extraction ADD COLUMN total_tokens      INTEGER;

-- The verification's own stage timings, so §16's S1 (p95 <= 5s) can be
-- answered from the record rather than from a log nobody kept.
--
-- These measure the DOMAIN's work: the reads, and the comparison. They do not
-- include rasterisation or time spent waiting in the queue, so they are a
-- floor on what an agent experiences and not the whole of it. The surface that
-- reports them says so; a number labelled "total" that silently excludes the
-- slowest stage would be worse than no number.
ALTER TABLE verdict ADD COLUMN extract_ms INTEGER;
ALTER TABLE verdict ADD COLUMN compare_ms INTEGER;
ALTER TABLE verdict ADD COLUMN total_ms   INTEGER;

UPDATE schema_meta SET value = '11' WHERE key = 'schema_version';
