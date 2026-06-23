-- ==============================================
-- SYNC EXISTING AUTH.USERS TO MBG_USERS
-- ==============================================
-- Run this in Supabase SQL Editor to import existing users

BEGIN;

-- Insert all existing auth.users into mbg_users if they don't already exist
INSERT INTO public.mbg_users (id, email, phone, role_type, is_active, created_at, updated_at)
SELECT 
  au.id,
  COALESCE(au.email, ''),
  au.phone,
  CASE 
    -- Your developer email gets developer role
    WHEN au.email = 'abanabaasa2@gmail.com' THEN 'developer'::mbg_user_role_type
    -- Everyone else starts as customer
    ELSE 'customer'::mbg_user_role_type
  END as role_type,
  true as is_active,
  au.created_at,
  NOW() as updated_at
FROM auth.users au
WHERE NOT EXISTS (
  SELECT 1 FROM public.mbg_users mu WHERE mu.id = au.id
);

-- Create user profiles for users who don't have one
INSERT INTO public.mbg_user_profiles (user_id, full_name, created_at, updated_at)
SELECT 
  au.id,
  COALESCE(
    au.raw_user_meta_data->>'full_name',
    au.raw_user_meta_data->>'name',
    SPLIT_PART(au.email, '@', 1),
    'User'
  ) as full_name,
  NOW() as created_at,
  NOW() as updated_at
FROM auth.users au
WHERE NOT EXISTS (
  SELECT 1 FROM public.mbg_user_profiles up WHERE up.user_id = au.id
);

-- Create customer profiles for all customer-role users who don't have one
INSERT INTO public.mbg_customers (user_id, created_at, updated_at)
SELECT 
  mu.id,
  NOW() as created_at,
  NOW() as updated_at
FROM public.mbg_users mu
WHERE mu.role_type = 'customer'
  AND NOT EXISTS (
    SELECT 1 FROM public.mbg_customers mc WHERE mc.user_id = mu.id
  );

COMMIT;

-- Show results
SELECT 
  mu.id,
  mu.email,
  mu.role_type,
  up.full_name,
  mu.created_at
FROM public.mbg_users mu
LEFT JOIN public.mbg_user_profiles up ON up.user_id = mu.id
ORDER BY mu.created_at DESC;
