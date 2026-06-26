-- ============================================
-- AUTO-ASSIGN CHAIRPERSONS AS RIDERS
-- ============================================
-- Every chairperson MUST also be a rider
-- When assigning chairperson → automatically assign as rider
-- ============================================

-- Step 1: Update mbg_assign_chairperson to also create rider record
CREATE OR REPLACE FUNCTION public.mbg_assign_chairperson(
  target_user_email text,
  target_role text,
  target_region_type text,
  target_region_id uuid,
  commission_rate_param numeric DEFAULT 5.00,
  notes_param text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  target_user_id uuid;
  existing_assignment_id uuid;
  region_exists boolean;
  stage_id_for_rider uuid;
  existing_rider_id uuid;
BEGIN
  -- Get user ID from email
  SELECT id INTO target_user_id
  FROM auth.users
  WHERE email = target_user_email;
  
  IF target_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'User not found with email: ' || target_user_email
    );
  END IF;
  
  -- Validate region exists
  IF target_region_type = 'district' THEN
    SELECT EXISTS(SELECT 1 FROM public.mbg_districts WHERE id = target_region_id) INTO region_exists;
  ELSIF target_region_type = 'division' THEN
    SELECT EXISTS(SELECT 1 FROM public.mbg_divisions WHERE id = target_region_id) INTO region_exists;
  ELSIF target_region_type = 'subcounty' THEN
    SELECT EXISTS(SELECT 1 FROM public.mbg_subcounties WHERE id = target_region_id) INTO region_exists;
  ELSIF target_region_type = 'parish' THEN
    SELECT EXISTS(SELECT 1 FROM public.mbg_parishes WHERE id = target_region_id) INTO region_exists;
  ELSIF target_region_type = 'stage' THEN
    SELECT EXISTS(SELECT 1 FROM public.mbg_stages WHERE id = target_region_id) INTO region_exists;
  ELSE
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Invalid region_type: ' || target_region_type
    );
  END IF;
  
  IF NOT region_exists THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Invalid region_id: ' || target_region_type || ' does not exist'
    );
  END IF;
  
  -- Check if user already has this specific assignment
  SELECT id INTO existing_assignment_id
  FROM public.mbg_committee_members
  WHERE user_id = target_user_id 
    AND region_type = target_region_type 
    AND region_id = target_region_id;
  
  IF existing_assignment_id IS NOT NULL THEN
    -- Update existing assignment
    UPDATE public.mbg_committee_members
    SET role = target_role,
        commission_rate = commission_rate_param,
        is_active = true,
        updated_at = NOW()
    WHERE id = existing_assignment_id;
  ELSE
    -- Create new assignment
    INSERT INTO public.mbg_committee_members (
      user_id,
      role,
      region_type,
      region_id,
      commission_rate,
      is_active
    ) VALUES (
      target_user_id,
      target_role,
      target_region_type,
      target_region_id,
      commission_rate_param,
      true
    );
  END IF;
  
  -- Add 'chairperson' role to user_roles array
  PERFORM public.add_user_role(target_user_id, 'chairperson');
  
  -- ============================================
  -- AUTO-ASSIGN AS STAGE CHAIRPERSON (NEW LOGIC)
  -- ============================================
  
  -- If chairperson is NOT already a stage chairperson, make them one
  IF target_region_type != 'stage' THEN
    -- Check if already stage chairperson somewhere
    IF NOT EXISTS(
      SELECT 1 FROM public.mbg_committee_members
      WHERE user_id = target_user_id
        AND region_type = 'stage'
        AND is_active = true
    ) THEN
      -- Find appropriate stage and assign as stage chairperson
      IF stage_id_for_rider IS NOT NULL THEN
        INSERT INTO public.mbg_committee_members (
          user_id,
          role,
          region_type,
          region_id,
          commission_rate,
          is_active
        ) VALUES (
          target_user_id,
          'stage_chairperson',
          'stage',
          stage_id_for_rider,
          5.00, -- Default commission for stage chairperson
          true
        );
        
        RAISE NOTICE 'Auto-assigned user % as stage chairperson for stage %', target_user_id, stage_id_for_rider;
      END IF;
    END IF;
  END IF;
  
  -- ============================================
  -- AUTO-ASSIGN AS RIDER (EXISTING LOGIC)
  -- ============================================
  
  -- Find appropriate stage for this chairperson
  IF target_region_type = 'stage' THEN
    -- If already stage chairperson, use that stage
    stage_id_for_rider := target_region_id;
  ELSIF target_region_type = 'parish' THEN
    -- Find first stage in this parish
    SELECT id INTO stage_id_for_rider
    FROM public.mbg_stages
    WHERE parish_id = target_region_id
    LIMIT 1;
  ELSIF target_region_type = 'subcounty' THEN
    -- Find first stage in this subcounty
    SELECT s.id INTO stage_id_for_rider
    FROM public.mbg_stages s
    JOIN public.mbg_parishes p ON s.parish_id = p.id
    WHERE p.subcounty_id = target_region_id
    LIMIT 1;
  ELSIF target_region_type = 'division' THEN
    -- Find first stage in this division
    SELECT s.id INTO stage_id_for_rider
    FROM public.mbg_stages s
    JOIN public.mbg_parishes p ON s.parish_id = p.id
    JOIN public.mbg_subcounties sc ON p.subcounty_id = sc.id
    WHERE sc.division_id = target_region_id
    LIMIT 1;
  ELSIF target_region_type = 'district' THEN
    -- Find first stage in this district
    SELECT s.id INTO stage_id_for_rider
    FROM public.mbg_stages s
    JOIN public.mbg_parishes p ON s.parish_id = p.id
    JOIN public.mbg_subcounties sc ON p.subcounty_id = sc.id
    JOIN public.mbg_divisions d ON sc.division_id = d.id
    WHERE d.district_id = target_region_id
    LIMIT 1;
  END IF;
  
  -- Check if user is already a rider
  SELECT id INTO existing_rider_id
  FROM public.mbg_riders
  WHERE user_id = target_user_id;
  
  -- If stage found and not already a rider, create rider record
  IF stage_id_for_rider IS NOT NULL AND existing_rider_id IS NULL THEN
    INSERT INTO public.mbg_riders (
      user_id,
      stage_id,
      vehicle_type,
      plate_number,
      status
    ) VALUES (
      target_user_id,
      stage_id_for_rider,
      'motorcycle', -- Default vehicle type
      'PENDING', -- Placeholder, chairperson should update
      'active'
    );
    
    -- Add 'rider' role
    PERFORM public.add_user_role(target_user_id, 'rider');
    
    RETURN jsonb_build_object(
      'success', true,
      'user_id', target_user_id,
      'message', 'Chairperson assigned successfully, auto-assigned as stage chairperson and rider',
      'auto_stage_chairperson_assigned', target_region_type != 'stage',
      'auto_rider_assigned', true
    );
  ELSE
    -- Rider already exists or no stage found
    IF existing_rider_id IS NOT NULL THEN
      -- Just ensure rider role is added
      PERFORM public.add_user_role(target_user_id, 'rider');
    END IF;
    
    RETURN jsonb_build_object(
      'success', true,
      'user_id', target_user_id,
      'message', 'Chairperson assigned successfully',
      'auto_stage_chairperson_assigned', target_region_type != 'stage',
      'auto_rider_assigned', false,
      'rider_already_exists', existing_rider_id IS NOT NULL,
      'no_stage_found', stage_id_for_rider IS NULL
    );
  END IF;
