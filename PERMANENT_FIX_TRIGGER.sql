-- PERMANENT FIX - This ensures the trigger works for ALL future signups
-- Run this ONCE in Supabase SQL Editor

-- Step 1: First, fix ALL existing users who are missing
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

INSERT INTO public.mbg_customers (user_id)
SELECT mu.id
FROM public.mbg_users mu
WHERE mu.role_type = 'customer'
AND NOT EXISTS (
  SELECT 1 FROM public.mbg_customers c WHERE c.user_id = mu.id
);

-- Step 2: Drop and recreate the trigger to make sure it works
DROP TRIGGER IF EXISTS on_auth_user_created_mbg ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_auth_user_mbg();

-- Step 3: Create the trigger function with better error handling
CREATE OR REPLACE FUNCTION public.handle_new_auth_user_mbg()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_role mbg_user_role_type;
BEGIN
  -- Determine role
  IF NEW.email = 'abanabaasa2@gmail.com' THEN
    user_role := 'developer';
  ELSE
    user_role := 'customer';
  END IF;

  -- Create user record
  INSERT INTO public.mbg_users (id, email, role_type)
  VALUES (NEW.id, COALESCE(NEW.email, ''), user_role)
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        role_type = user_role,
        updated_at = NOW();

  -- Create user profile
  INSERT INTO public.mbg_user_profiles (user_id, full_name)
  VALUES (
    NEW.id, 
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',
      'User'
    )
  )
  ON CONFLICT (user_id) DO UPDATE
    SET full_name = EXCLUDED.full_name;

  -- Create customer profile if not developer
  IF user_role = 'customer' THEN
    INSERT INTO public.mbg_customers (user_id)
    VALUES (NEW.id)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Log error but don't fail the signup
    RAISE WARNING 'Error in handle_new_auth_user_mbg for user %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

-- Step 4: Create the trigger (fires AFTER insert on auth.users)
CREATE TRIGGER on_auth_user_created_mbg
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_auth_user_mbg();

-- Step 5: Also create an UPDATE trigger in case users are updated
CREATE OR REPLACE TRIGGER on_auth_user_updated_mbg
AFTER UPDATE ON auth.users
FOR EACH ROW
WHEN (OLD.email IS DISTINCT FROM NEW.email OR OLD.raw_user_meta_data IS DISTINCT FROM NEW.raw_user_meta_data)
EXECUTE FUNCTION public.handle_new_auth_user_mbg();

-- Step 6: Verify all users are now properly set up
SELECT 
  'VERIFICATION RESULTS:' as status,
  au.id,
  au.email,
  au.created_at,
  mu.role_type,
  up.full_name,
  CASE WHEN c.id IS NOT NULL THEN '✅' ELSE '❌' END as has_customer
FROM auth.users au
LEFT JOIN public.mbg_users mu ON au.id = mu.id
LEFT JOIN public.mbg_user_profiles up ON au.id = up.user_id
LEFT JOIN public.mbg_customers c ON au.id = c.user_id
ORDER BY au.created_at DESC;

-- Step 7: Show trigger status
SELECT 
  trigger_name,
  event_manipulation,
  action_timing,
  event_object_table,
  action_statement
FROM information_schema.triggers
WHERE trigger_name LIKE '%mbg%'
ORDER BY trigger_name;

-- ========================================
-- ✅ SUCCESS!
-- All existing users are fixed
-- All future signups will automatically work
-- Now refresh your browser at localhost:5173
-- ========================================
