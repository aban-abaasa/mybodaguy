-- ==============================================
-- USER LOOKUP FUNCTION
-- ==============================================
-- Creates a function to fetch all users from auth.users
-- This allows the frontend to see users even before they're synced to mbg_users

BEGIN;

-- Drop existing function if it exists
DROP FUNCTION IF EXISTS public.get_all_auth_users();

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
    au.email,
    au.phone,
    COALESCE(mu.role_type::TEXT, 'customer') as role_type,
    COALESCE(mu.is_active, true) as is_active,
    au.created_at,
    COALESCE(
      up.full_name,
      au.raw_user_meta_data->>'full_name',
      au.raw_user_meta_data->>'name',
      SPLIT_PART(au.email, '@', 1),
      'User'
    ) as full_name,
    (mu.id IS NOT NULL) as has_mbg_user
  FROM auth.users au
  LEFT JOIN public.mbg_users mu ON mu.id = au.id
  LEFT JOIN public.mbg_user_profiles up ON up.user_id = au.id
  ORDER BY au.created_at DESC;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.get_all_auth_users() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_all_auth_users() TO service_role;

COMMIT;
