-- ============================================================================
-- Chairperson profile team members
-- Authenticated users only; managed by the chairperson who owns the profile.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.mbg_committee_profile_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  committee_member_id UUID NOT NULL REFERENCES public.mbg_committee_members(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  committee_role TEXT NOT NULL CHECK (char_length(trim(committee_role)) BETWEEN 2 AND 80),
  commission_rate NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (commission_rate >= 0 AND commission_rate <= 100),
  is_active BOOLEAN NOT NULL DEFAULT true,
  added_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (committee_member_id, user_id)
);

ALTER TABLE public.mbg_committee_profile_members
  ADD COLUMN IF NOT EXISTS commission_rate NUMERIC(5,2) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'mbg_committee_profile_members_commission_rate_check'
  ) THEN
    ALTER TABLE public.mbg_committee_profile_members
      ADD CONSTRAINT mbg_committee_profile_members_commission_rate_check
      CHECK (commission_rate >= 0 AND commission_rate <= 100);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS mbg_committee_profile_members_committee_idx
  ON public.mbg_committee_profile_members(committee_member_id, is_active);

-- The 10-member limit belongs to the chairperson profile working team.
CREATE OR REPLACE FUNCTION public.enforce_committee_profile_member_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_active AND NOT EXISTS (
    SELECT 1
      FROM public.mbg_committee_profile_members existing
     WHERE existing.committee_member_id = NEW.committee_member_id
       AND existing.is_active = true
       AND existing.user_id = NEW.user_id
       AND existing.id <> NEW.id
  ) AND (
    SELECT COUNT(*)
      FROM public.mbg_committee_profile_members existing
     WHERE existing.committee_member_id = NEW.committee_member_id
       AND existing.is_active = true
  ) >= 10 THEN
    RAISE EXCEPTION 'Each chairperson profile may have a maximum of 10 active working committee members';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS committee_profile_member_limit ON public.mbg_committee_profile_members;
CREATE TRIGGER committee_profile_member_limit
BEFORE INSERT OR UPDATE OF committee_member_id, user_id, is_active
ON public.mbg_committee_profile_members
FOR EACH ROW
EXECUTE FUNCTION public.enforce_committee_profile_member_limit();

ALTER TABLE public.mbg_committee_profile_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS committee_profile_members_read ON public.mbg_committee_profile_members;
CREATE POLICY committee_profile_members_read ON public.mbg_committee_profile_members
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.mbg_committee_members cm
       WHERE cm.id = committee_member_id
         AND cm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS committee_profile_members_manage ON public.mbg_committee_profile_members;
CREATE POLICY committee_profile_members_manage ON public.mbg_committee_profile_members
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.mbg_committee_members cm
       JOIN public.mbg_users owner_user ON owner_user.id = cm.user_id
       WHERE cm.id = committee_member_id
         AND cm.user_id = auth.uid()
         AND owner_user.role_type = 'chairperson'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.mbg_committee_members cm
       JOIN public.mbg_users owner_user ON owner_user.id = cm.user_id
       WHERE cm.id = committee_member_id
         AND cm.user_id = auth.uid()
         AND owner_user.role_type = 'chairperson'
    )
  );
