-- Plain-text login reference on profiles (internal ops — NOT bcrypt).
-- Login AMS tetap lewat Supabase Auth (auth.users); kolom ini supaya bisa dilihat di Table Editor.
-- Setelah buat user di Authentication → Users, jalankan:
--   UPDATE public.profiles SET password_hash = 'password-mereka' WHERE email = '...';

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS password_hash TEXT;

COMMENT ON COLUMN public.profiles.password_hash IS
  'Plain-text password reference for staff ops (private project). Sync with Supabase Auth password.';
