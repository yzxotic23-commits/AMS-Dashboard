-- Brand-shared account usage ledger (append-only).
-- Used to match ban timestamps against who was holding a shared account.

CREATE TABLE IF NOT EXISTS account_usage_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  actor_id     UUID REFERENCES profiles(id) ON DELETE SET NULL,
  actor_name   TEXT,
  action       TEXT NOT NULL,
  ticket_id    UUID REFERENCES tickets(id) ON DELETE SET NULL,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata     JSONB
);

CREATE INDEX IF NOT EXISTS idx_account_usage_account_time
  ON account_usage_events (account_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_account_usage_actor
  ON account_usage_events (actor_id, occurred_at DESC);

ALTER TABLE account_usage_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'account_usage_events' AND policyname = 'account_usage_events_admin'
  ) THEN
    CREATE POLICY account_usage_events_admin ON account_usage_events
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
