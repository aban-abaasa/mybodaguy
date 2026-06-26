-- ==============================================
-- DIAGNOSE ASSIGNMENT ISSUE
-- ==============================================
-- Run this to check why assignments are failing

-- Check 1: Does the mbg_assign_chairperson function exist?
SELECT 
  routine_name,
  routine_type,
  data_type as return_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name = 'mbg_assign_chairperson';

-- Check 2: What are the function parameters?
SELECT 
  parameter_name,
  data_type,
  parameter_mode
FROM information_schema.parameters
WHERE specific_schema = 'public'
  AND specific_name LIKE '%mbg_assign_chairperson%'
ORDER BY ordinal_position;

-- Check 3: Does the mbg_committee_members table exist?
SELECT 
  table_name,
  table_type
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('mbg_committee_members', 'committee_members');

-- Check 4: What columns exist in the table?
SELECT 
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'mbg_committee_members'
ORDER BY ordinal_position;

-- Check 5: Do the enum types exist?
SELECT 
  typname,
  typtype
FROM pg_type
WHERE typname IN ('mbg_region_type', 'mbg_chairperson_role', 'region_type', 'chairperson_role');

-- Check 6: What RLS policies exist on the table?
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd
FROM pg_policies
WHERE tablename = 'mbg_committee_members'
ORDER BY policyname;

-- Check 7: Try to see if there are any committee members already
SELECT 
  id,
  user_id,
  role,
  region_type,
  region_id,
  assigned_by,
  is_active,
  appointed_at
FROM public.mbg_committee_members
LIMIT 5;

-- Check 8: Check current user's auth info
SELECT 
  auth.uid() as current_user_id,
  auth.role() as current_role;

-- Check 9: Check if current user exists in mbg_users
SELECT 
  id,
  email,
  role_type,
  is_active
FROM public.mbg_users
WHERE id = auth.uid();

-- Check 10: Try a simple test insert (will fail if RLS is blocking)
-- DO NOT RUN THIS IN PRODUCTION WITHOUT UNDERSTANDING IT FIRST
-- This is just to test if basic inserts work
/*
INSERT INTO public.mbg_committee_members (
  user_id,
  role,
  region_type,
  region_id,
  assigned_by,
  is_active
) VALUES (
  auth.uid(),
  'stage_chairperson',
  'stage',
  '00000000-0000-0000-0000-000000000000',
  auth.uid(),
  true
) RETURNING id;
*/

SELECT '=== Diagnosis Complete ===' as status;
SELECT 'Review the results above to identify the issue' as instruction;
