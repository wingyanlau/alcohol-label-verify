-- What a verdict binds, and what a finding carries (D41, D44).
--
-- ---------------------------------------------------------------------------
-- DATES INSTEAD OF A VERSION
--
-- `policy_set_version` (migration 0005) was the identity a verdict bound. It
-- was a hand-maintained integer, and replay compared it as one: equal meant
-- comparable. That made every policy change turn every prior verdict
-- permanently `not-comparable`, because the rules that produced it no longer
-- existed anywhere — and worse, an UNCHANGED integer over a CHANGED file meant
-- comparable when it was not.
--
--   valid_on  the date the application was FILED. Which rules were in force.
--   as_of     the moment this deployment judged it. Which rules it then held.
--
-- Together they reconstruct the exact rule set from `policy_rule`, however long
-- afterwards somebody asks. Replay stops degrading.
--
-- The old column is kept and still written. It is no longer the identity, but
-- deleting it would strand every verdict already recorded — and this migration
-- is precisely the sort of change whose own history has to survive it.

ALTER TABLE verdict ADD COLUMN valid_on TEXT;
ALTER TABLE verdict ADD COLUMN as_of    TEXT;

-- ---------------------------------------------------------------------------
-- THE FINDING CARRIES ITS OWN DEFENCE
--
-- A finding stored the rule id and the requirement sentence. The citation was
-- resolved against TODAY's archive when somebody read it, so a rule since
-- retired yielded nothing and a rule whose regulation moved yielded the wrong
-- section — and the parameters actually applied, the list or pattern that
-- decided the outcome, were stored nowhere at all. Two rules with identical
-- prose and different permitted values were indistinguishable in the record.
--
-- Evidence that depends on a live lookup is not evidence. It fails exactly when
-- it matters: years later, after a migration, or in a dispute where the archive
-- itself is the thing in question. So each finding keeps what it was judged by.
--
-- Nullable, because every finding written before this migration genuinely has
-- no snapshot, and inventing one would be a claim about a verdict nobody made.

ALTER TABLE policy_finding ADD COLUMN regulation_id TEXT;
-- As an agent would cite it — "27 CFR 5.203" — frozen at the moment of judging.
ALTER TABLE policy_finding ADD COLUMN citation      TEXT;
-- The verbatim words the rule was drawn from, so reviewing it later does not
-- mean re-reading the whole regulation (§18.5a).
ALTER TABLE policy_finding ADD COLUMN quote         TEXT;
-- The check as applied: the permitted list, the format, the bound. JSON.
ALTER TABLE policy_finding ADD COLUMN check_params  TEXT;
-- Who enacted the rule this finding rests on. A finding nobody can attribute is
-- one nobody has to answer for.
ALTER TABLE policy_finding ADD COLUMN approved_by   TEXT;
-- Which archive row produced it, so a finding can be walked back to the exact
-- row and its two windows.
ALTER TABLE policy_finding ADD COLUMN policy_row_id TEXT;

UPDATE schema_meta SET value = '8' WHERE key = 'schema_version';
