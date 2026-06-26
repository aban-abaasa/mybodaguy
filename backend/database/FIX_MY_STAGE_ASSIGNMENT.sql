-- Fix stage chairperson region_id to match an actual existing stage
-- This ensures the hierarchy works automatically

-- ==============================================
-- 1. SHOW THE PROBLEM
-- ==============================================

SELECT 
  '=== CURRENT PROBLEM ===' AS section,
  cm.id,
  cm.user_id,
  u.email,
  cm.role,
  cm.region_type,
  cm.region_id AS current_region_id,
  s.id AS actual_stage_id,
  s.name AS stage_name,
  CASE 
    WHEN s.id IS NULL THEN '❌ BAD: region_id does not match any stage'
    WHEN cm.region_id = s.id THEN '✅ GOOD: region_id matches stage'
    ELSE '⚠️ MISMATCH'
  END AS status
FROM public.mbg_committee_members cm
INNER JOIN public.mbg_users u ON u.id = cm.user_id
LEFT JOIN public.mbg_stages s ON s.id = cm.region_id
WHERE cm.role = 'stage_chairperson'
  AND cm.region_type = 'stage'
  AND cm.is_active = true
ORDER BY u.email;

-- ==============================================
-- 2. SHOW AVAILABLE STAGES
-- ==============================================

SELECT 
  '=== AVAILABLE STAGES ===' AS section,
  s.id AS stage_id,
  s.name AS stage_name,
  p.name AS parish_name,
  sc.name AS subcounty_name,
  div.name AS division_name,
  dist.name AS district_name
FROM public.mbg_stages s
LEFT JOIN public.mbg_parishes p ON p.id = s.parish_id
LEFT JOIN public.mbg_subcounties sc ON sc.id = p.subcounty_id
LEFT JOIN public.mbg_divisions div ON div.id = sc.division_id
LEFT JOIN public.mbg_districts dist ON dist.id = div.district_id
ORDER BY s.name;

-- ==============================================
-- 3. FIX ALL STAGE CHAIRPERSONS
-- ==============================================

-- Update all stage chairpersons to use the first available stage
-- (You can modify this to assign specific stages to specific users)

UPDATE public.mbg_committee_members
SET region_id = (
  SELECT id FROM public.mbg_stages 
  WHERE is_active = true 
  ORDER BY created_at 
  LIMIT 1
),
updated_at = NOW()
WHERE role = 'stage_chairperson'
  AND region_type = 'stage'
  AND is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM public.mbg_stages s 
    WHERE s.id = mbg_committee_members.region_id
  );

-- ==============================================
-- 4. VERIFY FIX
-- ==============================================

SELECT 
  '=== AFTER FIX ===' AS section,
  cm.id,
  u.email,
  cm.role,
  cm.region_id,
  s.name AS stage_name,
  CASE 
    WHEN s.id IS NOT NULL THEN '✅ FIXED: Can now assign riders!'
    ELSE '❌ STILL BROKEN: Stage not found'
  END AS status
FROM public.mbg_committee_members cm
INNER JOIN public.mbg_users u ON u.id = cm.user_id
LEFT JOIN public.mbg_stages s ON s.id = cm.region_id
WHERE cm.role = 'stage_chairperson'
  AND cm.region_type = 'stage'
  AND cm.is_active = true
ORDER BY u.email;

-- ==============================================
-- 5. TEST RIDER ASSIGNMENT
-- ==============================================

-- Show what stage_id will be used for rider assignment
SELECT 
  '=== READY FOR RIDER ASSIGNMENT ===' AS section,
  cm.user_id,
  u.email AS chairperson_email,
  cm.region_id AS stage_id_for_riders,
  s.name AS stage_name,
  '✅ This stage_id will be used when assigning riders' AS note
FROM public.mbg_committee_members cm
INNER JOIN public.mbg_users u ON u.id = cm.user_id
INNER JOIN public.mbg_stages s ON s.id = cm.region_id
WHERE cm.role = 'stage_chairperson'
  AND cm.region_type = 'stage'
  AND cm.is_active = true
ORDER BY u.email;
