-- Trading brands assigned to a user (business role scope).
-- Empty array: admin/operator/reviewer → no brand filter; business → no standby accounts.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS brands TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.profiles.brands IS
  'Trading brands this user may access (e.g. SBMY, JMMY, STMY). Used for business role scoping.';

CREATE INDEX IF NOT EXISTS idx_profiles_brands ON public.profiles USING GIN (brands);
