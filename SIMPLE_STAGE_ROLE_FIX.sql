-- ==============================================
-- SIMPLE STAGE ROLE FIX
-- ==============================================
-- Every chairperson automatically gets stage chairperson role
-- Uses their existing stage assignment from mbg_riders table

BEGIN;

-- Step 1: Update assignment function - simple version
DROP FUNCTION IF EXISTS public.mbg_assign_chairperson(UUID, TEXT, TEXT, UUID, DECIMAL) CASCADE;

CREATE FUNCTION public.mbg_assign_chairperson(
  target_user_id UUID,
  target_role TEXT,
  target_region_type TEXT,
  target_region_id UUID,
  commission_rate DECIMAL DEFAULT 5.00
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_committee_member_id UUID;
  assigner_committee_id UUID;
  typed_role mbg_chairperson_role;
  typed_region mbg_region_type;
  user_stage_id UUID;
BEGIN
  typed_role := target_role::mbg_chairperson_role;
  typed_region := target_region_type::mbg_region_type;

  -- Get assigner's committee_member id
  SELECT id INTO assigner_committee_id
  FROM public.mbg_committee_members
  WHERE user_id = auth.uid() AND is_active = true
  LIMIT 1;

  -- Update user to chairperson
  UPDATE public.mbg_users
  SET role_type = 'chairperson', updated_at = NOW()
  WHERE id = target_user_id;

  -- Insert PRIMARY role
  INSERT INTO public.mbg_committee_members (
    user_id, role, region_type, region_id, assigned_by, 
    parent_chairperson_id, commission_rate, is_active, appointed_at
  )
  VALUES (
    target_user_id, typed_role, typed_region, target_region_id, 
    auth.uid(), assigner_committee_id, commission_rate, true, NOW()
  )
  ON CONFLICT (user_id, region_type, region_id) 
  DO UPDATE SET
    role = EXCLUDED.role,
    assigned_by = EXCLUDED.assigned_by,
    parent_chairperson_id = EXCLUDED.parent_chairperson_id,
    commission_rate = EXCLUDED.commission_rate,
    is_active = true,
    updated_at = NOW()
  RETURNING id INTO new_committee_member_id;

  -- Add STAGE role (if not already stage chairperson)
  IF typed_role != 'stage_chairperson'::mbg_chairperson_role THEN
    -- Get user's stage from mbg_riders table (they're already riders)
    SELECT stage_id INTO user_stage_id
    FROM public.mbg_riders
    WHERE user_id = target_user_id AND status = 'active'
    LIMIT 1;

    -- If they have a stage, add stage chairperson role
    IF user_stage_id IS NOT NULL THEN
      INSERT INTO public.mbg_committee_members (
        user_id, role, region_type, region_id, assigned_by,
        parent_chairperson_id, commission_rate, is_active, appointed_at
      )
      VALUES (
        target_user_id, 'stage_chairperson'::mbg_chairperson_role, 
        'stage'::mbg_region_type, user_stage_id, auth.uid(),
        assigner_committee_id, commission_rate, true, NOW()
      )
      ON CONFLICT (user_id, region_type, region_id) 
      DO UPDATE SET is_active = true, updated_at = NOW();
    END IF;
  END IF;

  RETURN new_committee_member_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mbg_assign_chairperson(UUID, TEXT, TEXT, UUID, DECIMAL) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_assign_chairperson(UUID, TEXT, TEXT, UUID, DECIMAL) TO service_role;

-- Step 2: Fix existing chairpersons - add stage role based on their rider record
DO $$
DECLARE
  chairperson RECORD;
  user_stage_id UUID;
BEGIN
  FOR chairperson IN
    SELECT DISTINCT cm.user_id, cm.assigned_by, cm.parent_chairperson_id, cm.commission_rate
    FROM mbg_committee_members cm
    WHERE cm.is_active = true
      AND cm.role != 'stage_chairperson'::mbg_chairperson_role
      AND NOT EXISTS (
        SELECT 1 FROM mbg_committee_members cm2
        WHERE cm2.user_id = cm.user_id
          AND cm2.role = 'stage_chairperson'::mbg_chairperson_role
          AND cm2.is_active = true
      )
  LOOP
    -- Get their stage from mbg_riders
    SELECT stage_id INTO user_stage_id
    FROM mbg_riders
    WHERE user_id = chairperson.user_id AND status = 'active'
    LIMIT 1;

    IF user_stage_id IS NOT NULL THEN
      INSERT INTO mbg_committee_members (
        user_id, role, region_type, region_id, assigned_by,
        parent_chairperson_id, commission_rate, is_active, appointed_at
      )
      VALUES (
        chairperson.user_id, 'stage_chairperson'::mbg_chairperson_role,
        'stage'::mbg_region_type, user_stage_id, chairperson.assigned_by,
        chairperson.parent_chairperson_id, chairperson.commission_rate, true, NOW()
      )
      ON CONFLICT (user_id, region_type, region_id) DO NOTHING;
    END IF;
  END LOOP;
END $$;

COMMIT;

-- Show result
SELECT 
  'DONE!' as status,
  COUNT(*) as total_roles,
  COUNT(CASE WHEN role = 'stage_chairperson' THEN 1 END) as stage_roles
FROM mbg_committee_members
WHERE is_active = true;
