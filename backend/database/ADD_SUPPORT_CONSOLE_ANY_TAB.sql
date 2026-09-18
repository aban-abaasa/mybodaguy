-- ============================================================================
-- ADD_SUPPORT_CONSOLE_ANY_TAB.sql — Run ONCE, AFTER ADD_SUPPORT_CONSOLE.sql.
-- ============================================================================
-- ADD_SUPPORT_CONSOLE.sql scoped support links to just Messages + Public
-- Board, because those were the only two tabs with an easy token-gated
-- path. Every other DeveloperDashboard tab is read through plain `.from()`
-- calls or RPCs gated purely on a real auth.uid() + RLS/is_mbg_developer()
-- — there's no argument to smuggle a link's secret through.
--
-- Rather than requiring Anonymous Sign-ins to be turned on for this
-- Supabase project (a client-facing auth provider toggle), this reuses
-- the SAME service-role backend already live for this app (frontend/api/*,
-- SUPABASE_SERVICE_ROLE_KEY — the exact mechanism journeys/confirm.js,
-- webhooks/duffel.js etc. already run production traffic through).
-- frontend/api/support-console/activate.js, running server-side with the
-- service role:
--   1. calls mbg_support_check_link_password() below (password/lockout
--      logic stays in Postgres, unchanged in shape from
--      mbg_support_verify_link_password in ADD_SUPPORT_CONSOLE.sql),
--   2. on success, mints a real (NOT anonymous) throwaway auth user via
--      the Admin API — auth.admin.createUser(), which needs no Auth
--      provider toggle at all, just the service role key already
--      configured,
--   3. flips that user's mbg_users.role_type to 'developer' and records
--      the grant, both as plain service-role table writes — RLS is
--      bypassed for service_role by Supabase's design, and
--      mbg_block_developer_self_grant() (ADD_DEVELOPER_SELF_SERVICE_ACCESS
--      .sql) ALREADY has an unconditional `auth.role() = 'service_role'`
--      escape hatch, so nothing about that trigger needs to change,
--   4. signs the throwaway account in for real (a normal
--      signInWithPassword() call, the same auth path every real user
--      already uses) and hands the resulting session back to the browser,
--      which adopts it via supabase.auth.setSession().
--
-- From there, DeveloperDashboard's own existing tab-restriction logic
-- (mbg_developer_self -> allowed_tabs) does the rest, completely
-- unmodified — same as it already does for a real restricted developer.
--
-- Tradeoff, matching what ICAN's own Support Console already accepts:
-- revoking the LINK stops it granting NEW sessions and empties
-- allowed_tabs for future mbg_developer_self() checks, but does not
-- retroactively strip role_type='developer' from a throwaway account that
-- already has it (mbg_users' "once a developer, always a developer"
-- invariant is deliberately never weakened). These are disposable
-- @mybodaguy.invalid accounts with no real identity behind them, not real
-- users.
--
-- Safe to re-run.
-- ============================================================================

-- mbg_support_activate_link (an earlier draft of this migration, if it was
-- ever run) assumed the CALLING session could be elevated directly —
-- superseded by the service-role-driven flow above. Drop it; nothing
-- calls it any more.
DROP FUNCTION IF EXISTS public.mbg_support_activate_link(TEXT, TEXT);

-- ------------------------------------------------------------
-- 1. mbg_support_link_grants — which throwaway auth.uid() was activated by
--    which link, so mbg_developer_self() can report live, revocable
--    allowed_tabs for that account (role_type stays 'developer' forever
--    per the sticky invariant, but the TABS it's allowed to see can still
--    go to zero the moment the link is revoked).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mbg_support_link_grants (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  link_id    UUID NOT NULL REFERENCES public.mbg_support_links(id) ON DELETE CASCADE,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.mbg_support_link_grants ENABLE ROW LEVEL SECURITY;
-- No policies — service role (the only writer) bypasses RLS by design;
-- reads go through mbg_developer_self()'s SECURITY DEFINER below.

-- ------------------------------------------------------------
-- 2. Widen the tab picker from {'messages','public-board'} to any real
--    DeveloperDashboard tab. Same functions/signatures as
--    ADD_SUPPORT_CONSOLE.sql — CREATE OR REPLACE only changes which tab
--    ids are accepted.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mbg_dev_create_support_link(
  p_label TEXT DEFAULT NULL,
  p_password TEXT DEFAULT NULL,
  p_allowed_tabs TEXT[] DEFAULT ARRAY['messages', 'public-board']
) RETURNS JSONB SECURITY DEFINER SET search_path = public, extensions LANGUAGE plpgsql AS $$
DECLARE
  v_token  TEXT;
  v_secret TEXT;
  v_tabs   TEXT[];
  v_id     UUID;
BEGIN
  IF NOT public.is_main_mbg_developer() THEN RAISE EXCEPTION 'unauthorized'; END IF;

  IF p_password IS NULL OR length(p_password) < 4 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Password must be at least 4 characters.');
  END IF;

  SELECT array_agg(DISTINCT t) INTO v_tabs
  FROM unnest(COALESCE(p_allowed_tabs, ARRAY['messages', 'public-board'])) AS t
  WHERE t IN ('overview', 'users', 'applications', 'regions', 'commissions',
              'supermarkets', 'transport', 'rewards', 'public-board', 'messages', 'settings');

  IF v_tabs IS NULL OR array_length(v_tabs, 1) IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Pick at least one tab.');
  END IF;

  v_token  := encode(gen_random_bytes(24), 'hex');
  v_secret := encode(gen_random_bytes(24), 'hex');

  INSERT INTO public.mbg_support_links (token, board_secret, label, password_hash, allowed_tabs, created_by)
  VALUES (v_token, v_secret, p_label, crypt(p_password, gen_salt('bf')), v_tabs, auth.uid())
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success', true, 'id', v_id, 'token', v_token);
END;
$$;

CREATE OR REPLACE FUNCTION public.mbg_dev_update_support_link_tabs(p_link_id UUID, p_allowed_tabs TEXT[])
RETURNS JSONB SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
DECLARE
  v_tabs TEXT[];
BEGIN
  IF NOT public.is_main_mbg_developer() THEN RAISE EXCEPTION 'unauthorized'; END IF;

  SELECT array_agg(DISTINCT t) INTO v_tabs
  FROM unnest(COALESCE(p_allowed_tabs, '{}'::TEXT[])) AS t
  WHERE t IN ('overview', 'users', 'applications', 'regions', 'commissions',
              'supermarkets', 'transport', 'rewards', 'public-board', 'messages', 'settings');

  IF v_tabs IS NULL OR array_length(v_tabs, 1) IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Pick at least one tab.');
  END IF;

  UPDATE public.mbg_support_links SET allowed_tabs = v_tabs WHERE id = p_link_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Link not found.');
  END IF;
  RETURN jsonb_build_object('success', true);
END;
$$;

-- ------------------------------------------------------------
-- 3. mbg_developer_self — add a fallback for a session with no
--    mbg_developer_emails row (a Support Console throwaway account has a
--    real but fake @mybodaguy.invalid email, so it never matches) but a
--    live mbg_support_link_grants row: report that link's allowed_tabs
--    (emptied out if the link has since been revoked/expired) instead of
--    falling through to "no row returned", which DeveloperDashboard.tsx
--    would otherwise read as allowedTabs = null = UNRESTRICTED — exactly
--    backwards for a scoped support-link session.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mbg_developer_self()
RETURNS TABLE (email TEXT, is_main BOOLEAN, allowed_tabs TEXT[])
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_row  public.mbg_developer_emails;
  v_link public.mbg_support_links;
BEGIN
  IF NOT is_mbg_developer() THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT d.* INTO v_row FROM public.mbg_developer_emails d WHERE lower(d.email) = lower(auth.email());

  IF v_row.email IS NOT NULL THEN
    RETURN QUERY SELECT v_row.email, v_row.is_main, v_row.allowed_tabs;
    RETURN;
  END IF;

  SELECT l.* INTO v_link
  FROM public.mbg_support_link_grants g
  JOIN public.mbg_support_links l ON l.id = g.link_id
  WHERE g.user_id = auth.uid();

  IF v_link.id IS NOT NULL THEN
    RETURN QUERY
      SELECT auth.email(), false,
        CASE WHEN v_link.revoked_at IS NOT NULL
                  OR (v_link.expires_at IS NOT NULL AND v_link.expires_at <= now())
             THEN ARRAY[]::TEXT[]
             ELSE v_link.allowed_tabs
        END;
  END IF;
END;
$$;

-- ------------------------------------------------------------
-- 4. mbg_support_check_link_password — password/lockout verification only.
--    No session elevation happens in Postgres at all any more — that's
--    frontend/api/support-console/activate.js's job, using the service
--    role. Restricted to service_role: the browser never calls this
--    directly, only that backend endpoint does.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mbg_support_check_link_password(p_token TEXT, p_password TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_link public.mbg_support_links;
BEGIN
  SELECT * INTO v_link FROM public.mbg_support_links WHERE token = p_token;

  IF v_link.id IS NULL OR v_link.revoked_at IS NOT NULL
     OR (v_link.expires_at IS NOT NULL AND v_link.expires_at <= now()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'This link is invalid or has been revoked.');
  END IF;

  IF v_link.locked_until IS NOT NULL AND v_link.locked_until > now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Too many wrong attempts. Try again later.');
  END IF;

  IF crypt(p_password, v_link.password_hash) != v_link.password_hash THEN
    UPDATE public.mbg_support_links
       SET failed_attempts = failed_attempts + 1,
           locked_until = CASE WHEN failed_attempts + 1 >= 5 THEN now() + interval '30 minutes' ELSE locked_until END
     WHERE id = v_link.id;
    INSERT INTO public.mbg_support_link_access_log (link_id, outcome)
    VALUES (v_link.id, CASE WHEN v_link.failed_attempts + 1 >= 5 THEN 'locked' ELSE 'wrong_password' END);
    RETURN jsonb_build_object('success', false, 'error', 'Wrong password.');
  END IF;

  UPDATE public.mbg_support_links
     SET failed_attempts = 0, locked_until = NULL, view_count = view_count + 1
   WHERE id = v_link.id;
  INSERT INTO public.mbg_support_link_access_log (link_id, outcome) VALUES (v_link.id, 'viewed');

  RETURN jsonb_build_object(
    'success', true, 'link_id', v_link.id, 'label', v_link.label, 'allowed_tabs', to_jsonb(v_link.allowed_tabs)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.mbg_support_check_link_password(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mbg_support_check_link_password(TEXT, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';

SELECT 'mybodaguy Support Console (any tab, service-role activation) installed' AS status;
-- ============================================================================
-- VERIFY
-- ============================================================================
-- As the main developer:
--   SELECT mbg_dev_create_support_link('Test', 'test1234', ARRAY['users','commissions']);
-- Then via frontend/api/support-console/activate.js (service role only —
-- this RPC is not reachable from the browser):
--   POST /api/support-console/activate { token, password }
--   -> { success, access_token, refresh_token, allowed_tabs }
-- ============================================================================
