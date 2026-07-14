-- ============================================================================
-- ADD COUNTRY TO SIGNUP: SignInPage.tsx's sign-up form now asks for country
-- (authService.signUp's 4th arg), stored in auth.users.raw_user_meta_data.
-- sync_user_from_auth (FIX_USER_SELECTION.sql) is the function that turns
-- that auth row into the app-level mbg_users/mbg_user_profiles rows — this
-- re-creates it with one addition: read country from the metadata into
-- mbg_user_profiles.country instead of leaving it on its 'Uganda' default
-- for every single signup regardless of where the user actually is.
--
-- Everything else about the function is unchanged from FIX_USER_SELECTION.sql.
-- ============================================================================

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
    COALESCE(NULLIF(au.raw_user_meta_data->>'country', ''), 'Uganda') as country
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
    SET country = COALESCE(NULLIF(public.mbg_user_profiles.country, 'Uganda'), EXCLUDED.country)
    WHERE public.mbg_user_profiles.country IS NULL OR public.mbg_user_profiles.country = 'Uganda';

  RETURN json_build_object('success', true, 'user_id', auth_user.id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_user_from_auth(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_user_from_auth(UUID) TO service_role;

DO $$
BEGIN
  RAISE NOTICE '✅ sync_user_from_auth now carries country from signup metadata into mbg_user_profiles.country.';
END $$;
