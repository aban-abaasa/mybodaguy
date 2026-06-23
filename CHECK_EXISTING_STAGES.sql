-- Diagnostic: Check what stages and regions exist in the database
-- Run this to see current state before fixing

-- ==============================================
-- 1. CHECK WHAT TABLES EXIST
-- ==============================================

SELECT 
  table_name,
  CASE 
    WHEN table_name LIKE 'mbg_%' THEN '✅ MyBodaGuy table'
    ELSE '⚠️ Other app table'
  END AS table_type
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'mbg_stages', 'stages',
    'mbg_parishes', 'parishes',
    'mbg_subcounties', 'subcounties',
    'mbg_divisions', 'divisions',
    'mbg_districts', 'districts'
  )
ORDER BY table_name;

-- ==============================================
-- 2. CHECK STAGES (both mbg_ and non-prefixed)
-- ==============================================

-- Check mbg_stages
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'mbg_stages') THEN
    RAISE NOTICE '=== mbg_stages table ===';
    RAISE NOTICE 'Checking mbg_stages...';
  END IF;
END $$;

SELECT 
  'mbg_stages' AS table_name,
  id,
  name,
  parish_id,
  is_active,
  created_at
FROM public.mbg_stages
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'mbg_stages')
ORDER BY name;

-- Check stages (non-prefixed)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'stages') THEN
    RAISE NOTICE '';
    RAISE NOTICE '=== stages table (non-prefixed) ===';
    RAISE NOTICE 'Checking stages...';
  END IF;
END $$;

SELECT 
  'stages' AS table_name,
  id,
  name,
  parish_id,
  is_active,
  created_at
FROM public.stages
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'stages')
ORDER BY name;

-- ==============================================
-- 3. CHECK YOUR CHAIRPERSON ASSIGNMENT
-- ==============================================

SELECT 
  '=== YOUR COMMITTEE ASSIGNMENT ===' AS section,
  cm.id AS committee_member_id,
  cm.user_id,
  cm.role,
  cm.region_type,
  cm.region_id AS assigned_region_id,
  cm.is_active,
  u.email
FROM public.mbg_committee_members cm
INNER JOIN public.mbg_users u ON u.id = cm.user_id
WHERE cm.user_id = auth.uid()
ORDER BY cm.created_at DESC;

-- ==============================================
-- 4. CHECK IF YOUR REGION_ID EXISTS IN STAGES
-- ==============================================

-- Check mbg_stages
SELECT 
  '=== STAGE VALIDATION (mbg_stages) ===' AS section,
  cm.region_id AS your_region_id,
  s.id AS stage_id_in_table,
  s.name AS stage_name,
  CASE 
    WHEN s.id IS NOT NULL THEN '✅ VALID - Stage exists'
    ELSE '❌ INVALID - Stage does not exist in mbg_stages'
  END AS validation_status
FROM public.mbg_committee_members cm
LEFT JOIN public.mbg_stages s ON s.id = cm.region_id
WHERE cm.user_id = auth.uid()
  AND cm.region_type = 'stage';

-- Check stages (non-prefixed)
SELECT 
  '=== STAGE VALIDATION (stages) ===' AS section,
  cm.region_id AS your_region_id,
  s.id AS stage_id_in_table,
  s.name AS stage_name,
  CASE 
    WHEN s.id IS NOT NULL THEN '✅ VALID - Stage exists in non-prefixed table'
    ELSE '❌ INVALID - Stage does not exist in stages table'
  END AS validation_status
FROM public.mbg_committee_members cm
LEFT JOIN public.stages s ON s.id = cm.region_id
WHERE cm.user_id = auth.uid()
  AND cm.region_type = 'stage'
  AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'stages');

-- ==============================================
-- 5. COUNT RECORDS
-- ==============================================

DO $$
DECLARE
  mbg_stage_count INTEGER := 0;
  stage_count INTEGER := 0;
  mbg_parish_count INTEGER := 0;
  parish_count INTEGER := 0;
BEGIN
  -- Count mbg_stages
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'mbg_stages') THEN
    SELECT COUNT(*) INTO mbg_stage_count FROM public.mbg_stages;
  END IF;
  
  -- Count stages
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'stages') THEN
    SELECT COUNT(*) INTO stage_count FROM public.stages;
  END IF;
  
  -- Count mbg_parishes
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'mbg_parishes') THEN
    SELECT COUNT(*) INTO mbg_parish_count FROM public.mbg_parishes;
  END IF;
  
  -- Count parishes
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'parishes') THEN
    SELECT COUNT(*) INTO parish_count FROM public.parishes;
  END IF;
  
  RAISE NOTICE '';
  RAISE NOTICE '=== RECORD COUNTS ===';
  RAISE NOTICE 'mbg_stages: % records', mbg_stage_count;
  RAISE NOTICE 'stages (non-prefixed): % records', stage_count;
  RAISE NOTICE 'mbg_parishes: % records', mbg_parish_count;
  RAISE NOTICE 'parishes (non-prefixed): % records', parish_count;
  RAISE NOTICE '';
  
  IF mbg_stage_count = 0 AND stage_count > 0 THEN
    RAISE NOTICE '⚠️ ISSUE FOUND: You have stages in the non-prefixed table but mbg_stages is empty!';
    RAISE NOTICE 'Solution: Need to copy data from stages to mbg_stages OR update foreign key to reference stages table';
  ELSIF mbg_stage_count = 0 AND stage_count = 0 THEN
    RAISE NOTICE '⚠️ ISSUE FOUND: No stages exist in any table!';
    RAISE NOTICE 'Solution: Need to create stages first';
  ELSE
    RAISE NOTICE '✅ Tables populated';
  END IF;
END $$;

-- ==============================================
-- 6. SHOW FULL HIERARCHY
-- ==============================================

-- If using mbg_ prefixed tables
SELECT 
  '=== FULL HIERARCHY (mbg_ tables) ===' AS section,
  dist.name AS district,
  div.name AS division,
  sc.name AS subcounty,
  p.name AS parish,
  s.name AS stage,
  s.id AS stage_id
FROM public.mbg_stages s
LEFT JOIN public.mbg_parishes p ON p.id = s.parish_id
LEFT JOIN public.mbg_subcounties sc ON sc.id = p.subcounty_id
LEFT JOIN public.mbg_divisions div ON div.id = sc.division_id
LEFT JOIN public.mbg_districts dist ON dist.id = div.district_id
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'mbg_stages')
ORDER BY dist.name, div.name, sc.name, p.name, s.name;

-- If using non-prefixed tables
SELECT 
  '=== FULL HIERARCHY (non-prefixed tables) ===' AS section,
  dist.name AS district,
  div.name AS division,
  sc.name AS subcounty,
  p.name AS parish,
  s.name AS stage,
  s.id AS stage_id
FROM public.stages s
LEFT JOIN public.parishes p ON p.id = s.parish_id
LEFT JOIN public.subcounties sc ON sc.id = p.subcounty_id
LEFT JOIN public.divisions div ON div.id = sc.division_id
LEFT JOIN public.districts dist ON dist.id = div.district_id
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'stages')
ORDER BY dist.name, div.name, sc.name, p.name, s.name;
