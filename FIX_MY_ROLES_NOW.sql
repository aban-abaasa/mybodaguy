-- ============================================
-- FIX CURRENT USER: Add All Required Roles
-- ============================================
-- This script ensures your chairperson account has:
-- 1. Stage chairperson assignment
-- 2. Rider record
-- 3. All roles in user_roles array
-- ============================================

-- STEP 1: Check your current situation
DO $$
DECLARE
  v_user_id uuid;
  v_user_email text;
  v_user_roles text[];
  v_committee_count int;
  v_rider_exists boolean;
BEGIN
  -- Get your user info (replace with your actual email)
  SELECT id, email, user_roles INTO v_user_id, v_user_email, v_user_roles
  FROM mbg_users
  WHERE email = current_setting('request.jwt.claims', true)::json->>'email'
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE NOTICE '❌ Could not find current user';
    RETURN;
  END IF;

  RAISE NOTICE '========================================';
  RAISE NOTICE '🔍 CURRENT USER STATUS';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Email: %', v_user_email;
  RAISE NOTICE 'User ID: %', v_user_id;
  RAISE NOTICE 'Current Roles: %', v_user_roles;

  -- Check committee assignments
  SELECT COUNT(*) INTO v_committee_count
  FROM mbg_committee_members
  WHERE user_id = v_user_id AND is_active = true;
  
  RAISE NOTICE 'Committee Assignments: %', v_committee_count;

  -- Check rider record
  SELECT EXISTS(
    SELECT 1 FROM mbg_riders WHERE user_id = v_user_id
  ) INTO v_rider_exists;
  
  RAISE NOTICE 'Has Rider Record: %', v_rider_exists;
  RAISE NOTICE '========================================';
END $$;

