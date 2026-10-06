-- The web app only uses Supabase Auth from the browser; all table reads/writes go
-- through the AMS API with the service role. The anon key ships in the web bundle,
-- so anon/authenticated must not be able to touch public tables via PostgREST.

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;

ALTER TABLE account_device_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_ip_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_sim_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE ip_audits ENABLE ROW LEVEL SECURITY;

-- Let users rewrite their own profile row (incl. role / is_active), or insert any profile.
DROP POLICY IF EXISTS profiles_update_own ON profiles;
DROP POLICY IF EXISTS profiles_insert_system ON profiles;
-- USING (true) for every role, including anon.
DROP POLICY IF EXISTS account_usage_events_admin ON account_usage_events;

-- Self sign-ups must never pick their own role. Staff accounts are created by the API
-- (Settings → Users / scripts), which upserts the real role and activates the profile.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  uname text;
BEGIN
  uname := lower(COALESCE(
    NEW.raw_user_meta_data->>'username',
    regexp_replace(split_part(NEW.email, '@', 1), '[^a-zA-Z0-9._-]', '', 'g')
  ));
  IF uname IS NULL OR uname = '' THEN
    uname := 'user_' || substr(replace(NEW.id::text, '-', ''), 1, 8);
  END IF;

  INSERT INTO public.profiles (id, email, username, full_name, role, is_active)
  VALUES (
    NEW.id,
    NEW.email,
    uname,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    'reviewer'::public.user_role,
    false
  );
  RETURN NEW;
END;
$function$;
