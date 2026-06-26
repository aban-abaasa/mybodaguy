-- Assign yourself as stage chairperson to the existing stage
-- Run this to assign yourself to "Old Taxi Park Stage"

-- ==============================================
-- 1. CHECK CURRENT ASSIGNMENT
-- ==============================================

SELECT 
  'Before Update' AS status,
  cm.id,
  cm.role,
  cm.region_type,
  cm.region_id,
  u.email
FROM public.mbg_committee_members cm
INNER JOIN public.mbg_users u ON u.id = cm.user_id
WHERE cm.user_id = auth.uid();

-- ==============================================
-- 2. ASSIGN TO OLD TAXI PARK STAGE
-- ==============================================

-- Get the stage ID (Old Taxi Park Stage)
DO $$
DECLARE
  stage_id_to_assign UUID := '14a3c508-834f-479e-b1c0-d095c50b8c61';
  current_user_id UUID := auth.uid();
  current_email TEXT;
BEGIN
  -- Get current user email
  SELECT email INTO current_email FROM public.mbg_users WHERE id = current_user_id;
  
  IF current_email IS NULL THEN
    SELECT email INTO current_email FROM auth.users WHERE id = current_user_id;
  END IF;
  
  RAISE NOTICE 'Assigning user % to Old Taxi Park Stage...', current_email;
  
  -- Use the mbg_assign_chairperson function
  PERFORM public.mbg_assign_chairperson(
    target_user_email := current_email,
    target_role := 'stage_chairperson',
    target_region_type := 'stage',
    target_region_id := stage_id_to_assign,
    commission_rate := 5.00,
    notes := 'Auto-assigned to Old Taxi Park Stage for rider management'
  );
  
  RAISE NOTICE '✅ Assignment complete!';
  
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE '❌ Error: %', SQLERRM;
    RAISE NOTICE 'Trying direct insert...';
    
    -- If function fails, try direct insert
    INSERT INTO public.mbg_committee_members (
      user_id,
      role,
      region_type,
      region_id,
      commission_rate,
      notes,
      is_active
    )
    VALUES (
      current_user_id,
      'stage_chairperson',
      'stage',
      stage_id_to_assign,
      5.00,
      'Auto-assigned to Old Taxi Park Stage for rider management',
      true
    )
    ON CONFLICT (user_id, region_type, region_id) 
    DO UPDATE SET
      role = EXCLUDED.role,
      commission_rate = EXCLUDED.commission_rate,
      is_active = true,
      updated_at = NOW();
    
    RAISE NOTICE '✅ Direct assignment complete!';
END $$;

-- ==============================================
-- 3. UPDATE USER ROLE
-- ==============================================

UPDATE public.mbg_users
SET role_type = 'chairperson',
    updated_at = NOW()
WHERE id = auth.uid();

-- ==============================================
-- 4. VERIFY ASSIGNMENT
-- ==============================================

SELECT 
  'After Update' AS status,
  cm.id,
  cm.role,
  cm.region_type,
  cm.region_id,
  s.name AS stage_name,
  CASE 
    WHEN cm.region_id = s.id THEN '✅ VALID'
    ELSE '❌ INVALID'
  END AS validation,
  u.email
FROM public.mbg_committee_members cm
INNER JOIN public.mbg_users u ON u.id = cm.user_id
LEFT JOIN public.mbg_stages s ON s.id = cm.region_id
WHERE cm.user_id = auth.uid();

-- ==============================================
-- 5. TEST ASSIGNMENT FUNCTION
-- ==============================================

-- Test if you can now assign riders
SELECT 
  '=== READY TO ASSIGN RIDERS ===' AS message,
  cm.region_id AS your_stage_id,
  s.name AS stage_name,
  '✅ You can now assign riders to this stage!' AS status
FROM public.mbg_committee_members cm
INNER JOIN public.mbg_stages s ON s.id = cm.region_id
WHERE cm.user_id = auth.uid()
  AND cm.role = 'stage_chairperson'
  AND cm.region_type = 'stage'
  AND cm.is_active = true;
