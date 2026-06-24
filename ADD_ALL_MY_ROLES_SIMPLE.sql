-- ============================================
-- SIMPLE FIX: Add All Roles to Current User
-- ============================================
-- Adds: chairperson, rider, customer roles
-- Creates: stage assignment, rider record
-- ============================================

-- Get your user email and run this
DO $$
DECLARE
  v_user_id uuid;
  v_user_email text := 'your-email@example.com'; -- CHANGE THIS TO YOUR EMAIL
  v_user_roles text[];
  v_primary_committee record;
  v_stage_id uuid;
  v_stage_name text;
  v_rider_id uuid;
BEGIN
  -- Get user ID
  SELECT id, user_roles INTO v_user_id, v_user_roles
  FROM mbg_users
  WHERE email = v_user_email;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User not found: %', v_user_email;
  END IF;

  RAISE NOTICE '========================================';
  RAISE NOTICE '🔍 Current Status';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Email: %', v_user_email;
  RAISE NOTICE 'Current Roles: %', COALESCE(v_user_roles::text, 'NONE');

  -- Initialize user_roles if NULL
  IF v_user_roles IS NULL THEN
    UPDATE mbg_users SET user_roles = ARRAY[]::text[] WHERE id = v_user_id;
    v_user_roles := ARRAY[]::text[];
  END IF;

  -- Get primary committee assignment
  SELECT * INTO v_primary_committee
  FROM mbg_committee_members
  WHERE user_id = v_user_id AND is_active = true
  ORDER BY created_at
  LIMIT 1;

  IF v_primary_committee IS NOT NULL THEN
    RAISE NOTICE 'Primary Assignment: % at %', v_primary_committee.role, v_primary_committee.region_name;
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE '🔧 Adding Roles';
  RAISE NOTICE '========================================';

  -- Add 'chairperson' role
  IF NOT ('chairperson' = ANY(v_user_roles)) THEN
    UPDATE mbg_users
    SET user_roles = array_append(user_roles, 'chairperson')
    WHERE id = v_user_id;
    RAISE NOTICE '✅ Added "chairperson" role';
  ELSE
    RAISE NOTICE '✅ Already has "chairperson" role';
  END IF;

  -- Add 'customer' role (everyone can be a customer)
  IF NOT ('customer' = ANY(v_user_roles)) THEN
    UPDATE mbg_users
    SET user_roles = array_append(user_roles, 'customer')
    WHERE id = v_user_id;
    RAISE NOTICE '✅ Added "customer" role';
  ELSE
    RAISE NOTICE '✅ Already has "customer" role';
  END IF;

  -- Create Stage Chairperson Assignment (if needed)
  IF v_primary_committee IS NOT NULL AND v_primary_committee.region_type != 'stage' THEN
    -- Find a stage in your region
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
      -- Check if stage assignment exists
      IF NOT EXISTS(
        SELECT 1 FROM mbg_committee_members
        WHERE user_id = v_user_id AND region_type = 'stage' AND is_active = true
      ) THEN
        INSERT INTO mbg_committee_members (
          user_id, role, region_type, region_id, region_name,
          commission_rate, is_active, notes
        )
        VALUES (
          v_user_id, 'stage_chairperson', 'stage', v_stage_id, v_stage_name,
          3.00, true, 'Auto-assigned (every chairperson must manage a stage)'
        );
        RAISE NOTICE '✅ Created Stage Chairperson assignment: %', v_stage_name;
      ELSE
        RAISE NOTICE '✅ Stage assignment already exists';
      END IF;
    END IF;
  ELSIF v_primary_committee IS NOT NULL AND v_primary_committee.region_type = 'stage' THEN
    v_stage_id := v_primary_committee.region_id;
    RAISE NOTICE '✅ Already a Stage Chairperson';
  END IF;

  -- Create Rider Record
  IF NOT EXISTS(SELECT 1 FROM mbg_riders WHERE user_id = v_user_id) THEN
    -- Use stage_id we found, or find any stage
    IF v_stage_id IS NULL THEN
      SELECT id INTO v_stage_id FROM mbg_stages LIMIT 1;
    END IF;

    IF v_stage_id IS NOT NULL THEN
      INSERT INTO mbg_riders (
        user_id, stage_id, vehicle_type, plate_number,
        status, rating, completed_rides, total_rides
      )
      VALUES (
        v_user_id, v_stage_id, 'motorcycle', 'PENDING',
        'active', 5.0, 0, 0
      )
      RETURNING id INTO v_rider_id;
      RAISE NOTICE '✅ Created Rider record (ID: %)', v_rider_id;
    END IF;
  ELSE
    RAISE NOTICE '✅ Rider record already exists';
  END IF;

  -- Add 'rider' role
  SELECT user_roles INTO v_user_roles FROM mbg_users WHERE id = v_user_id;
  IF NOT ('rider' = ANY(v_user_roles)) THEN
    UPDATE mbg_users
    SET user_roles = array_append(user_roles, 'rider')
    WHERE id = v_user_id;
    RAISE NOTICE '✅ Added "rider" role';
  ELSE
    RAISE NOTICE '✅ Already has "rider" role';
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE '✅ FINAL STATUS';
  RAISE NOTICE '========================================';
  
  -- Show final status
  SELECT user_roles INTO v_user_roles FROM mbg_users WHERE id = v_user_id;
  RAISE NOTICE 'User Roles: %', v_user_roles;
  
  DECLARE
    v_committee_count int;
    v_has_rider boolean;
  BEGIN
    SELECT COUNT(*) INTO v_committee_count
    FROM mbg_committee_members
    WHERE user_id = v_user_id AND is_active = true;
    
    SELECT EXISTS(SELECT 1 FROM mbg_riders WHERE user_id = v_user_id) INTO v_has_rider;
    
    RAISE NOTICE 'Committee Assignments: %', v_committee_count;
    RAISE NOTICE 'Has Rider Record: %', v_has_rider;
  END;
  
  RAISE NOTICE '========================================';
  RAISE NOTICE '';
  RAISE NOTICE '🎉 SUCCESS! Refresh your browser to see:';
  RAISE NOTICE '   - Role tabs: Chairperson | Rider | Customer';
  RAISE NOTICE '   - "% Active Roles" in welcome message', array_length(v_user_roles, 1);
  RAISE NOTICE '   - Click tabs to switch between roles';
  RAISE NOTICE '';
  RAISE NOTICE '📝 Press Ctrl+Shift+R (or Cmd+Shift+R) to hard refresh!';
  RAISE NOTICE '========================================';
  
END $$;
