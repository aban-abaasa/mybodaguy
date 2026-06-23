-- SIMPLE FIX - Run this in Supabase SQL Editor
-- This will manually trigger the user creation for ALL signed-in users

-- First, let's see who's in auth.users but not in mbg_users
SELECT 
  au.id,
  au.email,
  au.created_at,
  CASE WHEN mu.id IS NULL THEN 'MISSING' ELSE 'EXISTS' END as mbg_user_status
FROM auth.users au
LEFT JOIN public.mbg_users mu ON au.id = mu.id
ORDER BY au.created_at DESC;

-- Now let's fix ALL users who are missing from mbg_users
-- This runs the same logic as the trigger
INSERT INTO public.mbg_users (id, email, role_type)
SELECT 
  au.id,
  COALESCE(au.email, ''),
  CASE 
    WHEN au.email = 'abanabaasa2@gmail.com' THEN 'developer'::mbg_user_role_type
    ELSE 'customer'::mbg_user_role_type
  END as role_type
FROM auth.users au
LEFT JOIN public.mbg_users mu ON au.id = mu.id
WHERE mu.id IS NULL  -- Only insert if not exists
ON CONFLICT (id) DO NOTHING;

-- Create user profiles for all users
INSERT INTO public.mbg_user_profiles (user_id, full_name)
SELECT 
  au.id,
  COALESCE(au.raw_user_meta_data->>'full_name', COALESCE(au.raw_user_meta_data->>'name', 'User'))
FROM auth.users au
LEFT JOIN public.mbg_user_profiles up ON au.id = up.user_id
WHERE up.user_id IS NULL  -- Only insert if not exists
ON CONFLICT (user_id) DO NOTHING;

-- Create customer records for non-developer users
INSERT INTO public.mbg_customers (user_id)
SELECT au.id
FROM auth.users au
INNER JOIN public.mbg_users mu ON au.id = mu.id
LEFT JOIN public.mbg_customers c ON au.id = c.user_id
WHERE c.user_id IS NULL  -- Only insert if not exists
AND mu.role_type = 'customer'  -- Only for customers
ON CONFLICT (user_id) DO NOTHING;

-- Final verification - show all users with their roles
SELECT 
  au.email as google_email,
  au.created_at as signed_up_at,
  mu.role_type,
  up.full_name,
  CASE WHEN c.id IS NOT NULL THEN 'YES' ELSE 'NO' END as has_customer_record
FROM auth.users au
LEFT JOIN public.mbg_users mu ON au.id = mu.id
LEFT JOIN public.mbg_user_profiles up ON au.id = up.user_id
LEFT JOIN public.mbg_customers c ON au.id = c.user_id
ORDER BY au.created_at DESC;

-- ✅ SUCCESS MESSAGE
-- After running this, you should see all users listed above with their roles
-- Now go to http://localhost:5173 and press Ctrl+Shift+R to hard refresh
