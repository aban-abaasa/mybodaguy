-- My Boda Guy - Committee Members
-- Chairpersons at different hierarchy levels

CREATE TYPE region_type AS ENUM ('district', 'division', 'subcounty', 'parish', 'stage');
CREATE TYPE chairperson_role AS ENUM (
  'district_chairperson',
  'division_chairperson',
  'subcounty_chairperson',
  'parish_chairperson',
  'stage_chairperson'
);

CREATE TABLE IF NOT EXISTS public.committee_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role chairperson_role NOT NULL,
  region_type region_type NOT NULL,
  region_id UUID NOT NULL,
  assigned_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  appointed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, region_type, region_id)
);

ALTER TABLE public.committee_members ENABLE ROW LEVEL SECURITY;

-- Committee members can read their own record
DROP POLICY IF EXISTS committee_members_read_own ON public.committee_members;
CREATE POLICY committee_members_read_own ON public.committee_members
  FOR SELECT
  USING (auth.uid() = user_id);

-- Higher-level chairpersons can read their subordinates
DROP POLICY IF EXISTS committee_members_read_superior ON public.committee_members;
CREATE POLICY committee_members_read_superior ON public.committee_members
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.committee_members superior
      WHERE superior.user_id = auth.uid()
        AND superior.is_active = true
    )
  );

-- Developers can read all committee members
DROP POLICY IF EXISTS committee_members_read_developer ON public.committee_members;
CREATE POLICY committee_members_read_developer ON public.committee_members
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
        AND role_type = 'developer'
        AND is_active = true
    )
  );

-- Only developers and higher-level chairpersons can assign committee members
DROP POLICY IF EXISTS committee_members_insert_authorized ON public.committee_members;
CREATE POLICY committee_members_insert_authorized ON public.committee_members
  FOR INSERT
  WITH CHECK (
    -- Developers can assign anyone
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
        AND role_type = 'developer'
        AND is_active = true
    )
    OR
    -- Chairpersons can assign lower-level chairpersons in their region
    (
      assigned_by = auth.uid()
      AND EXISTS (
        SELECT 1 FROM public.committee_members
        WHERE user_id = auth.uid()
          AND is_active = true
      )
    )
  );

-- Only developers and assigners can update committee members
DROP POLICY IF EXISTS committee_members_update_authorized ON public.committee_members;
CREATE POLICY committee_members_update_authorized ON public.committee_members
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
        AND role_type = 'developer'
        AND is_active = true
    )
    OR assigned_by = auth.uid()
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
        AND role_type = 'developer'
        AND is_active = true
    )
    OR assigned_by = auth.uid()
  );

-- Service role has full access
DROP POLICY IF EXISTS committee_members_service_role ON public.committee_members;
CREATE POLICY committee_members_service_role ON public.committee_members
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS committee_members_user_id_idx ON public.committee_members(user_id);
CREATE INDEX IF NOT EXISTS committee_members_role_idx ON public.committee_members(role);
CREATE INDEX IF NOT EXISTS committee_members_region_idx ON public.committee_members(region_type, region_id);
CREATE INDEX IF NOT EXISTS committee_members_assigned_by_idx ON public.committee_members(assigned_by);
CREATE INDEX IF NOT EXISTS committee_members_is_active_idx ON public.committee_members(is_active);

COMMIT;
