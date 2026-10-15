-- Telegram OTP via AMS. The TG-OTP listener (Railway) holds the Telegram sessions; it syncs
-- the account roster here and hands over a login code only when an AMS user has an open
-- request for that account. Passwords are never stored in the roster, only on a delivered
-- request, and are wiped shortly after delivery.

CREATE TABLE IF NOT EXISTS tg_accounts (
  id          TEXT PRIMARY KEY,
  pool        TEXT NOT NULL CHECK (pool IN ('gcs', 'shooter')),
  phone       TEXT,
  profile     TEXT,
  brand       TEXT,
  currency    TEXT,
  owner       TEXT,
  status      TEXT,
  enabled     BOOLEAN NOT NULL DEFAULT true,
  synced_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tg_accounts_owner ON tg_accounts (owner);

CREATE TABLE IF NOT EXISTS otp_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    TEXT NOT NULL REFERENCES tg_accounts(id) ON DELETE CASCADE,
  requested_by  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'delivered', 'expired', 'cancelled')),
  code          TEXT,
  password      TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ NOT NULL,
  delivered_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_otp_requests_account_open ON otp_requests (account_id, created_at DESC)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_otp_requests_user ON otp_requests (requested_by, created_at DESC);

ALTER TABLE tg_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE otp_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON tg_accounts FROM anon, authenticated;
REVOKE ALL ON otp_requests FROM anon, authenticated;

-- Which shooter owner (as named in the TG-OTP roster) this AMS user is.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS tg_shooter_owner TEXT;

ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'OTP_REQUEST';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'OTP_DELIVERED';
ALTER TYPE entity_type ADD VALUE IF NOT EXISTS 'tg_account';
