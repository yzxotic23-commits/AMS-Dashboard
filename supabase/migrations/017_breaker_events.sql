-- Circuit-breaker ledger: one row per guarded irreversible action (bans, engine
-- disconnects, deletes). The API counts recent rows per kind to stop runaway batches.
CREATE TABLE IF NOT EXISTS breaker_events (
  id          BIGSERIAL PRIMARY KEY,
  kind        TEXT NOT NULL,
  user_id     UUID REFERENCES profiles(id) ON DELETE SET NULL,
  automated   BOOLEAN NOT NULL DEFAULT false,
  confirmed   BOOLEAN NOT NULL DEFAULT false,
  blocked     BOOLEAN NOT NULL DEFAULT false,
  path        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_breaker_events_kind_time ON breaker_events (kind, created_at DESC);

ALTER TABLE breaker_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON breaker_events FROM anon, authenticated;
REVOKE ALL ON SEQUENCE breaker_events_id_seq FROM anon, authenticated;
