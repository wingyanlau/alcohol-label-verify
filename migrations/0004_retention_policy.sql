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
-- THIS IS THE RECORDED STATEMENT, NOT THE SETTING. The window the sweep
-- actually applies is RETENTION_WINDOW_DAYS, configured per deployment, and
-- this row is the durable promise an auditor would read. They are deliberately
-- separate: changing what the system does to applicant content should require
-- also changing what it says it does, as a considered act rather than a
-- side effect.
--
-- So they can drift, and /health treats drift as a startup problem — the
-- deployment would otherwise publish a retention promise it does not keep,
-- which is a false statement about someone's data. Change the window, and this
-- row must be updated in a migration to match before the deploy gate passes.
UPDATE schema_meta
   SET value = 'Content (submission PDF, label crop) purged 14 days after the job starts; '
            || 'record (verdict, extraction, audit chain) retained indefinitely pending Q-PRV-03'
 WHERE key = 'retention_policy';

UPDATE schema_meta SET value = '4' WHERE key = 'schema_version';
