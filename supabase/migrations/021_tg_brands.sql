-- Telegram OTP: GCS brands (as named in the TG-OTP roster) an operator may request codes for.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS tg_brands TEXT[] NOT NULL DEFAULT '{}';
