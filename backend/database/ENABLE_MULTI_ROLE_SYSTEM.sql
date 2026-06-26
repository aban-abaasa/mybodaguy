-- ============================================
-- MULTI-ROLE SYSTEM FOR MYBODAGUY
-- ============================================
-- Users can now have multiple roles:
-- - District Chairperson + Stage Chairperson + Rider
-- - Stage Chairperson + Rider
-- - etc.
-- ============================================

-- Step 1: Add user_roles array column to mbg_users
-- This stores all roles a user has
ALTER TABLE public.mbg_users 
ADD COLUMN IF NOT EXISTS user_roles text[] DEFAULT ARRAY['customer']::text[];

-- Step 2: Migrate existing single role_type to array
UPDATE public.mbg_users
SET user_roles = ARRAY[role_type]::text[]
WHERE user_roles IS NULL OR user_roles = ARRAY['customer']::text[];

-- Step 3: Create function to get all user roles
CREATE OR REPLACE FUNCTION public.get_user_roles(target_user_id uuid)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN (
    SELECT user_roles
    FROM public.mbg_users
    WHERE id = target_user_id
  );
END;
$$;

-- Step 4: Create function to add role to user
CREATE OR REPLACE FUNCTION public.add_user_role(
  target_user_id uuid,
  new_role text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_roles text[];
BEGIN
  -- Get current roles
  SELECT user_roles INTO current_roles
  FROM public.mbg_users
  WHERE id = target_user_id;
  
  -- Check if role already exists
  IF new_role = ANY(current_roles) THEN
    RETURN true; -- Already has this role
  END IF;
  
  -- Add new role
  UPDATE public.mbg_users
  SET user_roles = array_append(current_roles, new_role),
      updated_at = NOW()
  WHERE id = target_user_id;
  
  RETURN true;
END;
$$;

-- Step 5: Create function to remove role from user
CREATE OR REPLACE FUNCTION public.remove_user_role(
  target_user_id uuid,
  role_to_remove text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.mbg_users
  SET user_roles = array_remove(user_roles, role_to_remove),
      updated_at = NOW()
  WHERE id = target_user_id;
  
  RETURN true;
END;
$$;

-- Step 6: Update mbg_assign_rider to automatically add 'rider' role
CREATE OR REPLACE FUNCTION public.mbg_assign_rider(
  target_user_email text,
  stage_id_param uuid,
  vehicle_type_param text,
  plate_number_param text,
  license_number_param text DEFAULT NULL,
  license_expiry_param date DEFAULT NULL,
  insurance_number_param text DEFAULT NULL,
  insurance_expiry_param date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  target_user_id uuid;
  existing_rider_id uuid;
  stage_exists boolean;
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
  
  -- Validate stage_id exists
  SELECT EXISTS(
    SELECT 1 FROM public.mbg_stages WHERE id = stage_id_param
  ) INTO stage_exists;
  
  IF NOT stage_exists THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Invalid stage_id: Stage does not exist. Please contact administrator to create stages.'
    );
  END IF;
  
  -- Check if user is already a rider
  SELECT id INTO existing_rider_id
  FROM public.mbg_riders
  WHERE user_id = target_user_id;
  
  IF existing_rider_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'User is already assigned as a rider'
    );
  END IF;
  
  -- Add 'rider' role to user_roles array
  PERFORM public.add_user_role(target_user_id, 'rider');
  
  -- Create rider record
  INSERT INTO public.mbg_riders (
    user_id,
    stage_id,
    vehicle_type,
    plate_number,
    license_number,
    license_expiry,
    insurance_number,
    insurance_expiry,
    status
  ) VALUES (
    target_user_id,
    stage_id_param,
    vehicle_type_param,
    plate_number_param,
    license_number_param,
    license_expiry_param,
    insurance_number_param,
    insurance_expiry_param,
    'active'
  );
  
  RETURN jsonb_build_object(
    'success', true,
    'user_id', target_user_id,
    'message', 'Rider assigned successfully and role added'
  );
END;
$$;

-- Step 7: Update mbg_assign_chairperson to add chairperson role
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
  
  RETURN jsonb_build_object(
    'success', true,
    'user_id', target_user_id,
    'message', 'Chairperson assigned successfully and role added'
  );
END;
$$;

-- Step 8: Create helper function to check if user has a specific role
CREATE OR REPLACE FUNCTION public.user_has_role(
  target_user_id uuid,
  role_to_check text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN (
    SELECT role_to_check = ANY(user_roles)
    FROM public.mbg_users
    WHERE id = target_user_id
  );
END;
$$;

-- Step 9: Grant permissions
GRANT EXECUTE ON FUNCTION public.get_user_roles(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_user_role(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_user_role(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_role(uuid, text) TO authenticated;

-- ============================================
-- VERIFICATION QUERIES
-- ============================================

-- Check current user roles
-- SELECT id, email, role_type, user_roles FROM mbg_users LIMIT 10;

-- Check if specific user has chairperson role
-- SELECT public.user_has_role('USER_ID_HERE', 'chairperson');

-- Get all roles for a user
-- SELECT public.get_user_roles('USER_ID_HERE');

-- ============================================
-- SUCCESS MESSAGE
-- ============================================
DO $$
BEGIN
  RAISE NOTICE '✅ Multi-role system enabled successfully!';
  RAISE NOTICE '📋 Users can now have multiple roles: [chairperson, rider, customer]';
  RAISE NOTICE '🔧 Functions created: get_user_roles, add_user_role, remove_user_role, user_has_role';
  RAISE NOTICE '⚙️  mbg_assign_chairperson and mbg_assign_rider now automatically add roles';
END $$;
