-- ============================================================================
-- Riders apply to registered supermarkets (shared Supabase project)
-- ============================================================================
-- mybodaguy riders live in public.mbg_users / public.mbg_riders.
-- Supermarkets live in public.supermarkets (owned by the digital-city-era app).
-- Both apps share the same Supabase project/auth, so a rider's mbg_users.id
-- IS auth.uid(), and a supermarket admin/manager's auth.uid() resolves to a
-- row in public.users (digital-city-era's own users table) via auth_id.
--
-- This table lets a rider apply to any active supermarket, and lets that
-- supermarket's admin/manager approve or reject the application, reusing the
-- current_user_supermarket_id()/current_user_role() helpers already created
-- by FIX_USERS_RLS_RECURSION.sql.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.rider_supermarket_applications (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  supermarket_id  UUID        NOT NULL REFERENCES public.supermarkets(id) ON DELETE CASCADE,
  rider_user_id   UUID        NOT NULL REFERENCES public.mbg_users(id) ON DELETE CASCADE,
  message         TEXT,
  status          TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by     UUID        REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (supermarket_id, rider_user_id)
);

CREATE INDEX IF NOT EXISTS idx_rider_sm_apps_supermarket ON public.rider_supermarket_applications(supermarket_id);
CREATE INDEX IF NOT EXISTS idx_rider_sm_apps_rider ON public.rider_supermarket_applications(rider_user_id);

ALTER TABLE public.rider_supermarket_applications ENABLE ROW LEVEL SECURITY;

-- Riders manage their own applications
DROP POLICY IF EXISTS rider_apps_read_own ON public.rider_supermarket_applications;
CREATE POLICY rider_apps_read_own ON public.rider_supermarket_applications
  FOR SELECT USING (rider_user_id = auth.uid());

DROP POLICY IF EXISTS rider_apps_insert_own ON public.rider_supermarket_applications;
CREATE POLICY rider_apps_insert_own ON public.rider_supermarket_applications
  FOR INSERT WITH CHECK (rider_user_id = auth.uid());

-- Withdraw: only while still pending
DROP POLICY IF EXISTS rider_apps_delete_own_pending ON public.rider_supermarket_applications;
CREATE POLICY rider_apps_delete_own_pending ON public.rider_supermarket_applications
  FOR DELETE USING (rider_user_id = auth.uid() AND status = 'pending');

-- Supermarket admins/managers review applications sent to their own store
DROP POLICY IF EXISTS rider_apps_read_supermarket_staff ON public.rider_supermarket_applications;
CREATE POLICY rider_apps_read_supermarket_staff ON public.rider_supermarket_applications
  FOR SELECT USING (supermarket_id = public.current_user_supermarket_id());

DROP POLICY IF EXISTS rider_apps_update_supermarket_staff ON public.rider_supermarket_applications;
CREATE POLICY rider_apps_update_supermarket_staff ON public.rider_supermarket_applications
  FOR UPDATE
  USING (supermarket_id = public.current_user_supermarket_id() AND public.current_user_role() IN ('admin', 'manager'))
  WITH CHECK (supermarket_id = public.current_user_supermarket_id() AND public.current_user_role() IN ('admin', 'manager'));

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ rider_supermarket_applications ready — riders can now apply to supermarkets.';
END $$;
