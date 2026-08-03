-- State the retention policy (D32).
--
-- It was 'UNSET — content purged at job completion; record retained
-- indefinitely pending Q-PRV-03'. Two problems with that. The word UNSET
-- meant the deployment made no commitment about applicant content, which D32
-- made a real obligation. And the clause after it described a purge that was
-- never implemented and could not be, because the review screen reads the
-- content it claimed to delete.
--
-- What replaces it is what the code now does: content is kept for a bounded
-- review window and then deleted by a scheduled step that records the
-- deletion; the record is not content and is not purged.
--
-- Kept in step with REVIEW_WINDOW_DAYS in src/batch/retention.ts. A number in
-- two places is a number that will disagree — /health reports both so the
-- disagreement is visible rather than latent.
UPDATE schema_meta
   SET value = 'Content (submission PDF, label crop) purged 14 days after the job starts; '
            || 'record (verdict, extraction, audit chain) retained indefinitely pending Q-PRV-03'
 WHERE key = 'retention_policy';

UPDATE schema_meta SET value = '4' WHERE key = 'schema_version';
