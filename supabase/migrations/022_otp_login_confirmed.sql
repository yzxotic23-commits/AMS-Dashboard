-- Telegram OTP: the listener reports when a new device signs in after a code was delivered.
ALTER TABLE otp_requests ADD COLUMN IF NOT EXISTS logged_in_at TIMESTAMPTZ;

ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'OTP_LOGIN_CONFIRMED';
