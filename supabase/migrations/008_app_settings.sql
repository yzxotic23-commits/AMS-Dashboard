-- App-wide settings (RM supply model, etc.)
CREATE TABLE IF NOT EXISTS app_settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL DEFAULT '{}',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by  UUID REFERENCES profiles(id) ON DELETE SET NULL
);

INSERT INTO app_settings (key, value)
VALUES ('rm_supply', '{}')
ON CONFLICT (key) DO NOTHING;
