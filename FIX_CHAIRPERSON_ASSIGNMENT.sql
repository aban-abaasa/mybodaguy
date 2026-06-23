-- ==============================================
-- FIX CHAIRPERSON ASSIGNMENT
-- ==============================================
-- This fixes users who have chairperson role but no committee_members record

BEGIN;

-- Check current state
SELECT 
  'Current State' as check_type,
  u.id,
  u.email,
  u.role_type,
  cm.id as committee_member_id,
  cm.role as chairperson_role,
  cm.region_type,
  cm.is_active
FROM public.mbg_users u
LEFT JOIN public.mbg_committee_members cm ON cm.user_id = u.id
WHERE u.role_type = 'chairperson';

-- If you see users with NULL committee_member_id, they need to be fixed
-- Replace the values below with the actual user's information

-- Example: Fix a specific chairperson
-- Uncomment and modify these lines:

/*
INSERT INTO public.mbg_committee_members (
  user_id,
  role,
  region_type,
  region_id,
  assigned_by,
  is_active,
  appointed_at
)
VALUES (
  'USER_ID_HERE',                    -- The user's ID from mbg_users
  'district_chairperson',             -- Role: district_chairperson, division_chairperson, etc.
  'district',                         -- Region type: district, division, subcounty, parish, stage
  'REGION_ID_HERE',                   -- The actual region ID (from districts, divisions, etc.)
  'DEVELOPER_USER_ID',                -- ID of the developer who assigned them
  TRUE,
  NOW()
)
ON CONFLICT (user_id, region_type, region_id) DO UPDATE
SET 
  is_active = TRUE,
  updated_at = NOW();
*/

-- Also create user profile if it doesn't exist
/*
INSERT INTO public.mbg_user_profiles (user_id, full_name, created_at, updated_at)
SELECT 
  u.id,
  COALESCE(
    au.raw_user_meta_data->>'full_name',
    au.raw_user_meta_data->>'name',
    SPLIT_PART(au.email, '@', 1),
    'User'
  ) as full_name,
  NOW(),
  NOW()
FROM public.mbg_users u
JOIN auth.users au ON au.id = u.id
WHERE u.id = 'USER_ID_HERE'
ON CONFLICT (user_id) DO NOTHING;
*/

COMMIT;

-- Verify the fix
SELECT 
  'After Fix' as check_type,
  u.id,
  u.email,
  u.role_type,
  cm.id as committee_member_id,
  cm.role as chairperson_role,
  cm.region_type,
  cm.is_active
FROM public.mbg_users u
LEFT JOIN public.mbg_committee_members cm ON cm.user_id = u.id
WHERE u.role_type = 'chairperson';
