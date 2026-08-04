-- Pin a finding to the exact regulation TEXT it rests on (D44, continued).
--
-- A finding already carries its citation, the check as applied, and — when the
-- rule has provenance — the verbatim words it was drawn from. Two of those were
-- coming back null in practice, for opposite reasons.
--
-- ---------------------------------------------------------------------------
-- THE APPROVER WAS NULL BECAUSE IT WAS LOOKED FOR IN ONE PLACE
--
-- A rule may name its own approver, and none of the enacted ones do — they are
-- covered by the SET's `approvedBy`, which is a named person. The snapshot read
-- `rule.approval.by` and stopped. It now inherits the set's, which is the same
-- resolution the enactment already uses, and D27's requirement that no rule
-- reaches force without a named human approval is what makes the fallback
-- correct rather than convenient.
--
-- ---------------------------------------------------------------------------
-- THE QUOTE IS NULL BECAUSE THE ENACTED RULES HAVE NO PROVENANCE
--
-- And that cannot be fixed from here. Writing provenance for a rule already in
-- force means asserting who read the regulation: `human` would be a claim this
-- system cannot support, and `model` would make the rule one a model derived —
-- which §18.5a then requires a named approval for. Either way it is a
-- governance act, not a schema change, and D46 now refuses it rather than
-- leaving it to judgement.
--
-- So the quote stays null where there is none, and these two columns make that
-- absence stop meaning "untraceable". The regulation registry already carries a
-- digest of the text that was read and the issue date it was read from, which
-- identifies the source EXACTLY — arguably better than a fragment somebody
-- copied, because a digest cannot be paraphrased.
--
-- Nullable, because a finding written before this had no such record, and
-- inventing one would be a claim about a verdict nobody made.

-- Fingerprint of the regulation text the rule was derived from. A later
-- re-extraction that disagrees means the regulation moved and every finding
-- resting on it needs review — the same tripwire the archive already carries,
-- now reaching the individual finding.
ALTER TABLE policy_finding ADD COLUMN regulation_digest TEXT;
-- Which issue of the CFR that text came from.
ALTER TABLE policy_finding ADD COLUMN regulation_issued TEXT;

UPDATE schema_meta SET value = '10' WHERE key = 'schema_version';
