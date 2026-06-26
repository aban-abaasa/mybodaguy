-- FIX USER RECORD FOR MY BODA GUY
-- Run this ENTIRE script in Supabase SQL Editor

-- Step 1: Get your user info from auth.users
SELECT 
  id,
  email,
  raw_user_meta_data->>'full_name' as full_name
FROM auth.users 
WHERE id = 'ba2f0c4b-3e3b-4c07-96f4-9ec13e3e2a29';

-- Step 2: Create/update user record in mbg_users
INSERT INTO public.mbg_users (id, email, role_type)
SELECT 
  id,
  COALESCE(email, ''),
  CASE 
    WHEN email = 'abanabaasa2@gmail.com' THEN 'developer'::mbg_user_role_type
    ELSE 'customer'::mbg_user_role_type
  END
FROM auth.users 
WHERE id = 'ba2f0c4b-3e3b-4c07-96f4-9ec13e3e2a29'
ON CONFLICT (id) DO UPDATE
SET email = EXCLUDED.email,
    role_type = EXCLUDED.role_type,
    updated_at = NOW();

-- Step 3: Create user profile
INSERT INTO public.mbg_user_profiles (user_id, full_name)
SELECT 
  id,
  COALESCE(raw_user_meta_data->>'full_name', 'User')
FROM auth.users 
WHERE id = 'ba2f0c4b-3e3b-4c07-96f4-9ec13e3e2a29'
ON CONFLICT (user_id) DO NOTHING;

-- Step 4: Create customer record (unless user is developer)
INSERT INTO public.mbg_customers (user_id)
SELECT id
FROM auth.users 
WHERE id = 'ba2f0c4b-3e3b-4c07-96f4-9ec13e3e2a29'
AND email != 'abanabaasa2@gmail.com'
ON CONFLICT (user_id) DO NOTHING;

-- Step 5: Verify everything was created
SELECT 
  au.email as google_email,
  u.id,
  u.email as mbg_email,
  u.role_type,
  u.is_active,
  up.full_name,
  up.id as profile_id,
  c.id as customer_id
FROM auth.users au
LEFT JOIN public.mbg_users u ON au.id = u.id
LEFT JOIN public.mbg_user_profiles up ON u.id = up.user_id
LEFT JOIN public.mbg_customers c ON u.id = c.user_id
WHERE au.id = 'ba2f0c4b-3e3b-4c07-96f4-9ec13e3e2a29';

-- ✅ After running this, go to localhost:5173 and refresh (Ctrl+Shift+R)
