-- =============================================================================
-- AMS Platform — Initial Schema (Supabase PostgreSQL)
-- Run in Supabase SQL Editor or via CLI: supabase db push
-- =============================================================================

-- ── Extensions ──────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Enums ─────────────────────────────────────────────────────────────────────

CREATE TYPE user_role AS ENUM ('admin', 'operator', 'business', 'reviewer');

CREATE TYPE account_status AS ENUM (
  'REGISTERING',
  'NURTURING',
  'AVAILABLE',
  'IN_USE',
  'LOGGED_OUT',
  'BANNED',
  'RECOVERING',
  'RECYCLED'
);

CREATE TYPE resource_status AS ENUM ('ACTIVE', 'INACTIVE', 'MAINTENANCE', 'RETIRED');

CREATE TYPE sim_status AS ENUM ('OK', 'LOW_BALANCE', 'EXPIRING', 'EXPIRED', 'CANCELLED');

CREATE TYPE ip_status AS ENUM ('ACTIVE', 'INACTIVE', 'FLAGGED', 'RETIRED');

CREATE TYPE ticket_status AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');

CREATE TYPE ip_gate_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TYPE session_status AS ENUM ('CONNECTED', 'DISCONNECTED', 'LOGGED_OUT', 'BANNED', 'UNKNOWN');

CREATE TYPE audit_action AS ENUM (
  'CREATE', 'UPDATE', 'DELETE',
  'STATE_CHANGE',
  'ASSIGNMENT_CHANGE',
  'IP_GATE_APPROVE', 'IP_GATE_REJECT',
  'IP_REVIEW_MATCH', 'IP_REVIEW_MISMATCH',
  'TICKET_CREATE', 'TICKET_UPDATE',
  'FEEDING_START', 'FEEDING_STOP',
  'LOGIN', 'LOGOUT'
);

CREATE TYPE entity_type AS ENUM (
  'account', 'device', 'sim', 'ip',
  'ticket', 'ip_gate', 'session', 'user', 'profile'
);

-- ── Profiles (extends Supabase auth.users) ────────────────────────────────────

CREATE TABLE profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  full_name     TEXT,
  role          user_role NOT NULL DEFAULT 'operator',
  avatar_url    TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_profiles_role ON profiles(role);
CREATE INDEX idx_profiles_email ON profiles(email);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    COALESCE((NEW.raw_user_meta_data->>'role')::user_role, 'operator')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ── Devices (Module 2) ───────────────────────────────────────────────────────

CREATE TABLE devices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_name     TEXT NOT NULL,
  brand           TEXT,
  model           TEXT,
  serial_number   TEXT UNIQUE,
  status          resource_status NOT NULL DEFAULT 'ACTIVE',
  current_account_id UUID,  -- FK added after accounts table
  current_ip_id   UUID,     -- FK added after ips table
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_devices_status ON devices(status);
CREATE INDEX idx_devices_serial ON devices(serial_number);

-- ── SIM Cards (Module 3) ────────────────────────────────────────────────────

