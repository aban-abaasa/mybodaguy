-- ==============================================
-- COMPLETE CHAIRPERSON SETUP
-- ==============================================
-- Run this to complete the assignment for users with chairperson role

BEGIN;

-- Step 0: Add commission_rate column if it doesn't exist
ALTER TABLE public.mbg_committee_members 
ADD COLUMN IF NOT EXISTS commission_rate DECIMAL(5,2) DEFAULT 5.00 CHECK (commission_rate >= 0 AND commission_rate <= 100);

-- Step 1: Check which users need fixing
SELECT 
  'Users needing fix' as status,
  u.id,
  u.email,
  u.role_type
FROM public.mbg_users u
WHERE u.role_type = 'chairperson'
  AND NOT EXISTS (
    SELECT 1 FROM public.mbg_committee_members cm 
    WHERE cm.user_id = u.id
  );

-- Step 2: Get available regions
SELECT 'Available Districts' as info, id, name FROM public.mbg_districts WHERE is_active = true LIMIT 5;

-- Step 3: Complete the assignment for ALL chairpersons missing committee records
-- This assigns them to the first available district
INSERT INTO public.mbg_committee_members (
  user_id,
  role,
  region_type,
  region_id,
  assigned_by,
  is_active,
  appointed_at,
  commission_rate
)
SELECT 
  u.id as user_id,
  'district_chairperson'::mbg_chairperson_role as role,
  'district'::mbg_region_type as region_type,
  (SELECT id FROM public.mbg_districts WHERE is_active = true ORDER BY name LIMIT 1) as region_id,
  (SELECT id FROM public.mbg_users WHERE role_type = 'developer' LIMIT 1) as assigned_by,
  TRUE as is_active,
  NOW() as appointed_at,
  5.00 as commission_rate
FROM public.mbg_users u
WHERE u.role_type = 'chairperson'
  AND NOT EXISTS (
    SELECT 1 FROM public.mbg_committee_members cm 
    WHERE cm.user_id = u.id
  )
ON CONFLICT (user_id, region_type, region_id) DO UPDATE
SET 
  is_active = TRUE,
  updated_at = NOW();

-- Step 4: Ensure user profiles exist
INSERT INTO public.mbg_user_profiles (user_id, full_name, created_at, updated_at)
SELECT 
  u.id,
  COALESCE(
    (SELECT raw_user_meta_data->>'full_name' FROM auth.users WHERE id = u.id),
    (SELECT raw_user_meta_data->>'name' FROM auth.users WHERE id = u.id),
    SPLIT_PART(u.email, '@', 1),
    'Chairperson'
  ) as full_name,
  NOW(),
  NOW()
FROM public.mbg_users u
WHERE u.role_type = 'chairperson'
  AND NOT EXISTS (
    SELECT 1 FROM public.mbg_user_profiles up 
    WHERE up.user_id = u.id
  )
ON CONFLICT (user_id) DO NOTHING;

COMMIT;

-- Step 5: Verify the fix
SELECT 
  'Verification - All Chairpersons' as status,
  u.email,
  u.role_type,
  cm.role as chairperson_role,
  cm.region_type,
  d.name as region_name,
  cm.commission_rate,
  cm.is_active,
  CASE WHEN up.id IS NOT NULL THEN 'Yes' ELSE 'No' END as has_profile
FROM public.mbg_users u
LEFT JOIN public.mbg_committee_members cm ON cm.user_id = u.id
LEFT JOIN public.mbg_districts d ON d.id = cm.region_id AND cm.region_type = 'district'
LEFT JOIN public.mbg_user_profiles up ON up.user_id = u.id
WHERE u.role_type = 'chairperson'
ORDER BY u.email;