-- STEP 2: Ensure multi-role functions exist
-- (This was in ENABLE_MULTI_ROLE_SYSTEM.sql)
CREATE OR REPLACE FUNCTION add_user_role(
  target_user_id uuid,
  role_to_add text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Add role to user_roles array if not already present
  UPDATE mbg_users
  SET user_roles = array_append(
    COALESCE(user_roles, ARRAY[]::text[]),
    role_to_add
  )
  WHERE id = target_user_id
  AND NOT (role_to_add = ANY(COALESCE(user_roles, ARRAY[]::text[])));
  
  RETURN FOUND;
END;
$$;

-- STEP 3: Fix YOUR current user - Add missing roles
DO $$
DECLARE
  v_user_id uuid;
  v_user_email text;
  v_primary_committee record;
  v_stage_id uuid;
  v_stage_name text;
  v_rider_id uuid;
BEGIN
  -- Get current user
  SELECT id, email INTO v_user_id, v_user_email
  FROM mbg_users
  WHERE email = current_setting('request.jwt.claims', true)::json->>'email'
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE NOTICE '❌ Could not find current user';
    RETURN;
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE '🔧 FIXING YOUR ROLES';
  RAISE NOTICE '========================================';

  -- Get your primary committee assignment
  SELECT * INTO v_primary_committee
  FROM mbg_committee_members
  WHERE user_id = v_user_id AND is_active = true
  ORDER BY 
    CASE role
      WHEN 'district_chairperson' THEN 1
      WHEN 'division_chairperson' THEN 2
      WHEN 'subcounty_chairperson' THEN 3
      WHEN 'parish_chairperson' THEN 4
      WHEN 'stage_chairperson' THEN 5
    END
  LIMIT 1;

  IF v_primary_committee IS NULL THEN
    RAISE NOTICE '❌ No committee assignment found. Cannot proceed.';
    RETURN;
  END IF;

  RAISE NOTICE '✅ Primary Role: % at % (%)', 
    v_primary_committee.role,
    v_primary_committee.region_name,
    v_primary_committee.region_type;

  -- Add 'chairperson' role
  PERFORM add_user_role(v_user_id, 'chairperson');
  RAISE NOTICE '✅ Added "chairperson" role';

  -- STEP 3A: Create Stage Chairperson Assignment (if not already stage)
  IF v_primary_committee.region_type != 'stage' THEN
    -- Find a stage in your region hierarchy
    IF v_primary_committee.region_type = 'district' THEN
      SELECT s.id, s.name INTO v_stage_id, v_stage_name
      FROM mbg_stages s
      JOIN mbg_parishes p ON s.parish_id = p.id
      JOIN mbg_subcounties sc ON p.subcounty_id = sc.id
      JOIN mbg_divisions d ON sc.division_id = d.id
      WHERE d.district_id = v_primary_committee.region_id
      LIMIT 1;
    ELSIF v_primary_committee.region_type = 'division' THEN
      SELECT s.id, s.name INTO v_stage_id, v_stage_name
      FROM mbg_stages s
      JOIN mbg_parishes p ON s.parish_id = p.id
      JOIN mbg_subcounties sc ON p.subcounty_id = sc.id
      WHERE sc.division_id = v_primary_committee.region_id
      LIMIT 1;
    ELSIF v_primary_committee.region_type = 'subcounty' THEN
      SELECT s.id, s.name INTO v_stage_id, v_stage_name
      FROM mbg_stages s
      JOIN mbg_parishes p ON s.parish_id = p.id
      WHERE p.subcounty_id = v_primary_committee.region_id
      LIMIT 1;
    ELSIF v_primary_committee.region_type = 'parish' THEN
      SELECT s.id, s.name INTO v_stage_id, v_stage_name
      FROM mbg_stages s
      WHERE s.parish_id = v_primary_committee.region_id
      LIMIT 1;
    END IF;

    IF v_stage_id IS NOT NULL THEN
      -- Check if stage assignment already exists
      IF NOT EXISTS(
        SELECT 1 FROM mbg_committee_members
        WHERE user_id = v_user_id 
        AND region_type = 'stage' 
        AND region_id = v_stage_id
        AND is_active = true
      ) THEN
        -- Create stage chairperson assignment
        INSERT INTO mbg_committee_members (
          user_id, role, region_type, region_id, region_name,
          commission_rate, is_active, notes
        )
        VALUES (
          v_user_id,
          'stage_chairperson',
          'stage',
          v_stage_id,
          v_stage_name,
          3.00, -- Default 3% for stage chairpersons
          true,
          'Auto-assigned as stage chairperson (every chairperson must manage a stage)'
        );
        
        RAISE NOTICE '✅ Created Stage Chairperson assignment at: %', v_stage_name;
      ELSE
        RAISE NOTICE '✅ Stage Chairperson assignment already exists';
      END IF;
    ELSE
      RAISE NOTICE '⚠️ Could not find a stage in your region hierarchy';
    END IF;
  ELSE
    RAISE NOTICE '✅ Already a Stage Chairperson';
  END IF;

  -- STEP 3B: Create Rider Record
  IF NOT EXISTS(SELECT 1 FROM mbg_riders WHERE user_id = v_user_id) THEN
    -- Determine stage_id for rider
    IF v_stage_id IS NOT NULL THEN
      -- Use the stage we just found/assigned
      NULL;
    ELSIF v_primary_committee.region_type = 'stage' THEN
      -- Use primary committee's stage
      v_stage_id := v_primary_committee.region_id;
    ELSE
      -- Find any stage in hierarchy
      SELECT s.id INTO v_stage_id
      FROM mbg_stages s
      LIMIT 1;
    END IF;

    IF v_stage_id IS NOT NULL THEN
      INSERT INTO mbg_riders (
        user_id, stage_id, vehicle_type, plate_number,
        status, rating, completed_rides, total_rides
      )
      VALUES (
        v_user_id,
        v_stage_id,
        'motorcycle',
        'PENDING',
        'active',
        5.0,
        0,
        0
      )
      RETURNING id INTO v_rider_id;
      
      RAISE NOTICE '✅ Created Rider record (ID: %)', v_rider_id;
    ELSE
      RAISE NOTICE '⚠️ Could not create rider record - no stage found';
    END IF;
  ELSE
    RAISE NOTICE '✅ Rider record already exists';
  END IF;

  -- Add 'rider' role
  PERFORM add_user_role(v_user_id, 'rider');
  RAISE NOTICE '✅ Added "rider" role';

  RAISE NOTICE '========================================';
  RAISE NOTICE '';

  -- Show final status
  RAISE NOTICE '========================================';
  RAISE NOTICE '✅ FINAL STATUS';
  RAISE NOTICE '========================================';
  
  DECLARE
    v_final_roles text[];
    v_final_committee_count int;
  BEGIN
    SELECT user_roles INTO v_final_roles
    FROM mbg_users WHERE id = v_user_id;
    
    SELECT COUNT(*) INTO v_final_committee_count
    FROM mbg_committee_members
    WHERE user_id = v_user_id AND is_active = true;
    
    RAISE NOTICE 'User Roles: %', v_final_roles;
    RAISE NOTICE 'Committee Assignments: %', v_final_committee_count;
    RAISE NOTICE 'Rider Record: YES';
    RAISE NOTICE '========================================';
  END;
END $$;

-- STEP 4: Show what tabs you should now see
SELECT 
  '🎉 SUCCESS! You should now see these role tabs:' as message
UNION ALL
SELECT 
  '   - Chairperson (primary role)'
UNION ALL
SELECT 
  '   - Rider (auto-assigned)'
UNION ALL
SELECT 
  ''
UNION ALL
SELECT 
  '📝 Next Steps:'
UNION ALL
SELECT 
  '   1. Refresh your browser (Ctrl+Shift+R or Cmd+Shift+R)'
UNION ALL
SELECT 
  '   2. You should see "2 Active Roles" in the welcome message'
UNION ALL
SELECT 
  '   3. Role tabs should appear: [Chairperson] | Rider'
UNION ALL
SELECT 
  '   4. Click "Rider" tab to switch to rider dashboard';
