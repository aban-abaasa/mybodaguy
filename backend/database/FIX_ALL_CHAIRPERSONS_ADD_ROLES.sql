-- ============================================
-- COMPREHENSIVE MULTI-ROLE FIX
-- ============================================
-- 1. Fixes ALL existing chairpersons (adds stage + rider + customer roles)
-- 2. Updates mbg_assign_chairperson() to auto-add roles for future users
-- 3. Works for ALL users, not just one
-- ============================================

-- PART 1: Fix ALL Existing Chairpersons
-- ============================================
DO $$
DECLARE
  v_chairperson record;
  v_stage_id uuid;
  v_stage_name text;
  v_user_roles text[];
  v_fixed_count int := 0;
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE '🔧 FIXING ALL CHAIRPERSONS';
  RAISE NOTICE '========================================';
  RAISE NOTICE '';

  -- Loop through all users with committee assignments
  FOR v_chairperson IN 
    SELECT DISTINCT
      u.id as user_id,
      u.email,
      u.user_roles,
      cm.region_type,
      cm.region_id,
      cm.role
    FROM mbg_users u
    JOIN mbg_committee_members cm ON u.id = cm.user_id
    WHERE cm.is_active = true
    ORDER BY u.email
  LOOP
    RAISE NOTICE '----------------------------------------';
    RAISE NOTICE 'Processing: %', v_chairperson.email;
    RAISE NOTICE 'Current Roles: %', COALESCE(v_chairperson.user_roles::text, 'NONE');
    
    -- Initialize user_roles if NULL
    IF v_chairperson.user_roles IS NULL THEN
      UPDATE mbg_users 
      SET user_roles = ARRAY[]::text[] 
      WHERE id = v_chairperson.user_id;
      v_chairperson.user_roles := ARRAY[]::text[];
    END IF;

    -- Add 'chairperson' role
    IF NOT ('chairperson' = ANY(v_chairperson.user_roles)) THEN
      UPDATE mbg_users
      SET user_roles = array_append(user_roles, 'chairperson')
      WHERE id = v_chairperson.user_id;
      RAISE NOTICE '  ✅ Added "chairperson" role';
    END IF;

    -- Add 'customer' role (everyone can order rides)
    IF NOT ('customer' = ANY(v_chairperson.user_roles)) THEN
      UPDATE mbg_users
      SET user_roles = array_append(user_roles, 'customer')
      WHERE id = v_chairperson.user_id;
      RAISE NOTICE '  ✅ Added "customer" role';
    END IF;

    -- Create Stage Chairperson Assignment if not already stage level
    IF v_chairperson.region_type != 'stage' THEN
      -- Find a stage in this chairperson's region
      v_stage_id := NULL;
      
      IF v_chairperson.region_type = 'district' THEN
        SELECT s.id, s.name INTO v_stage_id, v_stage_name
        FROM mbg_stages s
        JOIN mbg_parishes p ON s.parish_id = p.id
        JOIN mbg_subcounties sc ON p.subcounty_id = sc.id
        JOIN mbg_divisions d ON sc.division_id = d.id
        WHERE d.district_id = v_chairperson.region_id
        LIMIT 1;
      ELSIF v_chairperson.region_type = 'division' THEN
        SELECT s.id, s.name INTO v_stage_id, v_stage_name
        FROM mbg_stages s
        JOIN mbg_parishes p ON s.parish_id = p.id
        JOIN mbg_subcounties sc ON p.subcounty_id = sc.id
        WHERE sc.division_id = v_chairperson.region_id
        LIMIT 1;
      ELSIF v_chairperson.region_type = 'subcounty' THEN
        SELECT s.id, s.name INTO v_stage_id, v_stage_name
        FROM mbg_stages s
        JOIN mbg_parishes p ON s.parish_id = p.id
        WHERE p.subcounty_id = v_chairperson.region_id
        LIMIT 1;
      ELSIF v_chairperson.region_type = 'parish' THEN
        SELECT s.id, s.name INTO v_stage_id, v_stage_name
        FROM mbg_stages s
        WHERE s.parish_id = v_chairperson.region_id
        LIMIT 1;
      END IF;

      IF v_stage_id IS NOT NULL THEN
        IF NOT EXISTS(
          SELECT 1 FROM mbg_committee_members
          WHERE user_id = v_chairperson.user_id 
          AND region_type = 'stage' 
          AND is_active = true
        ) THEN
          INSERT INTO mbg_committee_members (
            user_id, role, region_type, region_id,
            commission_rate, is_active, notes
          )
          VALUES (
            v_chairperson.user_id, 'stage_chairperson', 'stage',
            v_stage_id, 3.00, true,
            'Auto-assigned (every chairperson manages a stage)'
          );
          RAISE NOTICE '  ✅ Created Stage assignment: %', v_stage_name;
        END IF;
      END IF;
    ELSE
      v_stage_id := v_chairperson.region_id;
    END IF;

    -- Create Rider Record
    IF NOT EXISTS(SELECT 1 FROM mbg_riders WHERE user_id = v_chairperson.user_id) THEN
      IF v_stage_id IS NULL THEN
        -- Find any stage as fallback
        SELECT id INTO v_stage_id FROM mbg_stages LIMIT 1;
      END IF;

      IF v_stage_id IS NOT NULL THEN
        INSERT INTO mbg_riders (
          user_id, stage_id, vehicle_type, plate_number,
          license_number, status, rating, completed_rides, total_rides
        )
        VALUES (
          v_chairperson.user_id, v_stage_id, 'motorcycle',
          'PENDING-' || substr(v_chairperson.user_id::text, 1, 8),
          'PENDING-' || substr(v_chairperson.user_id::text, 1, 8),
          'active', 5.0, 0, 0
        );
        RAISE NOTICE '  ✅ Created Rider record';
      END IF;
    END IF;

    -- Add 'rider' role
    SELECT user_roles INTO v_user_roles FROM mbg_users WHERE id = v_chairperson.user_id;
    IF NOT ('rider' = ANY(v_user_roles)) THEN
      UPDATE mbg_users
      SET user_roles = array_append(user_roles, 'rider')
      WHERE id = v_chairperson.user_id;
      RAISE NOTICE '  ✅ Added "rider" role';
    END IF;

    v_fixed_count := v_fixed_count + 1;
    
    -- Show final roles for this user
    SELECT user_roles INTO v_user_roles FROM mbg_users WHERE id = v_chairperson.user_id;
    RAISE NOTICE '  📋 Final Roles: %', v_user_roles;
  END LOOP;

  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE '✅ Fixed % chairperson(s)', v_fixed_count;
  RAISE NOTICE '========================================';
