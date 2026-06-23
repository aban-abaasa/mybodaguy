-- ==============================================
-- CHECK AND FIX TABLE NAMING
-- ==============================================
-- This checks which table exists and creates an alias if needed

BEGIN;

-- Check if mbg_committee_members exists, if not create view
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'mbg_committee_members') THEN
    -- If mbg_committee_members doesn't exist but committee_members does, rename it
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'committee_members') THEN
      ALTER TABLE public.committee_members RENAME TO mbg_committee_members;
      RAISE NOTICE 'Renamed committee_members to mbg_committee_members';
    ELSE
      RAISE EXCEPTION 'Neither committee_members nor mbg_committee_members table exists!';
    END IF;
  END IF;
END $$;

-- Update the assign_chairperson function to use the correct table name
DROP FUNCTION IF EXISTS public.assign_chairperson(UUID, chairperson_role, region_type, UUID, DECIMAL, TEXT);

CREATE OR REPLACE FUNCTION public.assign_chairperson(
  target_user_id UUID,
  target_role chairperson_role,
  target_region_type region_type,
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
BEGIN
  -- Get assigner's committee member ID for parent relationship
  SELECT id INTO assigner_committee_id
  FROM public.mbg_committee_members
  WHERE user_id = auth.uid() AND is_active = true
  LIMIT 1;

  -- Update user role to chairperson if not already
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
    is_active
  )
  VALUES (
    target_user_id,
    target_role,
    target_region_type,
    target_region_id,
    auth.uid(),
    TRUE
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
GRANT EXECUTE ON FUNCTION public.assign_chairperson(UUID, chairperson_role, region_type, UUID, DECIMAL, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_chairperson(UUID, chairperson_role, region_type, UUID, DECIMAL, TEXT) TO service_role;

COMMIT;

-- Test
SELECT 'Setup complete!' as status;
