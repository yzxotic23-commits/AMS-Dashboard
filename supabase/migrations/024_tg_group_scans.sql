-- Telegram group scan (GCS accounts). An admin queues a scan in AMS; the Friday listener claims it,
-- reads the account's groups with its own live session (never a second session — that kills it),
-- and commits the full list at once. A partial or failed scan never replaces the last good list.

CREATE TABLE IF NOT EXISTS tg_group_scans (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      TEXT NOT NULL REFERENCES tg_accounts(id) ON DELETE CASCADE,
  requested_by    UUID REFERENCES profiles(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued', 'running', 'done', 'failed', 'cancelled')),
  progress_done   INTEGER NOT NULL DEFAULT 0,
  progress_total  INTEGER,
  group_count     INTEGER,
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at      TIMESTAMPTZ,
  heartbeat_at    TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tg_group_scans_open ON tg_group_scans (created_at)
  WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS idx_tg_group_scans_account ON tg_group_scans (account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tg_account_groups (
  account_id    TEXT NOT NULL REFERENCES tg_accounts(id) ON DELETE CASCADE,
  group_id      TEXT NOT NULL,
  group_name    TEXT,
  member_count  INTEGER,
  is_admin      BOOLEAN NOT NULL DEFAULT false,
  is_owner      BOOLEAN NOT NULL DEFAULT false,
  invite_link   TEXT,
  scanned_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (account_id, group_id)
);

CREATE INDEX IF NOT EXISTS idx_tg_account_groups_group ON tg_account_groups (group_id);

ALTER TABLE tg_group_scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE tg_account_groups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON tg_group_scans FROM anon, authenticated;
REVOKE ALL ON tg_account_groups FROM anon, authenticated;

-- Replace one account's group list and close its scan in a single transaction.
CREATE OR REPLACE FUNCTION tg_commit_group_scan(p_scan_id UUID, p_groups JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_account TEXT;
  v_count   INTEGER;
BEGIN
  SELECT account_id INTO v_account
  FROM tg_group_scans
  WHERE id = p_scan_id AND status = 'running'
  FOR UPDATE;
  IF v_account IS NULL THEN
    RAISE EXCEPTION 'scan % is not running', p_scan_id;
  END IF;

  DELETE FROM tg_account_groups WHERE account_id = v_account;

  INSERT INTO tg_account_groups (account_id, group_id, group_name, member_count, is_admin, is_owner, invite_link, scanned_at)
  SELECT DISTINCT ON (g->>'group_id')
    v_account,
    g->>'group_id',
    NULLIF(g->>'group_name', ''),
    NULLIF(g->>'member_count', '')::INTEGER,
    COALESCE((g->>'is_admin')::BOOLEAN, false) OR COALESCE((g->>'is_owner')::BOOLEAN, false),
    COALESCE((g->>'is_owner')::BOOLEAN, false),
    NULLIF(g->>'invite_link', ''),
    NOW()
  FROM jsonb_array_elements(p_groups) AS g
  WHERE COALESCE(g->>'group_id', '') <> '';

  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE tg_group_scans
  SET status = 'done', group_count = v_count, progress_done = v_count,
      progress_total = COALESCE(progress_total, v_count), finished_at = NOW(), heartbeat_at = NOW()
  WHERE id = p_scan_id;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION tg_commit_group_scan(UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION tg_commit_group_scan(UUID, JSONB) TO service_role;

ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'TG_GROUP_SCAN';