CREATE TABLE sims (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number        TEXT NOT NULL UNIQUE,
  carrier             TEXT,
  expiry_date         DATE,
  balance             NUMERIC(12, 2) DEFAULT 0,
  status              sim_status NOT NULL DEFAULT 'OK',
  current_account_id  UUID,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sims_status ON sims(status);
CREATE INDEX idx_sims_phone ON sims(phone_number);
CREATE INDEX idx_sims_expiry ON sims(expiry_date);

-- ── IP / Proxy (Module 4) ───────────────────────────────────────────────────

CREATE TABLE ips (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proxy_provider      TEXT,
  proxy_type          TEXT,  -- SOCKS5, HTTP, etc.
  ip_address          TEXT NOT NULL,
  port                TEXT,
  username            TEXT,
  password            TEXT,
  country             TEXT,
  status              ip_status NOT NULL DEFAULT 'ACTIVE',
  assigned_device_id  UUID REFERENCES devices(id) ON DELETE SET NULL,
  assigned_account_id UUID,
  risk_count          INTEGER NOT NULL DEFAULT 0,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ips_status ON ips(status);
CREATE INDEX idx_ips_address ON ips(ip_address);

-- ── Accounts (Module 1) ─────────────────────────────────────────────────────

CREATE TABLE accounts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_name        TEXT NOT NULL,
  phone_number        TEXT,
  status              account_status NOT NULL DEFAULT 'REGISTERING',
  device_id           UUID REFERENCES devices(id) ON DELETE SET NULL,
  sim_id              UUID REFERENCES sims(id) ON DELETE SET NULL,
  ip_id               UUID REFERENCES ips(id) ON DELETE SET NULL,
  registration_date   TIMESTAMPTZ DEFAULT NOW(),
  last_active         TIMESTAMPTZ,
  wsaf_slot           INTEGER,  -- bridge to FeedFlow engine (future integration)
  notes               TEXT,
  created_by          UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_accounts_wsaf_slot UNIQUE (wsaf_slot)
);

CREATE INDEX idx_accounts_status ON accounts(status);
CREATE INDEX idx_accounts_phone ON accounts(phone_number);
CREATE INDEX idx_accounts_device ON accounts(device_id);
CREATE INDEX idx_accounts_sim ON accounts(sim_id);
CREATE INDEX idx_accounts_ip ON accounts(ip_id);
CREATE INDEX idx_accounts_name ON accounts(account_name);

-- Add deferred FKs on devices/sims/ips
ALTER TABLE devices
  ADD CONSTRAINT fk_devices_current_account FOREIGN KEY (current_account_id) REFERENCES accounts(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_devices_current_ip FOREIGN KEY (current_ip_id) REFERENCES ips(id) ON DELETE SET NULL;

ALTER TABLE sims
  ADD CONSTRAINT fk_sims_current_account FOREIGN KEY (current_account_id) REFERENCES accounts(id) ON DELETE SET NULL;

ALTER TABLE ips
  ADD CONSTRAINT fk_ips_assigned_account FOREIGN KEY (assigned_account_id) REFERENCES accounts(id) ON DELETE SET NULL;

-- ── Assignment History (Relationships) ────────────────────────────────────────

CREATE TABLE account_device_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  device_id   UUID REFERENCES devices(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unassigned_at TIMESTAMPTZ,
  assigned_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  notes       TEXT
);

CREATE TABLE account_sim_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  sim_id      UUID REFERENCES sims(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unassigned_at TIMESTAMPTZ,
  assigned_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  notes       TEXT
);

CREATE TABLE account_ip_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  ip_id       UUID REFERENCES ips(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unassigned_at TIMESTAMPTZ,
  assigned_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  notes       TEXT
);

CREATE INDEX idx_dev_hist_account ON account_device_history(account_id);
CREATE INDEX idx_sim_hist_account ON account_sim_history(account_id);
CREATE INDEX idx_ip_hist_account ON account_ip_history(account_id);

-- ── Account State Machine History (Module 5) ──────────────────────────────────

CREATE TABLE account_status_history (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  from_status   account_status,
  to_status     account_status NOT NULL,
  reason        TEXT,
  changed_by    UUID REFERENCES profiles(id) ON DELETE SET NULL,
  changed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_status_hist_account ON account_status_history(account_id);
CREATE INDEX idx_status_hist_changed ON account_status_history(changed_at DESC);

-- ── Global Audit Log (Module 6) ─────────────────────────────────────────────

CREATE TABLE audit_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type     entity_type NOT NULL,
  entity_id       UUID,
  action          audit_action NOT NULL,
  previous_value  JSONB,
  new_value       JSONB,
  metadata        JSONB,
  user_id         UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ip_address      TEXT,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_user ON audit_logs(user_id);
CREATE INDEX idx_audit_created ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_action ON audit_logs(action);

-- ── Tickets (Module 8) ──────────────────────────────────────────────────────

CREATE TABLE tickets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number TEXT NOT NULL UNIQUE DEFAULT ('TKT-' || UPPER(SUBSTRING(gen_random_uuid()::TEXT, 1, 8))),
  title         TEXT NOT NULL,
  description   TEXT,
  status        ticket_status NOT NULL DEFAULT 'OPEN',
  priority      TEXT NOT NULL DEFAULT 'normal',  -- low, normal, high, urgent
  requester_id  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  assignee_id   UUID REFERENCES profiles(id) ON DELETE SET NULL,
  account_id    UUID REFERENCES accounts(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at     TIMESTAMPTZ
);

CREATE INDEX idx_tickets_status ON tickets(status);
CREATE INDEX idx_tickets_requester ON tickets(requester_id);
CREATE INDEX idx_tickets_assignee ON tickets(assignee_id);

-- ── IP Gate Reviews (Module 9) ──────────────────────────────────────────────

CREATE TABLE ip_gate_reviews (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id              UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  phone_ip_screenshot_url TEXT,
  pc_ip_screenshot_url    TEXT,
  status                  ip_gate_status NOT NULL DEFAULT 'PENDING',
  reviewer_id             UUID REFERENCES profiles(id) ON DELETE SET NULL,
  review_note             TEXT,
  reviewed_at             TIMESTAMPTZ,
  submitted_by            UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ip_gate_account ON ip_gate_reviews(account_id);
CREATE INDEX idx_ip_gate_status ON ip_gate_reviews(status);

-- ── Session Monitoring / Keep-Alive (Module 10) ─────────────────────────────

CREATE TABLE session_monitoring (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  session_status      session_status NOT NULL DEFAULT 'UNKNOWN',
  last_check          TIMESTAMPTZ,
  detection_source    TEXT,  -- 'socket', 'cron', 'manual', 'feedflow_bridge'
  event_trigger_time  TIMESTAMPTZ,
  wsaf_slot           INTEGER,
  metadata            JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_session_account UNIQUE (account_id)
);

CREATE INDEX idx_session_status ON session_monitoring(session_status);
CREATE INDEX idx_session_last_check ON session_monitoring(last_check);

-- ── IP Audits (operational) ─────────────────────────────────────────────────

CREATE TABLE ip_audits (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_id           UUID NOT NULL REFERENCES ips(id) ON DELETE CASCADE,
  result          TEXT NOT NULL DEFAULT 'pass',  -- pass, flag, retire
  risk_note       TEXT,
  ban_count_at    INTEGER DEFAULT 0,
  audited_by      UUID REFERENCES profiles(id) ON DELETE SET NULL,
  audited_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ip_audits_ip ON ip_audits(ip_id);

-- ── Daily Reporting Snapshots (Module 12 — framework) ───────────────────────

CREATE TABLE daily_metrics (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_date           DATE NOT NULL UNIQUE,
  registrations_count   INTEGER DEFAULT 0,
  available_count       INTEGER DEFAULT 0,
  in_use_count          INTEGER DEFAULT 0,
  banned_count          INTEGER DEFAULT 0,
  logged_out_count      INTEGER DEFAULT 0,
  ban_rate              NUMERIC(5, 2),
  logout_rate           NUMERIC(5, 2),
  feeding_runs          INTEGER DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Updated_at trigger ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_devices_updated BEFORE UPDATE ON devices FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_sims_updated BEFORE UPDATE ON sims FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_ips_updated BEFORE UPDATE ON ips FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_accounts_updated BEFORE UPDATE ON accounts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_tickets_updated BEFORE UPDATE ON tickets FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_ip_gate_updated BEFORE UPDATE ON ip_gate_reviews FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_session_updated BEFORE UPDATE ON session_monitoring FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Row Level Security ────────────────────────────────────────────────────────

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE sims ENABLE ROW LEVEL SECURITY;
ALTER TABLE ips ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ip_gate_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_monitoring ENABLE ROW LEVEL SECURITY;

-- Profiles: users read own profile
CREATE POLICY profiles_select_own ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY profiles_update_own ON profiles FOR UPDATE USING (auth.uid() = id);

-- Business users: read available accounts only
CREATE POLICY accounts_business_read ON accounts FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'operator', 'reviewer'))
    OR (status = 'AVAILABLE' AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'business'))
  );

-- Admin/operator full access on accounts (via service role from API — RLS bypassed with service key)
CREATE POLICY accounts_admin_all ON accounts FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'operator')));

