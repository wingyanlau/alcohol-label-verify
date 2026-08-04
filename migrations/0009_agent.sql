-- Who or what acted, as one concept (design §19, D46).
--
-- The idea was already in the record four times and joinable none of them:
-- `audit_event.actor` as a free string, `RuleProvenance.extractedBy` as
-- human-or-model, `extraction.model_id` as a qualified reader, and
-- `decision.decided_by` / `policy_rule.approved_by` as people. The record could
-- say a model read a label and a person approved it, and could not answer what
-- either agent had done.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS IS FOR, AND IT IS NOT HEADCOUNT
--
-- The governing principle — the model reads, the rules compare, the human
-- decides — is enforced in exactly ONE place today (validatePolicySet refusing
-- a model-extracted rule that is active without an approval) and described
-- everywhere else. Prose does not fail a build.
--
-- With a kind on every recorded act it becomes a query over the whole record:
--
--   no act with actor_kind = 'model' may carry action = 'decision.recorded'
--
-- That is the project's central claim turned into something assertable
-- continuously, against production data. The workforce metric is deliberately
-- NOT built (D47, §19.6).
--
-- ---------------------------------------------------------------------------
-- THESE COLUMNS ARE OUTSIDE THE DIGEST, DELIBERATELY
--
-- `canonical()` hashes [at, actor, action, subject_type, subject_id, detail].
-- Adding a field to it would invalidate every digest already written and break
-- the chain for the entire history — to record something the chain can already
-- attest to, because `actor` is in the digest and the kind is a classification
-- OF that actor.
--
-- So the honest statement is: `actor` is tamper-evident; `actor_kind` and
-- `actor_id` are an index over it, and are rebuildable from it. An altered kind
-- that contradicts its actor is visible for that reason.
--
-- The backfill below is the proof: it touches no digested field, so
-- `/audit/verify` must still pass afterwards. If it does not, the migration did
-- something it was not supposed to.

ALTER TABLE audit_event ADD COLUMN actor_kind TEXT;
-- The qualified identity. For a model that is provider:model:prompt — never a
-- floating alias (D29, §19.4), because a version, a prompt and a sampling
-- change all change what it produces, and one name over two readers reports
-- the difference as a trend.
ALTER TABLE audit_event ADD COLUMN actor_id TEXT;

-- The trigger has to come off to backfill, and go straight back on. This is a
-- deliberate act against the protection rather than a way around it: the table
-- refuses UPDATE precisely so that a change like this cannot happen by
-- accident, and a migration is where it is allowed to happen on purpose.
DROP TRIGGER audit_event_no_update;

-- Classified by the only evidence available, and exact rather than a guess for
-- this history: every actor written so far has been either the system itself
-- or a person's name. No model has ever been recorded as an actor, because
-- until now nothing could record one.
UPDATE audit_event
   SET actor_kind = CASE WHEN actor IN ('system', 'deploy') THEN 'system' ELSE 'human' END,
       actor_id   = actor;

CREATE TRIGGER audit_event_no_update
BEFORE UPDATE ON audit_event
BEGIN
  SELECT RAISE(ABORT, 'audit_event is append-only');
END;

-- "What has this agent done" is now one query rather than four that cannot be
-- joined.
CREATE INDEX audit_by_actor ON audit_event (actor_kind, actor_id, seq);

UPDATE schema_meta SET value = '9' WHERE key = 'schema_version';
