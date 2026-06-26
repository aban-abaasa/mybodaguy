-- ==============================================
-- AUTO ADD STAGE CHAIRPERSON ROLE
-- ==============================================
-- Every chairperson automatically gets a stage chairperson role
-- This allows all chairpersons to manage riders at stage level

BEGIN;

-- Update the assignment function to automatically add stage role
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
  stage_id UUID;
BEGIN
  -- Cast to enum types
  typed_role := target_role::mbg_chairperson_role;
  typed_region := target_region_type::mbg_region_type;

  -- Get the current user's committee_member id (becomes parent)
  SELECT id INTO assigner_committee_id
  FROM public.mbg_committee_members
  WHERE user_id = auth.uid() 
    AND is_active = true
  LIMIT 1;

  -- Update user to be a chairperson
  UPDATE public.mbg_users
  SET role_type = 'chairperson',
      updated_at = NOW()
  WHERE id = target_user_id;

  -- Insert or update the PRIMARY committee member record (the assigned role)
  INSERT INTO public.mbg_committee_members (
    user_id,
    role,
    region_type,
    region_id,
    assigned_by,
    parent_chairperson_id,
    commission_rate,
    is_active,
    appointed_at
  )
  VALUES (
    target_user_id,
    typed_role,
    typed_region,
    target_region_id,
    auth.uid(),
    assigner_committee_id,
    commission_rate,
    true,
    NOW()
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

  -- If the assigned role is NOT stage_chairperson, also add them as stage_chairperson
  -- This ensures EVERY chairperson can manage riders at stage level
  IF typed_role != 'stage_chairperson'::mbg_chairperson_role THEN
    -- Find a stage in their region to assign them to
    -- Logic: Get first active stage under their region
    CASE typed_region
      WHEN 'district'::mbg_region_type THEN
        -- District chairperson: get a stage from any division in their district
        SELECT s.id INTO stage_id
        FROM mbg_stages s
        INNER JOIN mbg_parishes p ON p.id = s.parish_id
        INNER JOIN mbg_subcounties sc ON sc.id = p.subcounty_id
        INNER JOIN mbg_divisions d ON d.id = sc.division_id
        WHERE d.district_id = target_region_id
          AND s.is_active = true
        LIMIT 1;
        
      WHEN 'division'::mbg_region_type THEN
        -- Division chairperson: get a stage from any subcounty in their division
        SELECT s.id INTO stage_id
        FROM mbg_stages s
        INNER JOIN mbg_parishes p ON p.id = s.parish_id
        INNER JOIN mbg_subcounties sc ON sc.id = p.subcounty_id
        WHERE sc.division_id = target_region_id
          AND s.is_active = true
        LIMIT 1;
        
      WHEN 'subcounty'::mbg_region_type THEN
        -- Subcounty chairperson: get a stage from any parish in their subcounty
        SELECT s.id INTO stage_id
        FROM mbg_stages s
        INNER JOIN mbg_parishes p ON p.id = s.parish_id
        WHERE p.subcounty_id = target_region_id
          AND s.is_active = true
        LIMIT 1;
        
      WHEN 'parish'::mbg_region_type THEN
        -- Parish chairperson: get a stage from their parish
        SELECT id INTO stage_id
        FROM mbg_stages
        WHERE parish_id = target_region_id
          AND is_active = true
        LIMIT 1;
        
      ELSE
        stage_id := NULL;
    END CASE;

    -- If we found a stage, assign them as stage chairperson too
    IF stage_id IS NOT NULL THEN
      INSERT INTO public.mbg_committee_members (
        user_id,
        role,
        region_type,
        region_id,
        assigned_by,
        parent_chairperson_id,
        commission_rate,
        is_active,
        appointed_at
      )
      VALUES (
        target_user_id,
        'stage_chairperson'::mbg_chairperson_role,
        'stage'::mbg_region_type,
        stage_id,
        auth.uid(),
        assigner_committee_id,
        commission_rate,
        true,
        NOW()
      )
      ON CONFLICT (user_id, region_type, region_id) 
      DO UPDATE SET
        is_active = true,
        updated_at = NOW();
    END IF;
  END IF;

  RETURN new_committee_member_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mbg_assign_chairperson(UUID, TEXT, TEXT, UUID, DECIMAL) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_assign_chairperson(UUID, TEXT, TEXT, UUID, DECIMAL) TO service_role;

COMMIT;

SELECT 
  'SUCCESS: Every chairperson now automatically gets stage role!' as status,
  'They can manage riders at stage level' as message;