END;
$$;

-- Step 2: Create function to auto-assign existing chairpersons as riders
CREATE OR REPLACE FUNCTION public.auto_assign_all_chairpersons_as_riders()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  chairperson_record RECORD;
  stage_id_for_rider uuid;
  assigned_count integer := 0;
  skipped_count integer := 0;
  error_count integer := 0;
BEGIN
  -- Loop through all active chairpersons
  FOR chairperson_record IN 
    SELECT DISTINCT user_id, region_type, region_id
    FROM public.mbg_committee_members
    WHERE is_active = true
  LOOP
    BEGIN
      -- Check if already a rider
      IF EXISTS(SELECT 1 FROM public.mbg_riders WHERE user_id = chairperson_record.user_id) THEN
        -- Just add rider role if not present
        PERFORM public.add_user_role(chairperson_record.user_id, 'rider');
        skipped_count := skipped_count + 1;
        CONTINUE;
      END IF;
      
      -- Find appropriate stage
      stage_id_for_rider := NULL;
      
      IF chairperson_record.region_type = 'stage' THEN
        stage_id_for_rider := chairperson_record.region_id;
      ELSIF chairperson_record.region_type = 'parish' THEN
        SELECT id INTO stage_id_for_rider
        FROM public.mbg_stages
        WHERE parish_id = chairperson_record.region_id
        LIMIT 1;
      ELSIF chairperson_record.region_type = 'subcounty' THEN
        SELECT s.id INTO stage_id_for_rider
        FROM public.mbg_stages s
        JOIN public.mbg_parishes p ON s.parish_id = p.id
        WHERE p.subcounty_id = chairperson_record.region_id
        LIMIT 1;
      ELSIF chairperson_record.region_type = 'division' THEN
        SELECT s.id INTO stage_id_for_rider
        FROM public.mbg_stages s
        JOIN public.mbg_parishes p ON s.parish_id = p.id
        JOIN public.mbg_subcounties sc ON p.subcounty_id = sc.id
        WHERE sc.division_id = chairperson_record.region_id
        LIMIT 1;
      ELSIF chairperson_record.region_type = 'district' THEN
        SELECT s.id INTO stage_id_for_rider
        FROM public.mbg_stages s
        JOIN public.mbg_parishes p ON s.parish_id = p.id
        JOIN public.mbg_subcounties sc ON p.subcounty_id = sc.id
        JOIN public.mbg_divisions d ON sc.division_id = d.id
        WHERE d.district_id = chairperson_record.region_id
        LIMIT 1;
      END IF;
      
      -- Assign as stage chairperson if not already
      IF stage_id_for_rider IS NOT NULL AND chairperson_record.region_type != 'stage' THEN
        IF NOT EXISTS(
          SELECT 1 FROM public.mbg_committee_members
          WHERE user_id = chairperson_record.user_id
            AND region_type = 'stage'
            AND is_active = true
        ) THEN
          INSERT INTO public.mbg_committee_members (
            user_id,
            role,
            region_type,
            region_id,
            commission_rate,
            is_active
          ) VALUES (
            chairperson_record.user_id,
            'stage_chairperson',
            'stage',
            stage_id_for_rider,
            5.00,
            true
          );
          RAISE NOTICE 'Auto-assigned user % as stage chairperson', chairperson_record.user_id;
        END IF;
      END IF;
      
      -- Create rider if stage found
      IF stage_id_for_rider IS NOT NULL THEN
        INSERT INTO public.mbg_riders (
          user_id,
          stage_id,
          vehicle_type,
          plate_number,
          status
        ) VALUES (
          chairperson_record.user_id,
          stage_id_for_rider,
          'motorcycle',
          'PENDING',
          'active'
        );
        
        PERFORM public.add_user_role(chairperson_record.user_id, 'rider');
        assigned_count := assigned_count + 1;
      ELSE
        RAISE NOTICE 'No stage found for chairperson user_id: %', chairperson_record.user_id;
        error_count := error_count + 1;
      END IF;
      
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Error assigning rider for user_id %: %', chairperson_record.user_id, SQLERRM;
      error_count := error_count + 1;
    END;
  END LOOP;
  
  RETURN jsonb_build_object(
    'success', true,
    'assigned_count', assigned_count,
    'skipped_count', skipped_count,
    'error_count', error_count,
    'message', format('Auto-assigned %s chairpersons as riders. Skipped %s (already riders). Errors: %s', 
                      assigned_count, skipped_count, error_count)
  );
