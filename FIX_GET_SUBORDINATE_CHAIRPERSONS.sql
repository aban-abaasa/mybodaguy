-- Fix ambiguous column reference in get_subordinate_chairpersons function
-- Make all column references explicit with table aliases

CREATE OR REPLACE FUNCTION public.get_subordinate_chairpersons(
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
AS $$
DECLARE
  chairperson_committee_id UUID;
BEGIN
  -- Get the chairperson's committee member ID
  SELECT cm.id INTO chairperson_committee_id
  FROM public.mbg_committee_members cm
  WHERE cm.user_id = chairperson_user_id
    AND cm.is_active = true
  LIMIT 1;

  IF chairperson_committee_id IS NULL THEN
    -- Return empty result instead of raising exception
    RETURN;
  END IF;

  RETURN QUERY
  SELECT 
    cm.id AS id,
    cm.user_id AS user_id,
    COALESCE(cmd.full_name, up.full_name, u.email) as full_name,
    u.email AS email,
    COALESCE(cmd.alternate_phone, up.phone, '') as phone,
    cm.role AS role,
    cm.region_type AS region_type,
    cm.region_id AS region_id,
    CASE cm.region_type
      WHEN 'district' THEN (SELECT d.name FROM public.mbg_districts d WHERE d.id = cm.region_id)
      WHEN 'division' THEN (SELECT dv.name FROM public.mbg_divisions dv WHERE dv.id = cm.region_id)
      WHEN 'subcounty' THEN (SELECT sc.name FROM public.mbg_subcounties sc WHERE sc.id = cm.region_id)
      WHEN 'parish' THEN (SELECT p.name FROM public.mbg_parishes p WHERE p.id = cm.region_id)
      WHEN 'stage' THEN (SELECT s.name FROM public.mbg_stages s WHERE s.id = cm.region_id)
      ELSE 'Unknown Region'
    END as region_name,
    cm.commission_rate AS commission_rate,
    cm.is_active AS is_active,
    cm.appointed_at AS appointed_at
  FROM public.mbg_committee_members cm
  INNER JOIN public.mbg_users u ON u.id = cm.user_id
  LEFT JOIN public.mbg_user_profiles up ON up.user_id = cm.user_id
  LEFT JOIN public.committee_member_details cmd ON cmd.committee_member_id = cm.id
  WHERE cm.parent_chairperson_id = chairperson_committee_id
  ORDER BY cm.appointed_at DESC;
END;
$$;

COMMENT ON FUNCTION public.get_subordinate_chairpersons IS 'Get all subordinate chairpersons for a given chairperson (MyBodaGuy specific)';

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.get_subordinate_chairpersons(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_subordinate_chairpersons(UUID) TO service_role;

-- Test the function (optional - comment out if not needed)
-- SELECT * FROM get_subordinate_chairpersons('your-user-id-here');
