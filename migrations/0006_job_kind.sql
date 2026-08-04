-- A single review is not a batch, and the record could not tell them apart.
--
-- Both paths insert a `job` row: the batch endpoint one job over the 26
-- bundled submissions, and `/review` a job of one, because every review must
-- produce an audit record and the record hangs off a job.
--
-- `loadCurrentJob` then took the most recent job of either kind. So performing
-- a single review displaced the corpus on the batch screen: the worklist
-- adopted a one-item job and showed a single uploaded label where 26 test
-- cases had been. Reported twice as "the test cases are no longer listed",
-- and it is not a rendering fault at all — the page was faithfully showing the
-- job it was given.
--
-- The two kinds want different things from the same table. A batch is a
-- worklist an agent watches; a single review is one submission that happens to
-- need a parent row. Naming the difference is what lets a query ask for the
-- one it means.
ALTER TABLE job ADD COLUMN kind TEXT NOT NULL DEFAULT 'batch'
  CHECK (kind IN ('batch', 'single'));

-- Existing rows, classified by the only evidence available.
--
-- `startBatch` runs the whole bundled corpus, which is 26 submissions, and has
-- never enqueued a batch of one; `/review` always inserts exactly one. So a
-- one-item job in the history is a single review, and this is exact rather
-- than a heuristic FOR THIS DEPLOYMENT. It would not be if the batch endpoint
-- ever accepted an arbitrary upload set — which is why the new column is
-- written explicitly at both call sites rather than inferred again later.
UPDATE job SET kind = 'single' WHERE item_count = 1;

-- Reading the batch screen means asking for the newest batch, which is now an
-- indexed question rather than a scan with a filter.
CREATE INDEX job_by_kind ON job (kind, created_at);

UPDATE schema_meta SET value = '6' WHERE key = 'schema_version';
