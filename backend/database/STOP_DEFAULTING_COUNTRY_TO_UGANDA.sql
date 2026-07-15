-- ============================================================================
-- STOP DEFAULTING COUNTRY TO UGANDA ON SIGNUP
--
-- mbg_user_profiles.country has had `DEFAULT 'Uganda'` since
-- COMPLETE_MYBODAGUY_SETUP.sql, and both the auth.users insert trigger
-- (handle_new_auth_user_mbg) and the sync_user_from_auth() fallback either
-- omit country entirely or explicitly COALESCE it to 'Uganda'. That means
-- the column is never empty for a brand-new user, even one who signed up
-- with Google OAuth (which never collects a country at all) — so the
-- frontend's CountryGate ("prompt for country if it's missing") can never
-- fire. Google users were silently being assigned Uganda instead of asked.
--
-- This drops the column default and stops both write paths from
-- substituting 'Uganda' for a missing value, so country stays NULL until
-- either the signup form (email/password path) or CountryGate (OAuth path)
-- actually sets it. Existing rows already defaulted to 'Uganda' are left
-- alone — there's no way to tell which of those were a real choice.
--
-- IMPORTANT: handle_new_auth_user_mbg() has TWO versions in this repo —
-- the original single-hardcoded-email one (COMPLETE_MYBODAGUY_SETUP.sql)
-- and a newer allowlist-based one (ADD_DEVELOPER_SELF_SERVICE_ACCESS.sql,
-- checks mbg_developer_emails so bodagoera@gmail.com also gets 'developer').
-- This migration builds on the allowlist version — CREATE OR REPLACE-ing
-- back to the single-email check would silently strip bodagoera@gmail.com's
-- developer access. The table create+seed below is repeated from that file
-- (IF NOT EXISTS / ON CONFLICT DO NOTHING) so this migration doesn't depend
-- on run order against it.
-- ============================================================================

ALTER TABLE public.mbg_user_profiles ALTER COLUMN country DROP DEFAULT;

CREATE TABLE IF NOT EXISTS public.mbg_developer_emails (
  email    TEXT PRIMARY KEY,
  added_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO public.mbg_developer_emails (email) VALUES
  ('abanabaasa2@gmail.com'),
  ('bodagoera@gmail.com')
ON CONFLICT (email) DO NOTHING;

CREATE OR REPLACE FUNCTION public.handle_new_auth_user_mbg()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_role mbg_user_role_type;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.mbg_developer_emails
    WHERE lower(email) = lower(COALESCE(NEW.email, ''))
  ) THEN
    user_role := 'developer';
  ELSE
    user_role := 'customer';
  END IF;

  INSERT INTO public.mbg_users (id, email, role_type)
  VALUES (NEW.id, COALESCE(NEW.email, ''), user_role)
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        role_type = CASE
          WHEN public.mbg_users.role_type = 'developer' THEN 'developer'
          ELSE EXCLUDED.role_type
        END,
        updated_at = NOW();

  INSERT INTO public.mbg_user_profiles (user_id, full_name, country)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'User'),
    NULLIF(NEW.raw_user_meta_data->>'country', '')
  )
  ON CONFLICT (user_id) DO NOTHING;

  IF user_role = 'customer' THEN
    INSERT INTO public.mbg_customers (user_id)
    VALUES (NEW.id)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_user_from_auth(target_user_id UUID)
RETURNS JSON
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  auth_user RECORD;
BEGIN
  SELECT
    au.id,
    au.email,
    au.phone,
    au.created_at,
    COALESCE(
      au.raw_user_meta_data->>'full_name',
      au.raw_user_meta_data->>'name',
      SPLIT_PART(au.email, '@', 1),
      'User'
    ) as full_name,
    NULLIF(au.raw_user_meta_data->>'country', '') as country
  INTO auth_user
  FROM auth.users au
  WHERE au.id = target_user_id;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'User not found in auth.users');
  END IF;

  INSERT INTO public.mbg_users (id, email, phone, role_type, is_active, created_at, updated_at)
  VALUES (auth_user.id, COALESCE(auth_user.email, ''), auth_user.phone, 'customer', true, auth_user.created_at, NOW())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.mbg_user_profiles (user_id, full_name, country, created_at, updated_at)
  VALUES (auth_user.id, auth_user.full_name, auth_user.country, NOW(), NOW())
  ON CONFLICT (user_id) DO UPDATE
    SET country = COALESCE(public.mbg_user_profiles.country, EXCLUDED.country)
    WHERE public.mbg_user_profiles.country IS NULL;

  RETURN json_build_object('success', true, 'user_id', auth_user.id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_user_from_auth(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_user_from_auth(UUID) TO service_role;

DO $$
BEGIN
  RAISE NOTICE '✅ country no longer defaults to Uganda — CountryGate will now actually prompt OAuth signups that never provided one.';
END $$;
