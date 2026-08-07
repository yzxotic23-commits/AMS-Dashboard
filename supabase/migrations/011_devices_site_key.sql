-- Device Ledger site assignment (especially SGD phones that can sit on MY or PP).
ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS site_key TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'devices_site_key_check'
  ) THEN
    ALTER TABLE devices
      ADD CONSTRAINT devices_site_key_check
      CHECK (site_key IS NULL OR site_key IN ('my', 'pp'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_devices_site_key ON devices(site_key);

COMMENT ON COLUMN public.devices.site_key IS
  'Physical/ops site for this device: my or pp. MYR/PP prefixes imply site; SGD stores the site chosen at add time.';
