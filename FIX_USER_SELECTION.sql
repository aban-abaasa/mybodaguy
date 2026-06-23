-- ==============================================
-- FIX USER SELECTION DROPDOWN
-- ==============================================
-- This script creates functions to fetch and sync users from auth.users
-- so they appear in the UI and can be assigned as chairpersons

BEGIN;

-- Drop existing functions if they exist
DROP FUNCTION IF EXISTS public.get_all_auth_users();
DROP FUNCTION IF EXISTS public.sync_user_from_auth(UUID);

-- Create function to fetch all auth users with their profiles
CREATE OR REPLACE FUNCTION public.get_all_auth_users()
RETURNS TABLE (
  id UUID,
  email TEXT,
  phone TEXT,
  role_type TEXT,
  is_active BOOLEAN,
  created_at TIMESTAMPTZ,
  full_name TEXT,
  has_mbg_user BOOLEAN
) 
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    au.id,
    au.email::TEXT,
    au.phone::TEXT,
    COALESCE(mu.role_type::TEXT, 'customer')::TEXT as role_type,
    COALESCE(mu.is_active, true) as is_active,
    au.created_at,
    COALESCE(
      up.full_name,
      au.raw_user_meta_data->>'full_name',
      au.raw_user_meta_data->>'name',
      SPLIT_PART(au.email::TEXT, '@', 1),
      'User'
    )::TEXT as full_name,
    (mu.id IS NOT NULL) as has_mbg_user
  FROM auth.users au
  LEFT JOIN public.mbg_users mu ON mu.id = au.id
  LEFT JOIN public.mbg_user_profiles up ON up.user_id = au.id
  ORDER BY au.created_at DESC;
END;
$$;

-- Create function to sync a user from auth.users to mbg_users
CREATE OR REPLACE FUNCTION public.sync_user_from_auth(target_user_id UUID)
RETURNS JSON
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  auth_user RECORD;
  result JSON;
BEGIN
  -- Get user from auth.users
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
    ) as full_name
  INTO auth_user
  FROM auth.users au
  WHERE au.id = target_user_id;

  -- Check if user exists in auth
  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'error', 'User not found in auth.users'
    );
  END IF;

  -- Insert into mbg_users if not exists
  INSERT INTO public.mbg_users (id, email, phone, role_type, is_active, created_at, updated_at)
  VALUES (
    auth_user.id,
    COALESCE(auth_user.email, ''),
    auth_user.phone,
    'customer',
    true,
    auth_user.created_at,
    NOW()
  )
  ON CONFLICT (id) DO NOTHING;

  -- Insert into mbg_user_profiles if not exists
  INSERT INTO public.mbg_user_profiles (user_id, full_name, created_at, updated_at)
  VALUES (
    auth_user.id,
    auth_user.full_name,
    NOW(),
    NOW()
  )
  ON CONFLICT (user_id) DO NOTHING;

  RETURN json_build_object(
    'success', true,
    'user_id', auth_user.id
  );
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.get_all_auth_users() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_all_auth_users() TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_user_from_auth(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_user_from_auth(UUID) TO service_role;

COMMIT;

-- Test the functions
SELECT * FROM public.get_all_auth_users();