END;
$$;

-- Step 3: Grant permissions
GRANT EXECUTE ON FUNCTION public.auto_assign_all_chairpersons_as_riders() TO authenticated;

-- ============================================
-- EXECUTE: Auto-assign existing chairpersons
-- ============================================

-- Run this to auto-assign all existing chairpersons as riders
SELECT public.auto_assign_all_chairpersons_as_riders();

-- ============================================
-- VERIFICATION QUERIES
-- ============================================

-- Check chairpersons who are also riders
-- SELECT 
--   u.email,
--   u.user_roles,
--   cm.role as chairperson_role,
--   cm.region_type,
--   r.vehicle_type,
--   r.plate_number,
--   r.status as rider_status
-- FROM mbg_users u
-- JOIN mbg_committee_members cm ON u.id = cm.user_id
-- LEFT JOIN mbg_riders r ON u.id = r.user_id
-- WHERE cm.is_active = true
-- ORDER BY u.email;

-- Check chairpersons WITHOUT rider records (should be 0)
-- SELECT 
--   u.email,
--   cm.role,
--   cm.region_type
-- FROM mbg_users u
-- JOIN mbg_committee_members cm ON u.id = cm.user_id
-- LEFT JOIN mbg_riders r ON u.id = r.user_id
-- WHERE cm.is_active = true
--   AND r.id IS NULL;

-- ============================================
-- SUCCESS MESSAGE
-- ============================================
DO $$
BEGIN
  RAISE NOTICE '✅ Chairperson auto-assignment system enabled!';
  RAISE NOTICE '📋 Every chairperson automatically becomes:';
  RAISE NOTICE '   1️⃣  Stage Chairperson (if not already)';
  RAISE NOTICE '   2️⃣  Rider';
  RAISE NOTICE '🏍️  Existing chairpersons have been auto-assigned';
  RAISE NOTICE '🔧 Function: mbg_assign_chairperson() now creates stage + rider records';
  RAISE NOTICE '⚙️  Run: SELECT public.auto_assign_all_chairpersons_as_riders() to retry if needed';
END $$;
