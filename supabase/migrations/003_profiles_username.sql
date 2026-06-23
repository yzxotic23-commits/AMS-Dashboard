-- Username login — profiles.username (unique, case-insensitive via app lower())

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS username TEXT;

UPDATE profiles
SET username = lower(regexp_replace(split_part(email, '@', 1), '[^a-zA-Z0-9._-]', '', 'g'))
WHERE username IS NULL OR username = '';

UPDATE profiles SET username = 'user_' || substr(replace(id::text, '-', ''), 1, 8)
WHERE username IS NULL OR username = '';

ALTER TABLE profiles ALTER COLUMN username SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_username_lower ON profiles (lower(username));

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  INSERT INTO public.profiles (id, email, username, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    uname,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    COALESCE((NEW.raw_user_meta_data->>'role')::public.user_role, 'operator'::public.user_role)
  );
  RETURN NEW;
END;
$$;
