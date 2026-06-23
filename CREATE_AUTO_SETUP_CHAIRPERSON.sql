-- ==============================================
-- AUTO SETUP CHAIRPERSON FUNCTION
-- ==============================================
-- This function auto-creates committee member record for chairpersons

BEGIN;

-- Add commission_rate column if missing
ALTER TABLE public.mbg_committee_members 
ADD COLUMN IF NOT EXISTS commission_rate DECIMAL(5,2) DEFAULT 5.00 CHECK (commission_rate >= 0 AND commission_rate <= 100);

-- Drop existing function
DROP FUNCTION IF EXISTS public.auto_setup_chairperson(UUID);

-- Create auto-setup function
CREATE OR REPLACE FUNCTION public.auto_setup_chairperson(target_user_id UUID)
RETURNS JSON
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  existing_committee RECORD;
  first_district_id UUID;
  developer_id UUID;
  result JSON;
BEGIN
  -- Check if committee member already exists
  SELECT * INTO existing_committee
  FROM public.mbg_committee_members
  WHERE user_id = target_user_id
  LIMIT 1;

  -- If exists, return success
  IF FOUND THEN
    RETURN json_build_object(
      'success', true,
      'message', 'Committee member already exists',
      'committee_id', existing_committee.id
    );
  END IF;

  -- Get first available district
  SELECT id INTO first_district_id
  FROM public.mbg_districts
  WHERE is_active = true
  ORDER BY name
  LIMIT 1;

  -- If no district exists, create a default one
  IF first_district_id IS NULL THEN
    INSERT INTO public.mbg_districts (name, is_active, created_at, updated_at)
    VALUES ('Default District', true, NOW(), NOW())
    RETURNING id INTO first_district_id;
  END IF;

  -- Get a developer user as assigner
  SELECT id INTO developer_id
  FROM public.mbg_users
  WHERE role_type = 'developer'
  ORDER BY created_at
  LIMIT 1;

  -- If no developer exists, use the current user
  IF developer_id IS NULL THEN
    developer_id := target_user_id;
  END IF;

  -- Create committee member record
  INSERT INTO public.mbg_committee_members (
    user_id,
    role,
    region_type,
    region_id,
    assigned_by,
    is_active,
    appointed_at,
    commission_rate,
    created_at,
    updated_at
  )
  VALUES (
    target_user_id,
    'district_chairperson'::mbg_chairperson_role,
    'district'::mbg_region_type,
    first_district_id,
    developer_id,
    true,
    NOW(),
    5.00,
    NOW(),
    NOW()
  )
  ON CONFLICT (user_id, region_type, region_id) DO UPDATE
  SET 
    is_active = true,
    updated_at = NOW()
  RETURNING id INTO existing_committee.id;

  -- Ensure user profile exists
  INSERT INTO public.mbg_user_profiles (user_id, full_name, created_at, updated_at)
  SELECT 
    target_user_id,
    COALESCE(
      au.raw_user_meta_data->>'full_name',
      au.raw_user_meta_data->>'name',
      SPLIT_PART(au.email, '@', 1),
      'Chairperson'
    ),
    NOW(),
    NOW()
  FROM auth.users au
  WHERE au.id = target_user_id
  ON CONFLICT (user_id) DO NOTHING;

  RETURN json_build_object(
    'success', true,
    'message', 'Committee member created successfully',
    'committee_id', existing_committee.id
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object(
      'success', false,
      'error', SQLERRM
    );
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.auto_setup_chairperson(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.auto_setup_chairperson(UUID) TO service_role;

COMMIT;

-- Test the function
SELECT 'Function created successfully!' as status;
