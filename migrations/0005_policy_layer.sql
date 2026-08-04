-- The verification layer: what the policy set said, and what the agent then
-- decided (design §18.3, §18.4, §18.5).
--
-- Three things the record could not previously express.
--
--   1. WHICH RULES WERE APPLIED, AND WHAT THEY WERE SELECTED ON.
--      A verdict citing only a policy-set version proves the rules were
--      applied correctly. It does not prove the CORRECT rules were selected —
--      and selection error is silent and systematic: the same label judged
--      against a different rule set on a different day, with nothing in the
--      output revealing it (D26).
--
--   2. THE FINDINGS THEMSELVES.
--      Stored per rule, as field_verdict is stored per field, and for the same
--      reason: FR-10 requires an agent to be able to defend a finding, which
--      means the evidence has to outlive the request that produced it.
--
--   3. WHAT THE HUMAN DECIDED.
--      The chain recorded what the system found and nothing about what was
--      done with it. Without that there is no ground truth, and any future
--      automation would be trained on its own recommendations (§18.5).

-- ---------------------------------------------------------------------------
-- The outcome vocabulary gained a state (D40)
-- ---------------------------------------------------------------------------
--
-- CLEAR_CONFIRM_POLICY is not in the CHECK constraint written in 0001, so the
-- database would reject a verdict the domain can now produce — and it would
-- reject it at write time, after the model call, on a submission that had
-- already been checked.
--
-- SQLite cannot alter a CHECK constraint, so the table is rebuilt — and the
-- ORDER of the rebuild is load-bearing.
--
-- The obvious sequence (create new, copy, DROP the old, rename) does not work
-- here even with foreign keys deferred. Dropping a parent orphans every
-- field_verdict and warning_verdict row referencing it, and SQLite counts
-- those violations as the rows are orphaned; re-creating a table of the same
-- name afterwards never decrements that count, so the migration fails at
-- COMMIT rather than at the statement that caused it. It was written that way
-- first, and that is exactly how it failed.
--
-- So the parent is renamed aside and the replacement takes its name, and the
-- children are then rebuilt to point back at it. Renaming a table rewrites the
-- REFERENCES clauses of everything pointing at it — `legacy_alter_table` would
-- suppress that, but it is ignored inside a transaction, and a D1 migration is
-- always inside one. That was tried too.
--
-- Rebuilding the children is cheap and safe in a way rebuilding the parent is
-- not: nothing references field_verdict or warning_verdict, so dropping them
-- orphans nothing. Only the parent had to be handled carefully.
PRAGMA defer_foreign_keys = ON;

ALTER TABLE verdict RENAME TO verdict_pre_policy;

CREATE TABLE verdict (
  id                     TEXT PRIMARY KEY,
  submission_id          TEXT NOT NULL REFERENCES submission(id),
  outcome                TEXT NOT NULL CHECK (outcome IN
                           ('CLEAR','CLEAR_CONFIRM_FLAGGED','CLEAR_CONFIRM_POLICY',
                            'DISCREPANCIES_FOUND','INCOMPLETE')),
  ruleset_version        TEXT NOT NULL,
  reference_data_version INTEGER NOT NULL,
  -- Region maps and intake policy. NOT the rule set — see policy_set_version
  -- below, which is a different thing with a confusingly similar name (§18.3).
  policy_version         TEXT NOT NULL,
  aggregation_version    TEXT NOT NULL,
  extraction_ids         TEXT NOT NULL,
  created_at             TEXT NOT NULL,
  supersedes             TEXT REFERENCES verdict(id),
  superseded_by          TEXT REFERENCES verdict(id),
  warning_legible        INTEGER NOT NULL DEFAULT 1,

  -- ---- The rule-set binding (D26) ----------------------------------------
  --
  -- Nullable, and that is historically accurate rather than lax: every verdict
  -- written before this migration was reached without any policy set at all,
  -- and recording a version for them would be a claim that rules were applied
  -- when none were.
  policy_set_version     INTEGER,
  -- JSON array of rule ids, in the order applied. Binding the ids and not just
  -- the version means a later reader can tell which of the set's rules this
  -- submission was actually judged against.
  selected_rule_ids      TEXT,
  -- JSON object of the record values selection ran on.
  selection_inputs       TEXT,
  -- The SUBMISSION's date, which decides which rules were in force — not the
  -- date the check ran. An application filed before a regulation changed must
  -- be judged by the regulation that governed it.
  submitted_on           TEXT
);

INSERT INTO verdict (
  id, submission_id, outcome, ruleset_version, reference_data_version,
  policy_version, aggregation_version, extraction_ids, created_at,
  supersedes, superseded_by, warning_legible
)
SELECT
  id, submission_id, outcome, ruleset_version, reference_data_version,
  policy_version, aggregation_version, extraction_ids, created_at,
  supersedes, superseded_by, warning_legible
FROM verdict_pre_policy;