-- Similar policies for resources (admin/operator)
CREATE POLICY devices_admin ON devices FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'operator')));
CREATE POLICY sims_admin ON sims FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'operator')));
CREATE POLICY ips_admin ON ips FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'operator')));

-- Audit: admin/operator read
CREATE POLICY audit_read ON audit_logs FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'operator')));

-- Tickets: requester sees own, assignee/admin see all
CREATE POLICY tickets_read ON tickets FOR SELECT
  USING (
    requester_id = auth.uid()
    OR assignee_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'operator'))
  );

CREATE POLICY tickets_insert ON tickets FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- ── Dashboard helper views ────────────────────────────────────────────────────

CREATE OR REPLACE VIEW v_dashboard_stats AS
SELECT
  (SELECT COUNT(*) FROM accounts) AS total_accounts,
  (SELECT COUNT(*) FROM accounts WHERE status = 'AVAILABLE') AS available_accounts,
  (SELECT COUNT(*) FROM accounts WHERE status = 'IN_USE') AS in_use_accounts,
  (SELECT COUNT(*) FROM accounts WHERE status = 'BANNED') AS banned_accounts,
  (SELECT COUNT(*) FROM accounts WHERE status = 'LOGGED_OUT') AS logged_out_accounts,
  (SELECT COUNT(*) FROM accounts WHERE status = 'NURTURING') AS nurturing_accounts,
  (SELECT COUNT(*) FROM accounts WHERE status = 'REGISTERING') AS registering_accounts,
  (SELECT COUNT(*) FROM devices WHERE status = 'ACTIVE') AS total_devices,
  (SELECT COUNT(*) FROM sims) AS total_sims,
  (SELECT COUNT(*) FROM ips WHERE status = 'ACTIVE') AS total_ips,
  (SELECT COUNT(*) FROM tickets WHERE status IN ('OPEN', 'IN_PROGRESS')) AS open_tickets,
  (SELECT COUNT(*) FROM ip_gate_reviews WHERE status = 'PENDING') AS pending_ip_gate;

-- ── Seed: promote first user to admin (run manually after signup) ─────────────
-- UPDATE profiles SET role = 'admin' WHERE email = 'your@email.com';
