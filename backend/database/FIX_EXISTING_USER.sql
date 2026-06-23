-- Fix for existing user (abanabaasa2@gmail.com)
-- Run this if you signed up BEFORE running the main setup SQL

-- Insert your user as developer
INSERT INTO public.mbg_users (id, email, role_type, is_active)
VALUES (
  '01ce59a6-592f-4aea-a00d-3e2abcc30b5a',  -- Your user ID from console
  'abanabaasa2@gmail.com',
  'developer',
  true
)
ON CONFLICT (id) DO UPDATE
  SET role_type = 'developer',
      email = 'abanabaasa2@gmail.com',
      is_active = true,
      updated_at = NOW();

-- Create user profile if not exists
INSERT INTO public.mbg_user_profiles (user_id, full_name)
VALUES (
  '01ce59a6-592f-4aea-a00d-3e2abcc30b5a',
  'ABAN ABAASA'
)
ON CONFLICT (user_id) DO NOTHING;

-- Verify it worked
SELECT id, email, role_type, is_active, created_at 
FROM public.mbg_users 
WHERE email = 'abanabaasa2@gmail.com';