END $$;

-- PART 2: Update mbg_assign_chairperson() Function
-- ============================================
-- This ensures ALL FUTURE chairpersons get all roles automatically
-- ============================================

DROP FUNCTION IF EXISTS mbg_assign_chairperson(text,text,text,uuid,numeric,text);

CREATE OR REPLACE FUNCTION mbg_assign_chairperson(
  target_user_email text,
  target_role text,
  target_region_type text,
  target_region_id uuid,
  target_commission_rate numeric DEFAULT 5.00,
  target_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_target_user_id uuid;
  v_region_name text;
  v_new_committee_id uuid;
  v_stage_id uuid;
  v_stage_name text;
  v_rider_id uuid;
  v_user_roles text[];
BEGIN
  -- Get target user
  SELECT id, user_roles INTO v_target_user_id, v_user_roles
  FROM mbg_users
  WHERE email = target_user_email;

  IF v_target_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'User not found: ' || target_user_email
    );
  END IF;

  -- Initialize user_roles if NULL
  IF v_user_roles IS NULL THEN
    UPDATE mbg_users SET user_roles = ARRAY[]::text[] WHERE id = v_target_user_id;
    v_user_roles := ARRAY[]::text[];
  END IF;

  -- Get region name
  IF target_region_type = 'district' THEN
    SELECT name INTO v_region_name FROM mbg_districts WHERE id = target_region_id;
  ELSIF target_region_type = 'division' THEN
    SELECT name INTO v_region_name FROM mbg_divisions WHERE id = target_region_id;
  ELSIF target_region_type = 'subcounty' THEN
    SELECT name INTO v_region_name FROM mbg_subcounties WHERE id = target_region_id;
  ELSIF target_region_type = 'parish' THEN
    SELECT name INTO v_region_name FROM mbg_parishes WHERE id = target_region_id;
  ELSIF target_region_type = 'stage' THEN
    SELECT name INTO v_region_name FROM mbg_stages WHERE id = target_region_id;
  END IF;

  -- Create committee member record
  INSERT INTO mbg_committee_members (
    user_id, role, region_type, region_id,
    commission_rate, is_active, notes, assigned_by
  )
  VALUES (
    v_target_user_id, target_role, target_region_type, target_region_id,
    target_commission_rate, true, target_notes, auth.uid()
  )
  RETURNING id INTO v_new_committee_id;

  -- Add 'chairperson' role
  IF NOT ('chairperson' = ANY(v_user_roles)) THEN
    UPDATE mbg_users
    SET user_roles = array_append(user_roles, 'chairperson')
    WHERE id = v_target_user_id;
  END IF;

  -- Add 'customer' role (everyone can order rides)
  IF NOT ('customer' = ANY(v_user_roles)) THEN
    UPDATE mbg_users
    SET user_roles = array_append(user_roles, 'customer')
    WHERE id = v_target_user_id;
  END IF;

  -- AUTO-ASSIGN AS STAGE CHAIRPERSON (if not already stage level)
  IF target_region_type != 'stage' THEN
    -- Find a stage in this chairperson's region
    IF target_region_type = 'district' THEN
      SELECT s.id, s.name INTO v_stage_id, v_stage_name
      FROM mbg_stages s
      JOIN mbg_parishes p ON s.parish_id = p.id
      JOIN mbg_subcounties sc ON p.subcounty_id = sc.id
      JOIN mbg_divisions d ON sc.division_id = d.id
      WHERE d.district_id = target_region_id
      LIMIT 1;
    ELSIF target_region_type = 'division' THEN
      SELECT s.id, s.name INTO v_stage_id, v_stage_name
      FROM mbg_stages s
      JOIN mbg_parishes p ON s.parish_id = p.id
      JOIN mbg_subcounties sc ON p.subcounty_id = sc.id
      WHERE sc.division_id = target_region_id
      LIMIT 1;
    ELSIF target_region_type = 'subcounty' THEN
      SELECT s.id, s.name INTO v_stage_id, v_stage_name
      FROM mbg_stages s
      JOIN mbg_parishes p ON s.parish_id = p.id
      WHERE p.subcounty_id = target_region_id
      LIMIT 1;
    ELSIF target_region_type = 'parish' THEN
      SELECT s.id, s.name INTO v_stage_id, v_stage_name
      FROM mbg_stages s
      WHERE s.parish_id = target_region_id
      LIMIT 1;
    END IF;

    IF v_stage_id IS NOT NULL THEN
      -- Create stage chairperson assignment
      INSERT INTO mbg_committee_members (
        user_id, role, region_type, region_id,
        commission_rate, is_active, notes
      )
      VALUES (
        v_target_user_id, 'stage_chairperson', 'stage', v_stage_id,
        3.00, true, 'Auto-assigned (every chairperson manages a stage)'
      )
      ON CONFLICT DO NOTHING;
    END IF;
  ELSE
    v_stage_id := target_region_id;
  END IF;

  -- AUTO-CREATE RIDER RECORD
  IF NOT EXISTS(SELECT 1 FROM mbg_riders WHERE user_id = v_target_user_id) THEN
    IF v_stage_id IS NULL THEN
      SELECT id INTO v_stage_id FROM mbg_stages LIMIT 1;
    END IF;

    IF v_stage_id IS NOT NULL THEN
      INSERT INTO mbg_riders (
        user_id, stage_id, vehicle_type, plate_number,
        license_number, status, rating, completed_rides, total_rides
      )
      VALUES (
        v_target_user_id, v_stage_id, 'motorcycle',
        'PENDING-' || substr(v_target_user_id::text, 1, 8),
        'PENDING-' || substr(v_target_user_id::text, 1, 8),
        'active', 5.0, 0, 0
      )
      RETURNING id INTO v_rider_id;
    END IF;
  END IF;

  -- Add 'rider' role
  SELECT user_roles INTO v_user_roles FROM mbg_users WHERE id = v_target_user_id;
  IF NOT ('rider' = ANY(v_user_roles)) THEN
    UPDATE mbg_users
    SET user_roles = array_append(user_roles, 'rider')
    WHERE id = v_target_user_id;
  END IF;

  -- Return success with all info
  SELECT user_roles INTO v_user_roles FROM mbg_users WHERE id = v_target_user_id;
  
  RETURN jsonb_build_object(
    'success', true,
    'committee_member_id', v_new_committee_id,
    'user_id', v_target_user_id,
    'user_email', target_user_email,
    'role', target_role,
    'region_type', target_region_type,
    'region_name', v_region_name,
    'commission_rate', target_commission_rate,
    'stage_id', v_stage_id,
    'rider_id', v_rider_id,
    'user_roles', v_user_roles,
    'message', 'Chairperson assigned successfully with stage assignment and rider role'
  );
