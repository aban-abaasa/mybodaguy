-- Simple assignment to Old Taxi Park Stage
-- Replace 'YOUR_USER_ID_HERE' with your actual user ID

-- ==============================================
-- STEP 1: Find your user ID
-- ==============================================

-- Run this first to get your user ID:
SELECT 
  id AS your_user_id,
  email,
  role_type
FROM public.mbg_users
WHERE email = 'your-email@example.com'; -- Replace with your actual email

-- Or check auth.users if not in mbg_users:
SELECT 
  id AS your_user_id,
  email
FROM auth.users
WHERE email = 'your-email@example.com'; -- Replace with your actual email

-- ==============================================
-- STEP 2: Assign yourself to the stage
-- ==============================================

-- Replace 'YOUR_USER_ID_HERE' with the ID from step 1
INSERT INTO public.mbg_committee_members (
  user_id,
  role,
  region_type,
  region_id,
  commission_rate,
  is_active
)
VALUES (
  'YOUR_USER_ID_HERE', -- ⚠️ REPLACE THIS with your actual user ID
  'stage_chairperson',
  'stage',
  '14a3c508-834f-479e-b1c0-d095c50b8c61', -- Old Taxi Park Stage
  5.00,
  true
)
ON CONFLICT (user_id, region_type, region_id) 
DO UPDATE SET
  role = EXCLUDED.role,
  commission_rate = EXCLUDED.commission_rate,
  is_active = true,
  updated_at = NOW();

-- ==============================================
-- STEP 3: Update user role
-- ==============================================

-- Replace 'YOUR_USER_ID_HERE' with the same ID
UPDATE public.mbg_users
SET role_type = 'chairperson',
    updated_at = NOW()
WHERE id = 'YOUR_USER_ID_HERE'; -- ⚠️ REPLACE THIS

-- ==============================================
-- STEP 4: Verify assignment
-- ==============================================

-- Replace 'YOUR_USER_ID_HERE' with the same ID
SELECT 
  '✅ Assignment Verification' AS status,
  cm.user_id,
  u.email,
  cm.role,
  cm.region_type,
  cm.region_id,
  s.name AS stage_name,
  CASE 
    WHEN cm.region_id = s.id THEN '✅ VALID - Ready to assign riders!'
    ELSE '❌ INVALID'
  END AS validation
FROM public.mbg_committee_members cm
INNER JOIN public.mbg_users u ON u.id = cm.user_id
LEFT JOIN public.mbg_stages s ON s.id = cm.region_id
WHERE cm.user_id = 'YOUR_USER_ID_HERE'; -- ⚠️ REPLACE THIS
