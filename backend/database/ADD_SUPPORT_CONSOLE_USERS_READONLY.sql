-- ============================================================================
-- ADD_SUPPORT_CONSOLE_USERS_READONLY.sql — Run ONCE, AFTER ADD_SUPPORT_CONSOLE.sql.
-- ============================================================================
-- Supersedes ADD_SUPPORT_CONSOLE_ANY_TAB.sql's approach (minting a real
-- throwaway Supabase account via a Vercel serverless endpoint + service
-- role): that depends on this project's separate Vercel backend, which
-- turned out to be unreliable/misconfigured independent of anything here.
-- Back to ICAN's actual model — pure browser-to-Postgres RPC, no backend
-- server involved at all, ever.
--
-- Adds a Users tab to the Support Console, read-only (no promote-to-
-- developer or any other write action — those stay real-developer-only),
-- mirroring the same shape userService.ts's getAllUsers() already builds:
-- mbg_users + mbg_user_profiles.full_name + each chairperson's highest
-- mbg_committee_members role.
--
-- Every other DeveloperDashboard tab (Applications, Regions, Commissions,
-- Supermarkets, Transport, Rewards, Settings) stays out of the Support
-- Console tab picker until a matching read-only RPC like this one is
-- written for it — see DeveloperDashboard.tsx's SUPPORT_LINK_TAB_OPTIONS.
--
-- Safe to re-run.
-- ============================================================================

-- mbg_dev_create_support_link / mbg_dev_update_support_link_tabs
-- (ADD_SUPPORT_CONSOLE.sql) only ever validated allowed_tabs against
-- ('messages', 'public-board') — the UI lets an admin pick 'users' too
-- (DeveloperDashboard.tsx's SUPPORT_LINK_TAB_OPTIONS), but it was being
-- silently dropped by this WHERE filter on save, so a link "created" with
-- Users checked would end up with allowed_tabs = {messages,public-board}
-- and mbg_support_list_users() would then correctly refuse it as
-- unauthorized (mbg_support_link_is_valid(token,'users') = false). Widen
-- the filter to match reality.
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
  WHERE t IN ('messages', 'public-board', 'users');

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
  WHERE t IN ('messages', 'public-board', 'users');

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

CREATE OR REPLACE FUNCTION public.mbg_support_list_users(p_token TEXT)
RETURNS TABLE (
  id             UUID,
  email          TEXT,
  full_name      TEXT,
  role_type      TEXT,
  committee_role TEXT,
  is_active      BOOLEAN,
  created_at     TIMESTAMPTZ
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT public.mbg_support_link_is_valid(p_token, 'users') THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  RETURN QUERY
    SELECT
      u.id, u.email, p.full_name, u.role_type::TEXT, hc.role AS committee_role,
      u.is_active, u.created_at
    FROM public.mbg_users u
    LEFT JOIN public.mbg_user_profiles p ON p.user_id = u.id
    LEFT JOIN LATERAL (
      SELECT cm.role
      FROM public.mbg_committee_members cm
      WHERE cm.user_id = u.id AND cm.is_active = true
      ORDER BY CASE cm.role
        WHEN 'district_chairperson'  THEN 1
        WHEN 'division_chairperson'  THEN 2
        WHEN 'subcounty_chairperson' THEN 3
        WHEN 'parish_chairperson'    THEN 4
        WHEN 'stage_chairperson'     THEN 5
        ELSE 6
      END
      LIMIT 1
    ) hc ON true
    ORDER BY u.created_at DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.mbg_support_list_users(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mbg_support_list_users(TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'mybodaguy Support Console Users tab (read-only) installed' AS status;
-- ============================================================================
-- VERIFY
-- ============================================================================
-- As the main developer:
--   SELECT mbg_dev_create_support_link('Test', 'test1234', ARRAY['messages','public-board','users']);
-- Then, without any session at all (anon key only):
--   SELECT mbg_support_get_link_access('<token>');
--   SELECT mbg_support_verify_link_password('<token>', 'test1234');  -- returns board_secret
--   SELECT mbg_support_list_users('<board_secret>');
-- ============================================================================
