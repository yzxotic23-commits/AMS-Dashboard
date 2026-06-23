-- Default site assignment per user (my | pp | all for admin)

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS site_key TEXT NOT NULL DEFAULT 'my';

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_site_key_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_site_key_check
  CHECK (site_key IN ('my', 'pp', 'all'));

COMMENT ON COLUMN public.profiles.site_key IS 'Assigned site: my, pp, or all (admin).';