-- The children, rebuilt only so their REFERENCES clauses name the new parent
-- again. Definitions are otherwise identical to 0001.
CREATE TABLE field_verdict_new (
  verdict_id  TEXT NOT NULL REFERENCES verdict(id),
  field       TEXT NOT NULL,
  state       TEXT NOT NULL CHECK (state IN
                ('MATCH','MISMATCH','MISSING_ON_LABEL','NOT_SUPPLIED',
                 'UNREADABLE','LOW_CONFIDENCE')),
  expected    TEXT,
  observed    TEXT,
  rule        TEXT NOT NULL,
  explanation TEXT,
  PRIMARY KEY (verdict_id, field)
);

INSERT INTO field_verdict_new SELECT * FROM field_verdict;
DROP TABLE field_verdict;
ALTER TABLE field_verdict_new RENAME TO field_verdict;

CREATE TABLE warning_verdict_new (
  verdict_id  TEXT NOT NULL REFERENCES verdict(id),
  segment_id  TEXT NOT NULL,
  ok          INTEGER NOT NULL CHECK (ok IN (0,1)),
  observed    TEXT,
  deviation   TEXT,
  PRIMARY KEY (verdict_id, segment_id)
);

INSERT INTO warning_verdict_new SELECT * FROM warning_verdict;
DROP TABLE warning_verdict;
ALTER TABLE warning_verdict_new RENAME TO warning_verdict;

-- Now unreferenced, so this orphans nothing.
DROP TABLE verdict_pre_policy;

CREATE INDEX verdict_by_submission ON verdict (submission_id, created_at);
CREATE INDEX verdict_by_outcome    ON verdict (outcome, created_at);

-- ---------------------------------------------------------------------------
-- The findings
-- ---------------------------------------------------------------------------

CREATE TABLE policy_finding (
  verdict_id  TEXT NOT NULL REFERENCES verdict(id),
  rule_id     TEXT NOT NULL,
  -- Denormalised deliberately. The rule's wording as it stood WHEN APPLIED —
  -- looking it up later would read today's policy set, and a superseded rule
  -- would be reported with wording it never had when this verdict was reached.
  requirement TEXT NOT NULL,
  state       TEXT NOT NULL CHECK (state IN
                ('SATISFIED','VIOLATED','NOT_APPLICABLE','UNDETERMINED')),
  severity    TEXT NOT NULL CHECK (severity IN ('blocking','advisory')),
  -- What was observed and why it decided that way. Never a bare verdict.
  evidence    TEXT NOT NULL,
  PRIMARY KEY (verdict_id, rule_id)
);

CREATE INDEX policy_finding_by_rule ON policy_finding (rule_id, state);

-- ---------------------------------------------------------------------------
-- What the agent decided (§18.5)
-- ---------------------------------------------------------------------------
--
-- The only source of real ground truth this system can have. Everything else
-- in the record is the system's own account of its own work; this is the one
-- table that says whether a person agreed.
--
-- `recommended_outcome` is stored beside `decision` rather than joined to the
-- verdict at read time, for the same reason the requirement text is: it is the
-- recommendation THIS DECISION WAS MADE AGAINST. A superseding verdict would
-- otherwise silently rewrite what the agent appeared to be responding to.
CREATE TABLE decision (
  id                  TEXT PRIMARY KEY,
  submission_id       TEXT NOT NULL REFERENCES submission(id),
  verdict_id          TEXT NOT NULL REFERENCES verdict(id),
  -- A named person. The prototype has no accounts, so this is whatever the
  -- deployment supplies; it is NOT NULL because an unattributable approval is
  -- not an approval.
  decided_by          TEXT NOT NULL,
  decided_at          TEXT NOT NULL,
  decision            TEXT NOT NULL CHECK (decision IN ('APPROVED','REJECTED','RETURNED')),
  -- What the system said, at the moment the person decided.
  recommended_outcome TEXT NOT NULL,
  -- Set when the decision differs from the recommendation. Disagreement is the
  -- signal worth having — it is where the rules are wrong, or the agent knows
  -- something the rules do not, and either way somebody should read it.
  note                TEXT
);

CREATE INDEX decision_by_submission ON decision (submission_id, decided_at);
-- Agreement rate, per outcome, is one query. That number is the evidence any
-- future automation would have to earn its way past (§18.5).
CREATE INDEX decision_by_agreement  ON decision (recommended_outcome, decision);

-- ---------------------------------------------------------------------------
-- The audit chain is deliberately NOT altered
-- ---------------------------------------------------------------------------
--
-- A decision is recorded as `action = 'decision.recorded'` against
-- `subject_type = 'submission'`, which the existing CHECK already permits.
--
-- Adding a 'decision' subject type would have meant rebuilding audit_event:
-- dropping its append-only triggers, copying every row out and back, and
-- restoring them. That is a real edit to the one table whose value is that it
-- cannot be edited, performed to widen a coarse category that already fits.
-- `subject_type` says what kind of thing was acted on; `action` says what
-- happened. A decision happens to a submission.

UPDATE schema_meta SET value = '5' WHERE key = 'schema_version';
