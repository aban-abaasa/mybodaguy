-- ================================================================
-- FIX: Infinite recursion in mbg_users and mbg_committee_members
-- ================================================================
-- Run this ONCE in Supabase SQL Editor.
-- ================================================================

BEGIN;

-- ── Step 1: SECURITY DEFINER helpers (bypass RLS in checks) ──────────────────

CREATE OR REPLACE FUNCTION public.is_mbg_developer()
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.mbg_users
    WHERE id = auth.uid() AND role_type = 'developer' AND is_active = true
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.is_mbg_committee_member()
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.mbg_committee_members
    WHERE user_id = auth.uid() AND is_active = true
  );
END;
$$;

-- ── Step 2: Fix mbg_users — drop ALL policies, recreate safe ones ─────────────

DROP POLICY IF EXISTS mbg_users_read_own        ON public.mbg_users;
DROP POLICY IF EXISTS mbg_users_read_developer  ON public.mbg_users;
DROP POLICY IF EXISTS mbg_users_insert_own      ON public.mbg_users;
DROP POLICY IF EXISTS mbg_users_update_own      ON public.mbg_users;
DROP POLICY IF EXISTS mbg_users_service_role    ON public.mbg_users;

CREATE POLICY mbg_users_read_own ON public.mbg_users
  FOR SELECT USING (id = auth.uid());

-- Uses SECURITY DEFINER function — no recursion.
CREATE POLICY mbg_users_read_developer ON public.mbg_users
  FOR SELECT USING (is_mbg_developer());

CREATE POLICY mbg_users_insert_own ON public.mbg_users
  FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY mbg_users_update_own ON public.mbg_users
  FOR UPDATE USING (id = auth.uid()) WITH CHECK (id = auth.uid());

CREATE POLICY mbg_users_service_role ON public.mbg_users
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- ── Step 3: Fix mbg_committee_members — drop EVERY known policy name ──────────

DROP POLICY IF EXISTS mbg_committee_members_service_role         ON public.mbg_committee_members;
DROP POLICY IF EXISTS mbg_committee_members_read_own             ON public.mbg_committee_members;
DROP POLICY IF EXISTS mbg_committee_members_read_assigned        ON public.mbg_committee_members;
DROP POLICY IF EXISTS mbg_committee_members_read_subordinates    ON public.mbg_committee_members;
DROP POLICY IF EXISTS mbg_committee_members_insert               ON public.mbg_committee_members;
DROP POLICY IF EXISTS mbg_committee_members_insert_authenticated ON public.mbg_committee_members;
DROP POLICY IF EXISTS mbg_committee_members_update               ON public.mbg_committee_members;
DROP POLICY IF EXISTS mbg_committee_members_update_own           ON public.mbg_committee_members;
DROP POLICY IF EXISTS committee_members_read_own                 ON public.mbg_committee_members;
DROP POLICY IF EXISTS committee_members_read_assigned            ON public.mbg_committee_members;
DROP POLICY IF EXISTS committee_members_read_subordinates        ON public.mbg_committee_members;
DROP POLICY IF EXISTS committee_members_read_developer           ON public.mbg_committee_members;
DROP POLICY IF EXISTS committee_members_read_chairperson         ON public.mbg_committee_members;
DROP POLICY IF EXISTS committee_members_developer_full           ON public.mbg_committee_members;
DROP POLICY IF EXISTS committee_members_service_role             ON public.mbg_committee_members;
DROP POLICY IF EXISTS committee_members_insert_authorized        ON public.mbg_committee_members;
DROP POLICY IF EXISTS committee_members_update_authorized        ON public.mbg_committee_members;

-- Recreate with only safe, non-recursive policies.

-- Any user can see their own committee record.
CREATE POLICY mbg_committee_members_read_own ON public.mbg_committee_members
  FOR SELECT USING (user_id = auth.uid());

-- Any user can see records they personally assigned.
CREATE POLICY mbg_committee_members_read_assigned ON public.mbg_committee_members
  FOR SELECT USING (assigned_by = auth.uid());

-- Developer can see everything (SECURITY DEFINER fn → no recursion).
CREATE POLICY mbg_committee_members_read_developer ON public.mbg_committee_members
  FOR SELECT USING (is_mbg_developer());

-- Service role full access.
CREATE POLICY mbg_committee_members_service_role ON public.mbg_committee_members
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Authenticated users can insert (function-level auth handles who can actually do it).
CREATE POLICY mbg_committee_members_insert ON public.mbg_committee_members
  FOR INSERT WITH CHECK (
    auth.role() = 'service_role'
    OR is_mbg_developer()
    OR (auth.role() = 'authenticated' AND is_mbg_committee_member())
  );

-- Users can update records they assigned; developer can update anything.
CREATE POLICY mbg_committee_members_update ON public.mbg_committee_members
  FOR UPDATE
  USING (auth.role() = 'service_role' OR is_mbg_developer() OR assigned_by = auth.uid())
  WITH CHECK (auth.role() = 'service_role' OR is_mbg_developer() OR assigned_by = auth.uid());

COMMIT;

-- Verify — should return your own mbg_users row with no 42P17 error.
SELECT id, email, role_type FROM public.mbg_users WHERE id = auth.uid();
