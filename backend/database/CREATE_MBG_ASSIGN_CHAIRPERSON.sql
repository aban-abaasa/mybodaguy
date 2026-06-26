-- ==============================================
-- CREATE MBG ASSIGN CHAIRPERSON FUNCTION
-- ==============================================
-- Uses mbg_ prefix to avoid conflicts with other applications

BEGIN;

-- Create enum types with mbg_ prefix if they don't exist
DO $$ BEGIN
  CREATE TYPE mbg_region_type AS ENUM ('district', 'division', 'subcounty', 'parish', 'stage');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE mbg_chairperson_role AS ENUM (
    'district_chairperson',
    'division_chairperson',
    'subcounty_chairperson',
    'parish_chairperson',
    'stage_chairperson'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Rename committee_members to mbg_committee_members if needed
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'committee_members') THEN
    IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'mbg_committee_members') THEN
      ALTER TABLE public.committee_members RENAME TO mbg_committee_members;
      RAISE NOTICE 'Renamed committee_members to mbg_committee_members';
    END IF;
  END IF;
END $$;

-- Drop old mbg-specific function if exists
DROP FUNCTION IF EXISTS public.mbg_assign_chairperson CASCADE;

-- Create MyBodaGuy-specific function with unique name
CREATE FUNCTION public.mbg_assign_chairperson(
  target_user_id UUID,
  target_role TEXT,
  target_region_type TEXT,
  target_region_id UUID,
  commission_rate DECIMAL DEFAULT 5.00,
  notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  new_committee_member_id UUID;
  assigner_committee_id UUID;
  typed_role mbg_chairperson_role;
  typed_region mbg_region_type;
BEGIN
  -- Cast TEXT to proper enum types
  typed_role := target_role::mbg_chairperson_role;
  typed_region := target_region_type::mbg_region_type;

  -- Get assigner's committee member ID (if they have one)
  SELECT id INTO assigner_committee_id
  FROM public.mbg_committee_members
  WHERE user_id = auth.uid() AND is_active = true
  LIMIT 1;

  -- Update user role to chairperson
  UPDATE public.mbg_users
  SET role_type = 'chairperson',
      updated_at = NOW()
  WHERE id = target_user_id;

  -- Insert or update committee member
  INSERT INTO public.mbg_committee_members (
    user_id,
    role,
    region_type,
    region_id,
    assigned_by,
    is_active,
    appointed_at
  )
  VALUES (
    target_user_id,
    typed_role,
    typed_region,
    target_region_id,
    auth.uid(),
    TRUE,
    NOW()
  )
  ON CONFLICT (user_id, region_type, region_id) 
  DO UPDATE SET
    role = EXCLUDED.role,
    assigned_by = EXCLUDED.assigned_by,
    is_active = TRUE,
    updated_at = NOW()
  RETURNING id INTO new_committee_member_id;

  RETURN new_committee_member_id;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.mbg_assign_chairperson(UUID, TEXT, TEXT, UUID, DECIMAL, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_assign_chairperson(UUID, TEXT, TEXT, UUID, DECIMAL, TEXT) TO service_role;

COMMIT;

SELECT 'MyBodaGuy function mbg_assign_chairperson created successfully!' as status;
