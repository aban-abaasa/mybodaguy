-- ==============================================
-- CLEAN FIX FOR CHAIRPERSON ASSIGNMENT
-- ==============================================
-- Simple, clean fix focusing on the hierarchy issue

BEGIN;

-- Step 1: Drop ALL versions of the function to start clean
DROP FUNCTION IF EXISTS public.mbg_assign_chairperson(UUID, TEXT, TEXT, UUID, DECIMAL, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.mbg_assign_chairperson(UUID, TEXT, TEXT, UUID, DECIMAL) CASCADE;
DROP FUNCTION IF EXISTS public.mbg_assign_chairperson(UUID, TEXT, TEXT, UUID) CASCADE;

-- Step 2: Ensure the table has the columns we need
DO $$ 
BEGIN
  -- Add parent_chairperson_id if missing (for hierarchy)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'mbg_committee_members' 
    AND column_name = 'parent_chairperson_id'
  ) THEN
    ALTER TABLE public.mbg_committee_members 
    ADD COLUMN parent_chairperson_id UUID REFERENCES public.mbg_committee_members(id) ON DELETE SET NULL;
  END IF;

  -- Add commission_rate if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'mbg_committee_members' 
    AND column_name = 'commission_rate'
  ) THEN
    ALTER TABLE public.mbg_committee_members 
    ADD COLUMN commission_rate DECIMAL(5,2) DEFAULT 5.00;
  END IF;
END $$;

-- Step 3: Create index for parent lookups
CREATE INDEX IF NOT EXISTS mbg_committee_members_parent_idx 
  ON public.mbg_committee_members(parent_chairperson_id) 
  WHERE parent_chairperson_id IS NOT NULL;

-- Step 4: Create ONE clean version of the assignment function
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

  -- Insert or update the committee member record
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

  RETURN new_committee_member_id;
END;
$$;

-- Step 5: Grant permissions
GRANT EXECUTE ON FUNCTION public.mbg_assign_chairperson(UUID, TEXT, TEXT, UUID, DECIMAL) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_assign_chairperson(UUID, TEXT, TEXT, UUID, DECIMAL) TO service_role;

-- Step 6: Update RLS policy to allow reading subordinates
DROP POLICY IF EXISTS mbg_committee_members_read_subordinates ON public.mbg_committee_members;
CREATE POLICY mbg_committee_members_read_subordinates ON public.mbg_committee_members
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.mbg_committee_members parent
      WHERE parent.user_id = auth.uid()
        AND parent.id = mbg_committee_members.parent_chairperson_id
        AND parent.is_active = true
    )
  );

-- Step 7: Recreate the get_subordinate_chairpersons function
DROP FUNCTION IF EXISTS public.get_subordinate_chairpersons(UUID) CASCADE;

CREATE FUNCTION public.get_subordinate_chairpersons(
  chairperson_user_id UUID
)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  full_name TEXT,
  email TEXT,
  phone TEXT,
  role mbg_chairperson_role,
  region_type mbg_region_type,
  region_id UUID,
  region_name TEXT,
  commission_rate DECIMAL,
  is_active BOOLEAN,
  appointed_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  chairperson_committee_id UUID;
BEGIN
  -- Get this chairperson's committee_member id
  SELECT cm.id INTO chairperson_committee_id
  FROM public.mbg_committee_members cm
  WHERE cm.user_id = chairperson_user_id
    AND cm.is_active = true
  LIMIT 1;

  IF chairperson_committee_id IS NULL THEN
    RETURN; -- Return empty result
  END IF;

  -- Return all subordinates where parent_chairperson_id matches
  RETURN QUERY
  SELECT 
    cm.id,
    cm.user_id,
    COALESCE(up.full_name, u.email) as full_name,
    u.email,
    COALESCE(up.phone, '') as phone,
    cm.role,
    cm.region_type,
    cm.region_id,
    CASE cm.region_type
      WHEN 'district'::mbg_region_type THEN (SELECT d.name FROM public.mbg_districts d WHERE d.id = cm.region_id)
      WHEN 'division'::mbg_region_type THEN (SELECT dv.name FROM public.mbg_divisions dv WHERE dv.id = cm.region_id)
      WHEN 'subcounty'::mbg_region_type THEN (SELECT sc.name FROM public.mbg_subcounties sc WHERE sc.id = cm.region_id)
      WHEN 'parish'::mbg_region_type THEN (SELECT p.name FROM public.mbg_parishes p WHERE p.id = cm.region_id)
      WHEN 'stage'::mbg_region_type THEN (SELECT s.name FROM public.mbg_stages s WHERE s.id = cm.region_id)
      ELSE 'Unknown'
    END as region_name,
    COALESCE(cm.commission_rate, 5.00) as commission_rate,
    cm.is_active,
    cm.appointed_at
  FROM public.mbg_committee_members cm
  INNER JOIN public.mbg_users u ON u.id = cm.user_id
  LEFT JOIN public.mbg_user_profiles up ON up.user_id = cm.user_id
  WHERE cm.parent_chairperson_id = chairperson_committee_id
    AND cm.is_active = true
  ORDER BY cm.appointed_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_subordinate_chairpersons(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_subordinate_chairpersons(UUID) TO service_role;

COMMIT;

SELECT 
  'SUCCESS!' as status,
  'Assignment function cleaned and recreated' as message,
  'Hierarchy tracking enabled via parent_chairperson_id' as note;
