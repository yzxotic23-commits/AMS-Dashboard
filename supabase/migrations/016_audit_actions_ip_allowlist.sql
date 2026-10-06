-- Audit actions the API already writes but the enum rejected (writes failed silently).
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'USER_CREATE';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'USER_UPDATE';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'USER_DELETE';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'BULK_IMPORT';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'DEVICE_EXPAND';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'RM_SUPPLY_UPDATE';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'RM_SUPPLY_RESET';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'LOGIN_FAILED';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'EXPORT';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'SETTINGS_UPDATE';

ALTER TYPE entity_type ADD VALUE IF NOT EXISTS 'app_settings';

-- Company network allowlist for the AMS API (Settings → Access).
INSERT INTO app_settings (key, value)
VALUES ('ip_allowlist', '{"enabled": false, "entries": []}')
ON CONFLICT (key) DO NOTHING;
