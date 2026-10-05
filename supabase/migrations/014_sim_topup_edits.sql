-- SIM Ledger "Update" corrects the latest top-up instead of inserting a duplicate.
-- Each correction is appended to edits: [{ at, by, changes: { field: { from, to } } }].
ALTER TABLE sim_topups
  ADD COLUMN IF NOT EXISTS edits JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
