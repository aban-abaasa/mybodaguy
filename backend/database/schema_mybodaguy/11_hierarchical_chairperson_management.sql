-- My Boda Guy - Hierarchical Chairperson Management
-- Enable Regional/District Chairpersons to assign District/Lower-level Chairpersons
-- And allow them to create profiles with committee members

-- ==============================================
-- 1. ENHANCED COMMITTEE MEMBERS TABLE
-- ==============================================

-- Add fields to support hierarchy and profile management
ALTER TABLE public.committee_members 
ADD COLUMN IF NOT EXISTS parent_chairperson_id UUID REFERENCES public.committee_members(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS commission_rate DECIMAL(5,2) DEFAULT 5.00 CHECK (commission_rate >= 0 AND commission_rate <= 100),
ADD COLUMN IF NOT EXISTS notes TEXT,
ADD COLUMN IF NOT EXISTS phone TEXT,
ADD COLUMN IF NOT EXISTS alternate_email TEXT;

COMMENT ON COLUMN public.committee_members.parent_chairperson_id IS 'The chairperson who assigned this member (hierarchical relationship)';
COMMENT ON COLUMN public.committee_members.commission_rate IS 'Commission percentage this chairperson earns from riders in their region';

-- ==============================================
-- 2. COMMITTEE MEMBER DETAILS (Extended Profile)
-- ==============================================

CREATE TABLE IF NOT EXISTS public.committee_member_details (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  committee_member_id UUID NOT NULL REFERENCES public.committee_members(id) ON DELETE CASCADE,
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

ALTER TABLE public.committee_member_details ENABLE ROW LEVEL SECURITY;

-- Members can read their own details
DROP POLICY IF EXISTS committee_details_read_own ON public.committee_member_details;
CREATE POLICY committee_details_read_own ON public.committee_member_details
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.committee_members cm
      WHERE cm.id = committee_member_id
        AND cm.user_id = auth.uid()
    )
  );

-- Members can update their own details
DROP POLICY IF EXISTS committee_details_update_own ON public.committee_member_details;
CREATE POLICY committee_details_update_own ON public.committee_member_details
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.committee_members cm
      WHERE cm.id = committee_member_id
        AND cm.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.committee_members cm
      WHERE cm.id = committee_member_id
        AND cm.user_id = auth.uid()
    )
  );

-- Developers and parent chairpersons can read
DROP POLICY IF EXISTS committee_details_read_authorized ON public.committee_member_details;
CREATE POLICY committee_details_read_authorized ON public.committee_member_details
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.mbg_users
      WHERE id = auth.uid()
        AND role_type = 'developer'
        AND is_active = true
    )
    OR
    EXISTS (
      SELECT 1 FROM public.committee_members cm
      INNER JOIN public.committee_members parent 
        ON parent.id = cm.parent_chairperson_id
      WHERE cm.id = committee_member_id
        AND parent.user_id = auth.uid()
        AND parent.is_active = true
    )
  );

-- Service role has full access
DROP POLICY IF EXISTS committee_details_service_role ON public.committee_member_details;
CREATE POLICY committee_details_service_role ON public.committee_member_details
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ==============================================
-- 3. FUNCTIONS FOR HIERARCHICAL ASSIGNMENT
-- ==============================================

