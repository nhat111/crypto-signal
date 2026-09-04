-- Which version of the scoring formulas produced a scan.
--
-- Component formulas change — `survivalScore` just did, because the old one
-- returned a flat 100 for every token past the ideal age and so ranked
-- nothing. But `gem_components` is frozen into each scan at the moment it
-- ran, so after a formula change the per-component analysis is silently
-- comparing two different definitions of the same number: old rows all
-- holding 100, new rows spread across the range. The comparison would look
-- fine and mean nothing.
--
-- Stamping the version lets each component be measured only over the scans
-- whose definition matches the one in force now. Per component, not per
-- table: momentum did not change, so its history stays usable and only the
-- component that actually moved loses its past.
--
-- Existing rows default to 1, which is what they were.

ALTER TABLE gem_scans
  ADD COLUMN IF NOT EXISTS scoring_version INTEGER NOT NULL DEFAULT 1;
