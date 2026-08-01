-- Initial schema.
--
-- Design reference: §8.7 (provenance), §8.8.5 (rule-set binding), D32.
--
-- Two principles govern what lives here:
--
--   1. CONTENT IS TRANSIENT, THE RECORD IS DURABLE.
--      Submission bytes live in R2 for the life of a job and are then purged.
--      This database keeps the digest, never the artwork. Extracted values are
--      kept because they are the evidence an agent acted on (FR-10) — the
--      artwork itself is not needed to defend a decision, only what was read
--      from it.
--
--   2. THE HISTORY IS APPEND-ONLY AND TAMPER-EVIDENT.
--      An audit trail that can be silently edited is worth nothing to an
--      auditor (§15.3). audit_event is hash-chained and protected by triggers,
--      so an alteration or deletion is detectable rather than merely
--      discouraged.

-- ---------------------------------------------------------------------------
-- Jobs and submissions
-- ---------------------------------------------------------------------------

CREATE TABLE job (
  id            TEXT PRIMARY KEY,
  created_at    TEXT NOT NULL,
  state         TEXT NOT NULL CHECK (state IN
                  ('CREATED','INGESTING','PROCESSING','COMPLETE','CANCELLED')),
  item_count    INTEGER NOT NULL DEFAULT 0,
  completed_at  TEXT
);

CREATE TABLE submission (
  id                TEXT PRIMARY KEY,
  job_id            TEXT REFERENCES job(id),
  source_name       TEXT NOT NULL,
  -- Identity of the content, not the content. Survives purging.
  content_digest    TEXT NOT NULL,
  byte_size         INTEGER NOT NULL,
  -- R2 key while staged; NULL once purged. Purging is a job step, not a
  -- sweeper (batch design §10, B-D10).
  content_key       TEXT,
  content_purged_at TEXT,
  state             TEXT NOT NULL CHECK (state IN
                      ('QUEUED','RUNNING','COMPLETED','FAILED','REJECTED')),
  failure_cause     TEXT,
  attempt_count     INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL
);

CREATE INDEX submission_by_job    ON submission (job_id, state);
CREATE INDEX submission_by_digest ON submission (content_digest);

-- ---------------------------------------------------------------------------
-- Perception: what was read, by what, from where
-- ---------------------------------------------------------------------------

CREATE TABLE extraction (
  id             TEXT PRIMARY KEY,
  submission_id  TEXT NOT NULL REFERENCES submission(id),
  -- Two blind reads per submission, never one over the whole page (B-D1).
  region         TEXT NOT NULL CHECK (region IN ('label','record')),
  -- The label is ALWAYS read from pixels: a PDF text layer can disagree with
  -- what the page displays, and compliance concerns what a consumer sees.
  method         TEXT NOT NULL CHECK (method IN ('vision','text-layer')),
  provider       TEXT,
  model_id       TEXT,          -- fully qualified; never a floating alias (D29)
  prompt_version TEXT,
  sampling       TEXT,          -- JSON
  raster_dpi     INTEGER,       -- an UNREADABLE may be an artefact of this
  -- Retained verbatim. This is simultaneously the provenance record and the
  -- test fixture (test-plan §5) — the same artefact serves both.
  raw_response   TEXT NOT NULL,
  latency_ms     INTEGER NOT NULL,
  created_at     TEXT NOT NULL
);

CREATE INDEX extraction_by_submission ON extraction (submission_id, region);
CREATE INDEX extraction_by_model      ON extraction (model_id, created_at);

-- ---------------------------------------------------------------------------
-- Judgment: deterministic, and re-derivable from the extraction above
-- ---------------------------------------------------------------------------