-- Function to check if a user can assign chairpersons at a specific level
CREATE OR REPLACE FUNCTION public.can_assign_chairperson(
  assigner_user_id UUID,
  target_region_type region_type,
  target_region_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  assigner_role chairperson_role;
  assigner_region_type region_type;
  assigner_region_id UUID;
  is_developer BOOLEAN;
BEGIN
  -- Check if assigner is developer
  SELECT role_type = 'developer' INTO is_developer
  FROM public.mbg_users
  WHERE id = assigner_user_id AND is_active = true;
  
  IF is_developer THEN
    RETURN TRUE; -- Developers can assign anyone
  END IF;

  -- Get assigner's committee role
  SELECT role, region_type, region_id 
  INTO assigner_role, assigner_region_type, assigner_region_id
  FROM public.committee_members
  WHERE user_id = assigner_user_id 
    AND is_active = true
  LIMIT 1;

  IF assigner_role IS NULL THEN
    RETURN FALSE; -- Not a chairperson
  END IF;

  -- Hierarchical assignment rules:
  -- District chairpersons can assign division chairpersons in their district
  IF assigner_role = 'district_chairperson' AND assigner_region_type = 'district' THEN
    IF target_region_type = 'division' THEN
      -- Check if target division belongs to assigner's district
      RETURN EXISTS (
        SELECT 1 FROM public.divisions
        WHERE id = target_region_id
          AND district_id = assigner_region_id
      );
    END IF;
  END IF;

  -- Division chairpersons can assign subcounty chairpersons in their division
  IF assigner_role = 'division_chairperson' AND assigner_region_type = 'division' THEN
    IF target_region_type = 'subcounty' THEN
      RETURN EXISTS (
        SELECT 1 FROM public.subcounties
        WHERE id = target_region_id
          AND division_id = assigner_region_id
      );
    END IF;
  END IF;

  -- Subcounty chairpersons can assign parish chairpersons in their subcounty
  IF assigner_role = 'subcounty_chairperson' AND assigner_region_type = 'subcounty' THEN
    IF target_region_type = 'parish' THEN
      RETURN EXISTS (
        SELECT 1 FROM public.parishes
        WHERE id = target_region_id
          AND subcounty_id = assigner_region_id
      );
    END IF;
  END IF;

  -- Parish chairpersons can assign stage chairpersons in their parish
  IF assigner_role = 'parish_chairperson' AND assigner_region_type = 'parish' THEN
    IF target_region_type = 'stage' THEN
      RETURN EXISTS (
        SELECT 1 FROM public.stages
        WHERE id = target_region_id
          AND parish_id = assigner_region_id
      );
    END IF;
  END IF;

  RETURN FALSE;
END;
$$;

-- Function to assign a chairperson with validation
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
  -- Validate that assigner can assign this chairperson
  IF NOT public.can_assign_chairperson(auth.uid(), target_region_type, target_region_id) THEN
    RAISE EXCEPTION 'You do not have permission to assign a chairperson at this level';
  END IF;

  -- Get assigner's committee member ID for parent relationship
  SELECT id INTO assigner_committee_id
  FROM public.committee_members
  WHERE user_id = auth.uid() AND is_active = true
  LIMIT 1;

  -- Update user role to chairperson if not already
  UPDATE public.mbg_users
  SET role_type = 'chairperson',
      updated_at = NOW()
  WHERE id = target_user_id;

  -- Insert or update committee member
  INSERT INTO public.committee_members (
    user_id,
    role,
    region_type,
    region_id,
    assigned_by,
    parent_chairperson_id,
    commission_rate,
    notes,
    is_active
  )
  VALUES (
    target_user_id,
    target_role,
    target_region_type,
    target_region_id,
    auth.uid(),
    assigner_committee_id,
    commission_rate,
    notes,
    TRUE
  )
  ON CONFLICT (user_id, region_type, region_id) 
  DO UPDATE SET
    role = EXCLUDED.role,
    assigned_by = EXCLUDED.assigned_by,
    parent_chairperson_id = EXCLUDED.parent_chairperson_id,
    commission_rate = EXCLUDED.commission_rate,
    notes = EXCLUDED.notes,
    is_active = TRUE,
    updated_at = NOW()
  RETURNING id INTO new_committee_member_id;

  RETURN new_committee_member_id;
END;
$$;

-- Function to get all subordinate chairpersons for a given chairperson
CREATE OR REPLACE FUNCTION public.get_subordinate_chairpersons(
  chairperson_user_id UUID
)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  full_name TEXT,
  email TEXT,
  phone TEXT,
  role chairperson_role,
  region_type region_type,
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
  FROM public.committee_members cm
  WHERE cm.user_id = chairperson_user_id
    AND cm.is_active = true
  LIMIT 1;

  IF chairperson_committee_id IS NULL THEN
    RAISE EXCEPTION 'User is not an active chairperson';
  END IF;

  RETURN QUERY
  SELECT 
    cm.id,
    cm.user_id,
    COALESCE(cmd.full_name, up.full_name, 'Unknown') as full_name,
    u.email,
    COALESCE(cmd.alternate_phone, cm.phone, u.phone) as phone,
    cm.role,
    cm.region_type,
    cm.region_id,
    CASE cm.region_type
      WHEN 'district' THEN (SELECT name FROM public.districts WHERE id = cm.region_id)
      WHEN 'division' THEN (SELECT name FROM public.divisions WHERE id = cm.region_id)
      WHEN 'subcounty' THEN (SELECT name FROM public.subcounties WHERE id = cm.region_id)
      WHEN 'parish' THEN (SELECT name FROM public.parishes WHERE id = cm.region_id)
      WHEN 'stage' THEN (SELECT name FROM public.stages WHERE id = cm.region_id)
    END as region_name,
    cm.commission_rate,
    cm.is_active,
    cm.appointed_at
  FROM public.committee_members cm
  INNER JOIN public.mbg_users u ON u.id = cm.user_id
  LEFT JOIN public.mbg_user_profiles up ON up.user_id = cm.user_id
  LEFT JOIN public.committee_member_details cmd ON cmd.committee_member_id = cm.id
  WHERE cm.parent_chairperson_id = chairperson_committee_id
  ORDER BY cm.appointed_at DESC;
END;
$$;

-- ==============================================
-- 4. UPDATE RLS POLICIES FOR HIERARCHICAL ACCESS
-- ==============================================

-- Update committee_members policies to support hierarchical relationships

-- Chairpersons can insert subordinates they're authorized to assign
DROP POLICY IF EXISTS committee_members_insert_authorized ON public.committee_members;
CREATE POLICY committee_members_insert_authorized ON public.committee_members
  FOR INSERT
  WITH CHECK (
    -- Developers can assign anyone
    EXISTS (
      SELECT 1 FROM public.mbg_users
      WHERE id = auth.uid()
        AND role_type = 'developer'
        AND is_active = true
    )
    OR
    -- Use the validation function
    public.can_assign_chairperson(auth.uid(), region_type, region_id)
  );

-- Chairpersons can read their direct subordinates
DROP POLICY IF EXISTS committee_members_read_subordinates ON public.committee_members;
CREATE POLICY committee_members_read_subordinates ON public.committee_members
  FOR SELECT
  USING (
    -- Can read own record
    auth.uid() = user_id
    OR
    -- Developers can read all
    EXISTS (
      SELECT 1 FROM public.mbg_users
      WHERE id = auth.uid()
        AND role_type = 'developer'
        AND is_active = true
    )
    OR
    -- Can read direct subordinates
    EXISTS (
      SELECT 1 FROM public.committee_members parent
      WHERE parent.user_id = auth.uid()
        AND parent.id = committee_members.parent_chairperson_id
        AND parent.is_active = true
    )
  );

-- Chairpersons can update their subordinates' status
DROP POLICY IF EXISTS committee_members_update_authorized ON public.committee_members;
CREATE POLICY committee_members_update_authorized ON public.committee_members
  FOR UPDATE
  USING (
    -- Developers can update anyone
    EXISTS (
      SELECT 1 FROM public.mbg_users
      WHERE id = auth.uid()
        AND role_type = 'developer'
        AND is_active = true
    )
    OR
    -- Parent chairperson can update
    EXISTS (
      SELECT 1 FROM public.committee_members parent
      WHERE parent.user_id = auth.uid()
        AND parent.id = committee_members.parent_chairperson_id
        AND parent.is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.mbg_users
      WHERE id = auth.uid()
        AND role_type = 'developer'
        AND is_active = true
    )
    OR
    EXISTS (
      SELECT 1 FROM public.committee_members parent
      WHERE parent.user_id = auth.uid()
        AND parent.id = committee_members.parent_chairperson_id
        AND parent.is_active = true
    )
  );

-- ==============================================
-- 5. INDEXES FOR PERFORMANCE
-- ==============================================

CREATE INDEX IF NOT EXISTS committee_members_parent_chairperson_idx 
  ON public.committee_members(parent_chairperson_id) 
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS committee_member_details_committee_member_idx 
  ON public.committee_member_details(committee_member_id);

-- ==============================================
-- 6. HELPER VIEWS FOR EASY QUERYING
-- ==============================================

-- View showing full committee hierarchy
CREATE OR REPLACE VIEW public.committee_hierarchy AS
SELECT 
  cm.id,
  cm.user_id,
  u.email,
  COALESCE(cmd.full_name, up.full_name, 'Unknown') as full_name,
  cm.role,
  cm.region_type,
  cm.region_id,
  CASE cm.region_type
    WHEN 'district' THEN (SELECT name FROM public.districts WHERE id = cm.region_id)
    WHEN 'division' THEN (SELECT name FROM public.divisions WHERE id = cm.region_id)
    WHEN 'subcounty' THEN (SELECT name FROM public.subcounties WHERE id = cm.region_id)
    WHEN 'parish' THEN (SELECT name FROM public.parishes WHERE id = cm.region_id)
    WHEN 'stage' THEN (SELECT name FROM public.stages WHERE id = cm.region_id)
  END as region_name,
  cm.commission_rate,
  cm.parent_chairperson_id,
  parent_cm.user_id as parent_user_id,
  COALESCE(parent_cmd.full_name, parent_up.full_name, 'Developer') as parent_name,
  cm.assigned_by,
  cm.is_active,
  cm.appointed_at,
  cm.created_at
FROM public.committee_members cm
INNER JOIN public.mbg_users u ON u.id = cm.user_id
LEFT JOIN public.mbg_user_profiles up ON up.user_id = cm.user_id
LEFT JOIN public.committee_member_details cmd ON cmd.committee_member_id = cm.id
LEFT JOIN public.committee_members parent_cm ON parent_cm.id = cm.parent_chairperson_id
LEFT JOIN public.mbg_user_profiles parent_up ON parent_up.user_id = parent_cm.user_id
LEFT JOIN public.committee_member_details parent_cmd ON parent_cmd.committee_member_id = parent_cm.id;

COMMENT ON VIEW public.committee_hierarchy IS 'Complete view of committee member hierarchy with parent relationships';

COMMIT;
