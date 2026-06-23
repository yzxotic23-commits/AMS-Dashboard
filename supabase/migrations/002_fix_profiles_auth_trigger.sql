-- Fix profile auto-create on Supabase Auth signup (RLS blocked trigger insert)

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    COALESCE((NEW.raw_user_meta_data->>'role')::public.user_role, 'operator'::public.user_role)
  );
  RETURN NEW;
END;
$$;

DROP POLICY IF EXISTS profiles_insert_system ON profiles;
CREATE POLICY profiles_insert_system ON profiles FOR INSERT WITH CHECK (true);
