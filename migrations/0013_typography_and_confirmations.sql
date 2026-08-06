-- The §16.22 figures, and what the agent confirmed by eye (D53).
--
-- Two halves of the same change: the pipeline now measures what it can of the
-- formatting rules, and the person still decides them. This records both, and
-- records them separately, because they are different kinds of fact — one is
-- what a machine computed, the other is what a person attested.

-- What the pipeline measured, snapshotted onto the verdict.
--
-- Derived data, stored rather than recomputed, for the reason the applied
-- rules are stored (D44): the figures were shown to the agent who decided, and
-- an audit needs what they saw. Recomputing later would use today's code and
-- today's reference tables, which is a different question from "what did this
-- screen say when somebody approved it".
--
-- JSON rather than columns because nothing queries inside it. The moment
-- something does — an aggregate over how often type size is short — it earns
-- columns, and this becomes the migration that says why.
--
-- NULL means no measurement was taken: every verdict written before this
-- migration, and every one since where the reading carried no geometry, no
-- raster scale was configured, or item 19 could not be read. NULL is the
-- ordinary state and must not be read as "measured, and found nothing wrong".
ALTER TABLE verdict ADD COLUMN typography TEXT;   -- JSON, or NULL

-- Which advisory checks the agent ticked, at the moment they decided.
--
-- **Recorded, never enforced**, and the distinction is the whole design. A
-- decision is not blocked on ticking these: five compulsory ticks per
-- submission become a reflex within a shift, and a reflex manufactures a
-- record of five checks that nobody performed. That is worse than an empty
-- column, because it looks like evidence.
--
-- So an approval with nothing ticked is permitted, stored, and visible to an
-- audit — which turns the checklist from a gate into a measurement. If the
-- confirmation rate turns out to be four percent, that is a finding about the
-- checklist rather than about the agent.
--
-- NULL and '[]' say different things and both occur: NULL is a decision
-- recorded before this column existed, '[]' is a person who confirmed nothing.
-- Collapsing them would turn every historical decision into an attested
-- omission.
ALTER TABLE decision ADD COLUMN advisory_confirmed TEXT;   -- JSON array of ids

UPDATE schema_meta SET value = '13' WHERE key = 'schema_version';