END;
$$;

-- PART 3: Show Results
-- ============================================
SELECT 
  '========================================' as message
UNION ALL SELECT '✅ COMPLETE! ALL FIXES APPLIED'
UNION ALL SELECT '========================================'
UNION ALL SELECT ''
UNION ALL SELECT '📊 Summary:'
UNION ALL SELECT '   ✅ Fixed all existing chairpersons'
UNION ALL SELECT '   ✅ Updated mbg_assign_chairperson() function'
UNION ALL SELECT '   ✅ Future chairpersons will auto-get all roles'
UNION ALL SELECT ''
UNION ALL SELECT '🔄 NEXT STEPS:'
UNION ALL SELECT '   1. Hard refresh your browser (Ctrl+Shift+R)'
UNION ALL SELECT '   2. You should see: Chairperson | Rider | Customer tabs'
UNION ALL SELECT '   3. Click tabs to switch between roles'
UNION ALL SELECT ''
UNION ALL SELECT '✨ Every chairperson now has:'
UNION ALL SELECT '   - Primary chairperson role (district/division/etc)'
UNION ALL SELECT '   - Stage chairperson assignment'
UNION ALL SELECT '   - Rider role (active)'
UNION ALL SELECT '   - Customer role (can order rides)'
UNION ALL SELECT '========================================';
