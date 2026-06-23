-- FIX USER RECORD FOR MY BODA GUY
-- Run this in Supabase SQL Editor if you're stuck on loading screen

-- Your user ID from the logs
-- ba2f0c4b-3e3b-4c07-96f4-9ec13e3e2a29

-- First, check if user exists
SELECT * FROM auth.users WHERE id = 'ba2f0c4b-3e3b-4c07-96f4-9ec13e3e2a29';

-- Check if mbg_users record exists
SELECT * FROM public.mbg_users WHERE id = 'ba2f0c4b-3e3b-4c07-96f4-9ec13e3e2a29';

-- If no record in mbg_users, manually create it
-- Replace 'your-email@gmail.com' with your actual email
INSERT INTO public.mbg_users (id, email, role_type)
VALUES (
  'ba2f0c4b-3e3b-4c07-96f4-9ec13e3e2a29',
  'your-email@gmail.com',  -- REPLACE THIS with your actual Google email
  'customer'
)
ON CONFLICT (id) DO UPDATE
SET role_type = 'customer',
    updated_at = NOW();

-- Create user profile
INSERT INTO public.mbg_user_profiles (user_id, full_name)
VALUES (
  'ba2f0c4b-3e3b-4c07-96f4-9ec13e3e2a29',
  'User'  -- You can change this to your name
)
ON CONFLICT (user_id) DO NOTHING;

-- Create customer record
INSERT INTO public.mbg_customers (user_id)
VALUES ('ba2f0c4b-3e3b-4c07-96f4-9ec13e3e2a29')
ON CONFLICT (user_id) DO NOTHING;

-- Verify everything was created
SELECT 
  u.id,
  u.email,
  u.role_type,
  up.full_name,
  c.id as customer_id
FROM public.mbg_users u
LEFT JOIN public.mbg_user_profiles up ON u.id = up.user_id
LEFT JOIN public.mbg_customers c ON u.id = c.user_id
WHERE u.id = 'ba2f0c4b-3e3b-4c07-96f4-9ec13e3e2a29';

-- After running this, refresh your browser!
