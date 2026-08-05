-- SIM Card Ledger fields as real Supabase columns (no longer only in notes JSON).
-- Also stores top-up history in sim_topups.

ALTER TABLE sims
  ADD COLUMN IF NOT EXISTS ledger_status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS remark TEXT,
  ADD COLUMN IF NOT EXISTS remark_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS remark_updated_by TEXT,
  ADD COLUMN IF NOT EXISTS last_charged DATE,
  ADD COLUMN IF NOT EXISTS last_amount NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS last_cycle_days INTEGER DEFAULT 30,
  ADD COLUMN IF NOT EXISTS last_plan TEXT,
  ADD COLUMN IF NOT EXISTS last_exception JSONB,
  ADD COLUMN IF NOT EXISTS site_key TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sims_ledger_status_check'
  ) THEN
    ALTER TABLE sims
      ADD CONSTRAINT sims_ledger_status_check
      CHECK (ledger_status IN ('active', 'pending_review', 'stop_topup'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_sims_ledger_status ON sims(ledger_status);
CREATE INDEX IF NOT EXISTS idx_sims_last_charged ON sims(last_charged);
CREATE INDEX IF NOT EXISTS idx_sims_site_key ON sims(site_key);

CREATE TABLE IF NOT EXISTS sim_topups (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sim_id       UUID NOT NULL REFERENCES sims(id) ON DELETE CASCADE,
  charged_at   DATE NOT NULL,
  amount       NUMERIC(12, 2),
  cycle_days   INTEGER NOT NULL DEFAULT 30,
  plan         TEXT,
  expiry_date  DATE,
  refund       JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by   TEXT
);

CREATE INDEX IF NOT EXISTS idx_sim_topups_sim ON sim_topups(sim_id, charged_at DESC, created_at DESC);

ALTER TABLE sim_topups ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'sim_topups' AND policyname = 'sim_topups_admin'
  ) THEN
    CREATE POLICY sim_topups_admin ON sim_topups FOR ALL
      USING (EXISTS (
        SELECT 1 FROM profiles p
        WHERE p.id = auth.uid() AND p.role IN ('admin', 'operator')
      ));
  END IF;
END $$;