CREATE TABLE verdict (
  id                     TEXT PRIMARY KEY,
  submission_id          TEXT NOT NULL REFERENCES submission(id),
  outcome                TEXT NOT NULL CHECK (outcome IN
                           ('CLEAR','CLEAR_CONFIRM_FLAGGED',
                            'DISCREPANCIES_FOUND','INCOMPLETE')),
  -- The versioned identity set (§9.4.6). Without these the verdict is not
  -- re-derivable and NFR-13 fails.
  ruleset_version        TEXT NOT NULL,
  reference_data_version INTEGER NOT NULL,
  policy_version         TEXT NOT NULL,
  aggregation_version    TEXT NOT NULL,
  extraction_ids         TEXT NOT NULL,   -- JSON array
  created_at             TEXT NOT NULL,
  -- A correction (UC-3) supersedes rather than overwrites: the original
  -- verdict and what replaced it are both part of the history.
  supersedes             TEXT REFERENCES verdict(id),
  superseded_by          TEXT REFERENCES verdict(id)
);

CREATE INDEX verdict_by_submission ON verdict (submission_id, created_at);
CREATE INDEX verdict_by_outcome    ON verdict (outcome, created_at);

CREATE TABLE field_verdict (
  verdict_id  TEXT NOT NULL REFERENCES verdict(id),
  field       TEXT NOT NULL,
  state       TEXT NOT NULL CHECK (state IN
                ('MATCH','MISMATCH','MISSING_ON_LABEL','NOT_SUPPLIED',
                 'UNREADABLE','LOW_CONFIDENCE')),
  expected    TEXT,
  observed    TEXT,
  -- Every verdict names the rule that produced it (FR-10). Without this an
  -- agent cannot defend a finding.
  rule        TEXT NOT NULL,
  explanation TEXT,
  PRIMARY KEY (verdict_id, field)
);

CREATE TABLE warning_verdict (
  verdict_id  TEXT NOT NULL REFERENCES verdict(id),
  segment_id  TEXT NOT NULL,      -- header | clause_1 | clause_2
  ok          INTEGER NOT NULL CHECK (ok IN (0,1)),
  observed    TEXT,
  deviation   TEXT,
  PRIMARY KEY (verdict_id, segment_id)
);

-- ---------------------------------------------------------------------------
-- Transaction history — append-only, hash-chained
-- ---------------------------------------------------------------------------

CREATE TABLE audit_event (
  seq          INTEGER PRIMARY KEY AUTOINCREMENT,
  at           TEXT NOT NULL,
  -- 'system' for pipeline steps; an agent reference for human actions.
  actor        TEXT NOT NULL,
  action       TEXT NOT NULL,
  subject_type TEXT NOT NULL CHECK (subject_type IN
                 ('job','submission','extraction','verdict','config')),
  subject_id   TEXT NOT NULL,
  -- Identifiers, classifications and versions only. NEVER label artwork or
  -- application values (D20) — those belong in field_verdict, where they are
  -- evidence rather than a log line.
  detail       TEXT,
  -- Tamper evidence: digest = sha256(prev_digest || canonical(row)).
  -- Genesis prev_digest is 64 zeros. Recomputing the chain detects any
  -- alteration or deletion from that point forward.
  prev_digest  TEXT NOT NULL,
  digest       TEXT NOT NULL
);

CREATE INDEX audit_by_subject ON audit_event (subject_type, subject_id, seq);
CREATE INDEX audit_by_time    ON audit_event (at);

-- Append-only, enforced by the database rather than by convention. A trail
-- that relies on everyone remembering not to edit it is not tamper-evident.
CREATE TRIGGER audit_event_no_update
BEFORE UPDATE ON audit_event
BEGIN
  SELECT RAISE(ABORT, 'audit_event is append-only');
END;

CREATE TRIGGER audit_event_no_delete
BEFORE DELETE ON audit_event
BEGIN
  SELECT RAISE(ABORT, 'audit_event is append-only');
END;

-- ---------------------------------------------------------------------------
-- Schema provenance
-- ---------------------------------------------------------------------------

CREATE TABLE schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO schema_meta (key, value) VALUES
  ('schema_version', '1'),
  ('applied_at', datetime('now')),
  ('retention_policy', 'UNSET — content purged at job completion; record retained indefinitely pending Q-PRV-03');
