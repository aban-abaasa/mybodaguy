-- Add Committee Member Details and Functions for MyBodaGuy
-- Run this to enable committee member profiles and subordinate management

-- ==============================================
-- 1. CREATE COMMITTEE_MEMBER_DETAILS TABLE
-- ==============================================

CREATE TABLE IF NOT EXISTS public.committee_member_details (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  committee_member_id UUID NOT NULL REFERENCES public.mbg_committee_members(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  national_id TEXT,
  profile_photo_url TEXT,
  address TEXT,
  alternate_phone TEXT,
  emergency_contact_name TEXT,
  emergency_contact_phone TEXT,
  appointment_letter_url TEXT,
  bio TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(committee_member_id)
);

COMMENT ON TABLE public.committee_member_details IS 'Extended profile information for MyBodaGuy committee members';

-- Enable RLS
ALTER TABLE public.committee_member_details ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS committee_details_read_own ON public.committee_member_details;
DROP POLICY IF EXISTS committee_details_update_own ON public.committee_member_details;
DROP POLICY IF EXISTS committee_details_insert_own ON public.committee_member_details;
DROP POLICY IF EXISTS committee_details_read_authorized ON public.committee_member_details;
DROP POLICY IF EXISTS committee_details_service_role ON public.committee_member_details;

-- Members can read their own details
CREATE POLICY committee_details_read_own ON public.committee_member_details
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.mbg_committee_members cm
      WHERE cm.id = committee_member_id
        AND cm.user_id = auth.uid()
    )
  );

-- Members can insert their own details
CREATE POLICY committee_details_insert_own ON public.committee_member_details
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.mbg_committee_members cm
      WHERE cm.id = committee_member_id
        AND cm.user_id = auth.uid()
    )
  );

-- Members can update their own details
CREATE POLICY committee_details_update_own ON public.committee_member_details
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.mbg_committee_members cm
      WHERE cm.id = committee_member_id
        AND cm.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.mbg_committee_members cm
      WHERE cm.id = committee_member_id
        AND cm.user_id = auth.uid()
    )
  );

-- Developers can read all
CREATE POLICY committee_details_read_authorized ON public.committee_member_details
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.mbg_users
      WHERE id = auth.uid()
        AND role_type = 'developer'
        AND is_active = true
    )
  );

-- Service role has full access
CREATE POLICY committee_details_service_role ON public.committee_member_details
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Create index
CREATE INDEX IF NOT EXISTS committee_member_details_committee_member_idx 
  ON public.committee_member_details(committee_member_id);

-- ==============================================
-- 2. CREATE get_subordinate_chairpersons FUNCTION
-- ==============================================

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

COMMENT ON FUNCTION public.get_subordinate_chairpersons IS 'Get all subordinate chairpersons for a given chairperson';

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.get_subordinate_chairpersons(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_subordinate_chairpersons(UUID) TO service_role;

-- ==============================================
-- 3. ADD MISSING COLUMNS TO mbg_committee_members
-- ==============================================

-- Add parent_chairperson_id if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'mbg_committee_members' 
    AND column_name = 'parent_chairperson_id'
  ) THEN
    ALTER TABLE public.mbg_committee_members 
    ADD COLUMN parent_chairperson_id UUID REFERENCES public.mbg_committee_members(id) ON DELETE SET NULL;
    
    COMMENT ON COLUMN public.mbg_committee_members.parent_chairperson_id IS 'The chairperson who assigned this member (hierarchical relationship)';
  END IF;
END $$;

-- Create index for parent relationships
CREATE INDEX IF NOT EXISTS mbg_committee_members_parent_chairperson_idx 
  ON public.mbg_committee_members(parent_chairperson_id) 
  WHERE is_active = true;

-- ==============================================
-- 4. CREATE HELPER VIEW
-- ==============================================

CREATE OR REPLACE VIEW public.mbg_committee_hierarchy AS
SELECT 
  cm.id,
  cm.user_id,
  u.email,
  COALESCE(cmd.full_name, up.full_name, u.email) as full_name,
  cm.role,
  cm.region_type,
  cm.region_id,
  CASE cm.region_type
    WHEN 'district' THEN (SELECT name FROM public.mbg_districts WHERE id = cm.region_id)
    WHEN 'division' THEN (SELECT name FROM public.mbg_divisions WHERE id = cm.region_id)
    WHEN 'subcounty' THEN (SELECT name FROM public.mbg_subcounties WHERE id = cm.region_id)
    WHEN 'parish' THEN (SELECT name FROM public.mbg_parishes WHERE id = cm.region_id)
    WHEN 'stage' THEN (SELECT name FROM public.mbg_stages WHERE id = cm.region_id)
  END as region_name,
  cm.commission_rate,
  cm.parent_chairperson_id,
  parent_cm.user_id as parent_user_id,
  COALESCE(parent_cmd.full_name, parent_up.full_name, 'Developer') as parent_name,
  cm.assigned_by,
  cm.is_active,
  cm.appointed_at,
  cm.created_at
FROM public.mbg_committee_members cm
INNER JOIN public.mbg_users u ON u.id = cm.user_id
LEFT JOIN public.mbg_user_profiles up ON up.user_id = cm.user_id
LEFT JOIN public.committee_member_details cmd ON cmd.committee_member_id = cm.id
LEFT JOIN public.mbg_committee_members parent_cm ON parent_cm.id = cm.parent_chairperson_id
LEFT JOIN public.mbg_user_profiles parent_up ON parent_up.user_id = parent_cm.user_id
LEFT JOIN public.committee_member_details parent_cmd ON parent_cmd.committee_member_id = parent_cm.id;

COMMENT ON VIEW public.mbg_committee_hierarchy IS 'Complete view of committee member hierarchy with parent relationships';

-- ==============================================
-- VERIFICATION
-- ==============================================

-- Check if everything was created
DO $$
BEGIN
  RAISE NOTICE '✅ Setup Complete!';
  RAISE NOTICE 'Created:';
  RAISE NOTICE '  - committee_member_details table';
  RAISE NOTICE '  - get_subordinate_chairpersons() function';
  RAISE NOTICE '  - mbg_committee_hierarchy view';
  RAISE NOTICE '  - RLS policies';
  RAISE NOTICE '  - Indexes';
END $$;
