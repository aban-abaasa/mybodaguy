-- ==============================================
-- FIX MBG ASSIGN CHAIRPERSON - REMOVE NOTES PARAMETER
-- ==============================================
-- The notes parameter was causing errors since the table doesn't have that column

BEGIN;

-- Drop old function with notes parameter
DROP FUNCTION IF EXISTS public.mbg_assign_chairperson(UUID, TEXT, TEXT, UUID, DECIMAL, TEXT) CASCADE;

-- Recreate function without notes parameter
CREATE OR REPLACE FUNCTION public.mbg_assign_chairperson(
  target_user_id UUID,
  target_role TEXT,
  target_region_type TEXT,
  target_region_id UUID,
  commission_rate DECIMAL DEFAULT 5.00
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
GRANT EXECUTE ON FUNCTION public.mbg_assign_chairperson(UUID, TEXT, TEXT, UUID, DECIMAL) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_assign_chairperson(UUID, TEXT, TEXT, UUID, DECIMAL) TO service_role;

COMMIT;

SELECT 'Function mbg_assign_chairperson fixed - notes parameter removed!' as status;
