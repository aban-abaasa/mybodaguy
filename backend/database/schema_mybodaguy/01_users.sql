-- My Boda Guy - Users Table
-- Core user authentication and role type
-- Using mbg_ prefix to avoid conflicts with other apps

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- User types: developer, chairperson, rider, customer
CREATE TYPE mbg_user_role_type AS ENUM ('developer', 'chairperson', 'rider', 'customer');

-- App-level user mirror table (kept in sync with auth.users)
CREATE TABLE IF NOT EXISTS public.mbg_users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  phone TEXT,
  role_type mbg_user_role_type NOT NULL DEFAULT 'customer',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(email)
);

ALTER TABLE public.mbg_users ENABLE ROW LEVEL SECURITY;

-- Users can read their own data
DROP POLICY IF EXISTS mbg_users_read_own ON public.mbg_users;
CREATE POLICY mbg_users_read_own ON public.mbg_users
  FOR SELECT
  USING (auth.uid() = id);

-- Users can insert their own record
DROP POLICY IF EXISTS mbg_users_insert_own ON public.mbg_users;
CREATE POLICY mbg_users_insert_own ON public.mbg_users
  FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Users can update their own data
DROP POLICY IF EXISTS mbg_users_update_own ON public.mbg_users;
CREATE POLICY mbg_users_update_own ON public.mbg_users
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Developers can read all users
DROP POLICY IF EXISTS mbg_users_read_developer ON public.mbg_users;
CREATE POLICY mbg_users_read_developer ON public.mbg_users
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.mbg_users dev
      WHERE dev.id = auth.uid()
        AND dev.role_type = 'developer'
        AND dev.is_active = true
    )
  );

-- Service role has full access
DROP POLICY IF EXISTS mbg_users_service_role ON public.mbg_users;
CREATE POLICY mbg_users_service_role ON public.mbg_users
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS mbg_users_email_idx ON public.mbg_users(email);
CREATE INDEX IF NOT EXISTS mbg_users_phone_idx ON public.mbg_users(phone);
CREATE INDEX IF NOT EXISTS mbg_users_role_type_idx ON public.mbg_users(role_type);

-- Automatically create user record and profile when auth user is created
-- IMPORTANT: All new users start as 'customer' by default (can order rides/deliveries)
-- Only developer (hardcoded email) gets developer role automatically
-- Other roles (rider, chairperson) must be assigned by authorized users
CREATE OR REPLACE FUNCTION public.handle_new_auth_user_mbg()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_role mbg_user_role_type;
BEGIN
  -- Check if this is the hardcoded developer account
  IF NEW.email = 'abanabaasa2@gmail.com' THEN
    user_role := 'developer';
  ELSE
    -- Everyone else starts as customer (can order rides/deliveries immediately)
    user_role := 'customer';
  END IF;

  -- Create user record
  INSERT INTO public.mbg_users (id, email, role_type)
  VALUES (NEW.id, COALESCE(NEW.email, ''), user_role)
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        role_type = user_role,
        updated_at = NOW();

  -- Create user profile with default values
  INSERT INTO public.mbg_user_profiles (user_id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', 'User'))
  ON CONFLICT (user_id) DO NOTHING;

  -- Create customer profile automatically for non-developer users
  IF user_role = 'customer' THEN
    INSERT INTO public.mbg_customers (user_id)
    VALUES (NEW.id)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_mbg ON auth.users;
CREATE TRIGGER on_auth_user_created_mbg
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_auth_user_mbg();

COMMIT;
