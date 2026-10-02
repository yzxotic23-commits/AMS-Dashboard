-- SIM Card Anomaly log (append-only).
-- One row per anomaly event so anomaly rates can be tracked per carrier / platform.
-- carrier, phone_number and site_key are snapshots at report time (the SIM row may change later).

CREATE TABLE IF NOT EXISTS sim_anomalies (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sim_id        UUID REFERENCES sims(id) ON DELETE SET NULL,
  account_id    UUID REFERENCES accounts(id) ON DELETE SET NULL,
  carrier       TEXT,
  phone_number  TEXT,
  site_key      TEXT,
  platform      TEXT NOT NULL DEFAULT 'whatsapp',
  reason        TEXT NOT NULL,
  detail        TEXT,
  source        TEXT,
  created_by    UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_by_name TEXT,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sim_anomalies_reason_check') THEN
    ALTER TABLE sim_anomalies
      ADD CONSTRAINT sim_anomalies_reason_check
      CHECK (reason IN ('service_suspended', 'expired', 'otp_failed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sim_anomalies_platform_check') THEN
    ALTER TABLE sim_anomalies
      ADD CONSTRAINT sim_anomalies_platform_check
      CHECK (platform IN ('whatsapp', 'telegram'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_sim_anomalies_time ON sim_anomalies (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_sim_anomalies_carrier ON sim_anomalies (carrier, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_sim_anomalies_sim ON sim_anomalies (sim_id, occurred_at DESC);

ALTER TABLE sim_anomalies ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'sim_anomalies' AND policyname = 'sim_anomalies_admin'
  ) THEN
    CREATE POLICY sim_anomalies_admin ON sim_anomalies FOR ALL
      USING (EXISTS (
        SELECT 1 FROM profiles p
        WHERE p.id = auth.uid() AND p.role IN ('admin', 'operator')
      ));
  END IF;
END $$;
