-- UNIVERSAL FIX - Fixes ALL users at once
-- Run this ONCE in Supabase SQL Editor

-- Step 1: Check which users are missing from mbg_users
SELECT 
  'BEFORE FIX:' as status,
  COUNT(*) as total_auth_users,
  COUNT(mu.id) as users_in_mbg_users,
  COUNT(*) - COUNT(mu.id) as missing_users
FROM auth.users au
LEFT JOIN public.mbg_users mu ON au.id = mu.id;

-- Step 2: Fix ALL users (insert missing ones)
INSERT INTO public.mbg_users (id, email, role_type)
SELECT 
  au.id,
  COALESCE(au.email, ''),
  CASE 
    WHEN au.email = 'abanabaasa2@gmail.com' THEN 'developer'::mbg_user_role_type
    ELSE 'customer'::mbg_user_role_type
  END as role_type
FROM auth.users au
WHERE NOT EXISTS (
  SELECT 1 FROM public.mbg_users mu WHERE mu.id = au.id
);

-- Step 3: Create user profiles for ALL users
INSERT INTO public.mbg_user_profiles (user_id, full_name)
SELECT 
  au.id,
  COALESCE(
    au.raw_user_meta_data->>'full_name',
    au.raw_user_meta_data->>'name',
    'User'
  ) as full_name
FROM auth.users au
WHERE NOT EXISTS (
  SELECT 1 FROM public.mbg_user_profiles up WHERE up.user_id = au.id
);

-- Step 4: Create customer records for ALL non-developer users
INSERT INTO public.mbg_customers (user_id)
SELECT mu.id
FROM public.mbg_users mu
WHERE mu.role_type = 'customer'
AND NOT EXISTS (
  SELECT 1 FROM public.mbg_customers c WHERE c.user_id = mu.id
);

-- Step 5: Verify - Show ALL users with complete info
SELECT 
  au.id,
  au.email,
  mu.role_type,
  up.full_name,
  CASE WHEN c.id IS NOT NULL THEN '✅ YES' ELSE '❌ NO' END as customer_record,
  au.created_at
FROM auth.users au
LEFT JOIN public.mbg_users mu ON au.id = mu.id
LEFT JOIN public.mbg_user_profiles up ON au.id = up.user_id
LEFT JOIN public.mbg_customers c ON au.id = c.user_id
ORDER BY au.created_at DESC;

-- Step 6: Check the trigger exists and is working
SELECT 
  trigger_name,
  event_manipulation,
  event_object_table,
  action_statement
FROM information_schema.triggers
WHERE trigger_name = 'on_auth_user_created_mbg';

-- ========================================
-- ✅ AFTER RUNNING THIS:
-- 1. Check the results above
-- 2. All users should have role_type and customer_record
-- 3. Go to localhost:5173
-- 4. Press Ctrl+Shift+R (hard refresh)
-- 5. You should see your dashboard!
-- ========================================
