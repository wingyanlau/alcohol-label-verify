-- An audit is an act, performed by a person, and it belongs in the record.
--
-- The system can show that a chain verifies, that a verdict re-derives, and
-- that a model reads a label the same way today. None of that is an audit. An
-- audit is somebody looking at that evidence and CONCLUDING something, and a
-- conclusion nobody recorded is a conversation rather than a finding.
--
-- So this stores the judgement and the evidence it was formed on, together.
-- The evidence is copied rather than referenced deliberately: an audit is a
-- statement about a moment, and re-running the checks a year later may
-- legitimately give different answers — a purged artwork makes a re-read
-- impossible, a superseded rule changes what "comparable" means. An audit that
-- silently re-evaluated its own basis would be unreadable as history.

CREATE TABLE audit_review (
  id            TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submission(id),
  verdict_id    TEXT NOT NULL REFERENCES verdict(id),

  -- Declared, not authenticated, exactly like a decision. The register says who
  -- is recognised; nothing here verifies that the person typing is that person.
  audited_by    TEXT NOT NULL,
  audited_at    TEXT NOT NULL,

  -- The human conclusion. Three, because "it did not hold up" and "something
  -- here needs explaining" lead to different places, and collapsing them would
  -- make every reservation look like a failure.
  result        TEXT NOT NULL CHECK (result IN ('UPHELD', 'CONCERNS', 'FAILED')),

  -- What the evidence said AT THE TIME. Nullable: a check that could not run is
  -- recorded as not run rather than as passing.
  chain_status  TEXT,
  replay_status TEXT,
  reread_status TEXT,

  note          TEXT,

  -- One audit per person per verdict. A second look is a second row only if
  -- somebody else takes it; the same auditor revisiting replaces nothing,
  -- because an audit they have already signed is part of the history.
  UNIQUE (verdict_id, audited_by)
);

CREATE INDEX audit_review_by_submission ON audit_review (submission_id, audited_at);
CREATE INDEX audit_review_by_result     ON audit_review (result, audited_at);

UPDATE schema_meta SET value = '12' WHERE key = 'schema_version';
