-- The policy archive as a bitemporal record (design §18.8, D41–D45).
--
-- Until now a rule's identity was `policySetVersion` — a number a person
-- maintained, with nothing checking it against the file it described. It failed
-- on the first amendment made to it: four regulations, fourteen documents and
-- five rules were added while the version stayed at 1, under which every verdict
-- bound to "1" would have replayed as COMPARABLE against rules it was never
-- judged by.
--
-- A rule's identity is WHEN IT IS IN FORCE. That was always in the file as
-- effective dates; the version was a second, weaker restatement of the same
-- fact that could fall out of step, and did.
--
-- ---------------------------------------------------------------------------
-- TWO TIMELINES, BECAUSE ONE CANNOT SAY ENOUGH
--
--   valid time        effective_from / effective_to
--                     Which SUBMISSION dates a rule governs. The law's own
--                     timeline: standards of fill changed on 2025-01-10, so a
--                     2024 filing is still judged by the old list.
--
--   transaction time  recorded_at / retired_at
--                     When THIS DEPLOYMENT held the rule to be true. Our
--                     timeline, and a different question.
--
-- A single date cannot distinguish "the law changed" from "we were wrong about
-- the law", and both are asked in an audit. Date a correction from today and
-- the record asserts the wrong rule legitimately governed earlier filings;
-- backdate it and the record asserts verdicts were computed with a rule they
-- never saw. Neither is true. Two axes can say what actually happened: the
-- valid-time window stays where the law put it, while the mistaken row is
-- retired in transaction time and its replacement recorded.
--
-- ---------------------------------------------------------------------------
-- THE FILE IS STILL THE REVIEWED SOURCE (D45)
--
-- `config/policy-set.json` is not replaced. It remains human-authored and
-- changed by pull request, because a diff somebody reads is the one place a
-- wrong rule is caught before it is enforced against every submission
-- thereafter. These rows are DERIVED from it and never hand-authored.
--
-- The file says what we intend the rules to be. The rows say what we actually
-- applied, and between when — which a file cannot, because superseding edits a
-- file in place and the previous wording survives only in git.

CREATE TABLE policy_rule (
  -- Surrogate key. `rule_id` is the stable business identifier and appears
  -- once per recorded window, so it cannot be the primary key.
  id                 TEXT PRIMARY KEY,
  rule_id            TEXT NOT NULL,

  -- What decides "this rule changed". Digest of the rule as applied, so a
  -- reconciliation can tell an edit from a re-run without diffing JSON by eye.
  -- The same tripwire the regulations already carry, one level down.
  body_digest        TEXT NOT NULL,
  -- The rule as applied, verbatim. Not a reference to the file: the file moves
  -- on, and this row has to answer for a verdict years later.
  body               TEXT NOT NULL,

  -- ---- valid time: the submission dates this rule governs ----------------
  -- Null means unbounded. `effective_to` null is the ordinary case and means
  -- "until something supersedes it", which is what an in-force rule is.
  effective_from     TEXT,
  effective_to       TEXT,

  -- ---- transaction time: when this deployment held it --------------------
  recorded_at        TEXT NOT NULL,
  retired_at         TEXT,

  status             TEXT NOT NULL CHECK (status IN ('draft', 'active', 'superseded')),
  severity           TEXT NOT NULL CHECK (severity IN ('blocking', 'advisory')),

  -- ---- what a finding needs to be defensible without this table ----------
  regulation_id      TEXT,
  citation           TEXT,
  source_document_id TEXT,
  quote              TEXT,
  approved_by        TEXT,
  approved_at        TEXT,

  -- Which reconciliation wrote this row, so a row can be traced to the deploy
  -- that recorded it and to the audit event that announced it.
  recorded_by        TEXT NOT NULL
);

-- Selection asks one question: which rules were in force for a filing on
-- `validOn`, as this deployment understood it at `asOf`. Both windows are in
-- the index because both are in the predicate.
CREATE INDEX policy_rule_current ON policy_rule (retired_at, status, effective_from, effective_to);
-- The history of one rule, in order. This is the query an auditor runs.
CREATE INDEX policy_rule_by_id ON policy_rule (rule_id, recorded_at);

-- Append-only, enforced by the database rather than by discipline — the same
-- reasoning as `audit_event`, and D27 ("supersede, never delete") made real.
--
-- Deleting is refused outright. Updating is refused EXCEPT for closing a
-- window, which is the one edit a bitemporal record needs: retiring a row is
-- how it is superseded. A closed window may not be reopened or rewritten,
-- because that would silently change what the record says was applied.
CREATE TRIGGER policy_rule_no_delete
BEFORE DELETE ON policy_rule
BEGIN
  SELECT RAISE(ABORT, 'policy_rule is append-only: supersede a rule, never delete it');
END;

CREATE TRIGGER policy_rule_close_only
BEFORE UPDATE ON policy_rule
WHEN OLD.retired_at IS NOT NULL
  OR NEW.id            <> OLD.id
  OR NEW.rule_id       <> OLD.rule_id
  OR NEW.body_digest   <> OLD.body_digest
  OR NEW.body          <> OLD.body
  OR NEW.recorded_at   <> OLD.recorded_at
BEGIN
  SELECT RAISE(ABORT,
    'policy_rule rows are immutable except to close retired_at or effective_to');
END;

UPDATE schema_meta SET value = '7' WHERE key = 'schema_version';
