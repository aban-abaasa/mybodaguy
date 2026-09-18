-- ============================================================================
-- ADD_SUPPORT_CONSOLE.sql — Run ONCE in the shared Supabase SQL Editor,
-- AFTER ADD_DEV_TAB_PERMISSIONS.sql (depends on public.mbg_developer_emails'
-- is_main column) and AFTER digital-city-era's ADD_LANDING_MESSAGE_REPLIES.sql
-- / ADD_LANDING_MESSAGE_REWARDS.sql / SECURE_DEV_PANEL_ACCESS.sql (this file
-- redefines the SHARED public.landing_messages_is_dev(), so it must be run
-- after — not instead of — those, or it will drop their branches).
-- ============================================================================
-- Purpose: a shareable password link into DeveloperDashboard.tsx that
-- doesn't require the recipient to have (or create) a mybodaguy account —
-- mirrors ICAN's Support Console (ICAN/backend/SUPPORT_CONSOLE.sql /
-- ICANDevPanel.jsx's SupportTeamTab), which works because ICAN's whole dev
-- panel is gated by one shared passphrase to begin with. mybodaguy's
-- DeveloperDashboard is different: it's gated end-to-end by a real Supabase
-- Auth session + RLS/is_mbg_developer(), so a link visitor with no account
-- has no auth.uid() at all and none of the existing per-tab RLS/RPCs would
-- let them read anything.
--
-- Rather than retrofit anonymous access across every tab (users, wallets,
-- commissions — real money and PII), this migration scopes the passwordless
-- link to the two tabs ICAN itself defaults new links to and that are safe
-- to expose: Public Board (community message moderation) and Messages
-- (the support inbox). Every other DeveloperDashboard tab is NOT reachable
-- through a support link — the admin UI (SupportLinksTab, DeveloperDashboard
-- .tsx) only offers these two.
--
-- Deliberately v1/password-only (no Gmail+OTP mode like ICAN's "restricted"
-- visibility) — no email-sending backend route exists in this project yet.
-- Can be added later following ICAN's support_verify_link_otp pattern.
--
-- Two-factor-ish by construction: the link's `token` (in the shared URL,
-- ?key=<token>) only looks up which link this is — it grants nothing by
-- itself. Only a correct password unlocks `board_secret`, a SEPARATE
-- server-generated value never exposed until verified, which the frontend
-- then passes as the `dev_token`/`p_dev_secret` argument to the RPCs below.
-- Revocation is real and immediate (unlike ICAN's constant DEV_TOKEN): every
-- data call re-checks mbg_support_links.revoked_at, not a cached secret.
--
-- Safe to re-run.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ------------------------------------------------------------
-- 1. Tables
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mbg_support_links (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token           TEXT NOT NULL UNIQUE,   -- public URL key (?key=<token>) — identifies the link, grants nothing alone
  board_secret    TEXT NOT NULL UNIQUE,   -- private; only ever returned by mbg_support_verify_link_password on success
  label           TEXT,                   -- who/what this link is for, e.g. "Jane — support"
  password_hash   TEXT NOT NULL,
  created_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ,
  revoked_at      TIMESTAMPTZ,
  failed_attempts INT NOT NULL DEFAULT 0,
  locked_until    TIMESTAMPTZ,
  view_count      INT NOT NULL DEFAULT 0,
  -- Only 'messages' and 'public-board' are meaningful here — see the file
  -- header on why every other DeveloperDashboard tab is out of scope.
  allowed_tabs    TEXT[] NOT NULL DEFAULT ARRAY['messages', 'public-board'],

  CONSTRAINT mbg_support_links_password_chk CHECK (length(password_hash) > 0)
);
CREATE INDEX IF NOT EXISTS idx_mbg_support_links_token ON public.mbg_support_links (token);
CREATE INDEX IF NOT EXISTS idx_mbg_support_links_secret ON public.mbg_support_links (board_secret);

CREATE TABLE IF NOT EXISTS public.mbg_support_link_access_log (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id    UUID NOT NULL REFERENCES public.mbg_support_links(id) ON DELETE CASCADE,
  outcome    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT mbg_support_link_access_log_outcome_chk CHECK (outcome IN ('viewed', 'wrong_password', 'locked'))
);

ALTER TABLE public.mbg_support_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mbg_support_link_access_log ENABLE ROW LEVEL SECURITY;
-- No policies — every read/write goes through the SECURITY DEFINER functions below.

-- ------------------------------------------------------------
-- 2. is_main_mbg_developer — link management is restricted to the main
--    developer, same bar as mbg_list_developers()/mbg_set_developer_tabs()
--    (ADD_DEV_TAB_PERMISSIONS.sql), not just any restricted developer —
--    a link can hand out access to tabs the creator itself might not have.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_main_mbg_developer()
RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.mbg_developer_emails
    WHERE lower(email) = lower(auth.email()) AND is_main = true
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.is_main_mbg_developer() TO authenticated;

-- ------------------------------------------------------------
-- 3. Admin management — main-developer-only, real auth session (no
--    dev_token param needed — mybodaguy already has real accounts).
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
  WHERE t IN ('messages', 'public-board');

  IF v_tabs IS NULL OR array_length(v_tabs, 1) IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Pick at least one tab (Messages or Public Board).');
  END IF;

  v_token  := encode(gen_random_bytes(24), 'hex');
  v_secret := encode(gen_random_bytes(24), 'hex');

  INSERT INTO public.mbg_support_links (token, board_secret, label, password_hash, allowed_tabs, created_by)
  VALUES (v_token, v_secret, p_label, crypt(p_password, gen_salt('bf')), v_tabs, auth.uid())
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success', true, 'id', v_id, 'token', v_token);
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_dev_create_support_link(TEXT, TEXT, TEXT[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.mbg_dev_list_support_links()
RETURNS TABLE (
  id UUID, token TEXT, label TEXT, allowed_tabs TEXT[],
  revoked_at TIMESTAMPTZ, view_count INT, failed_attempts INT, locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ
) SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
BEGIN
  IF NOT public.is_main_mbg_developer() THEN RAISE EXCEPTION 'unauthorized'; END IF;
  RETURN QUERY
    SELECT l.id, l.token, l.label, l.allowed_tabs,
           l.revoked_at, l.view_count, l.failed_attempts, l.locked_until, l.created_at
    FROM public.mbg_support_links l
    ORDER BY l.created_at DESC;
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_dev_list_support_links() TO authenticated;

CREATE OR REPLACE FUNCTION public.mbg_dev_revoke_support_link(p_link_id UUID)
RETURNS JSONB SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
BEGIN
  IF NOT public.is_main_mbg_developer() THEN RAISE EXCEPTION 'unauthorized'; END IF;
  UPDATE public.mbg_support_links SET revoked_at = now() WHERE id = p_link_id AND revoked_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Link not found or already revoked.');
  END IF;
  RETURN jsonb_build_object('success', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_dev_revoke_support_link(UUID) TO authenticated;

-- Un-revoke: the admin may have revoked by mistake, or want to hand the same
-- URL back out later instead of minting a new token. Also clears any
-- brute-force lockout picked up before it was revoked.
CREATE OR REPLACE FUNCTION public.mbg_dev_reactivate_support_link(p_link_id UUID)
RETURNS JSONB SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
BEGIN
  IF NOT public.is_main_mbg_developer() THEN RAISE EXCEPTION 'unauthorized'; END IF;
  UPDATE public.mbg_support_links
     SET revoked_at = NULL, failed_attempts = 0, locked_until = NULL
   WHERE id = p_link_id AND revoked_at IS NOT NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Link not found or already live.');
  END IF;
  RETURN jsonb_build_object('success', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_dev_reactivate_support_link(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.mbg_dev_update_support_link_tabs(p_link_id UUID, p_allowed_tabs TEXT[])
RETURNS JSONB SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
DECLARE
  v_tabs TEXT[];
BEGIN
  IF NOT public.is_main_mbg_developer() THEN RAISE EXCEPTION 'unauthorized'; END IF;

  SELECT array_agg(DISTINCT t) INTO v_tabs
  FROM unnest(COALESCE(p_allowed_tabs, '{}'::TEXT[])) AS t
  WHERE t IN ('messages', 'public-board');

  IF v_tabs IS NULL OR array_length(v_tabs, 1) IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Pick at least one tab (Messages or Public Board).');
  END IF;

  UPDATE public.mbg_support_links SET allowed_tabs = v_tabs WHERE id = p_link_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Link not found.');
  END IF;
  RETURN jsonb_build_object('success', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_dev_update_support_link_tabs(UUID, TEXT[]) TO authenticated;

-- ------------------------------------------------------------
-- 4. Anonymous access — SupportConsole.tsx calls these with no session.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mbg_support_get_link_access(p_token TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_link public.mbg_support_links;
BEGIN
  SELECT * INTO v_link FROM public.mbg_support_links WHERE token = p_token;

  IF v_link.id IS NULL OR v_link.revoked_at IS NOT NULL
     OR (v_link.expires_at IS NOT NULL AND v_link.expires_at <= now()) THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  RETURN jsonb_build_object('status', 'password_required', 'label', v_link.label);
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_support_get_link_access(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.mbg_support_verify_link_password(p_token TEXT, p_password TEXT)
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
    'success', true, 'label', v_link.label,
    'board_secret', v_link.board_secret, 'allowed_tabs', to_jsonb(v_link.allowed_tabs)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_support_verify_link_password(TEXT, TEXT) TO anon, authenticated;

-- Shared validity check — used both by the data RPCs below and by
-- landing_messages_is_dev()'s new branch. Re-checked on every call, so
-- revoking a link cuts off access immediately (unlike ICAN's constant token).
CREATE OR REPLACE FUNCTION public.mbg_support_link_is_valid(p_secret TEXT, p_tab TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_secret IS NULL OR p_secret = '' THEN RETURN false; END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.mbg_support_links
    WHERE board_secret = p_secret
      AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > now())
      AND p_tab = ANY(allowed_tabs)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_support_link_is_valid(TEXT, TEXT) TO anon, authenticated;

-- ------------------------------------------------------------
-- 5. Public Board — extend the SHARED landing_messages_is_dev() (defined in
--    digital-city-era/backend/database/seeds/SECURE_DEV_PANEL_ACCESS.sql,
--    one function shared by all 4 apps' dev panels) with a 4th branch for a
--    verified mybodaguy support link. This one CREATE OR REPLACE instantly
--    makes dev_get_landing_messages / dev_reply_landing_message /
--    dev_mark_correct_answer / dev_delete_landing_message all support-link
--    aware, with no changes to those functions themselves — the frontend
--    just passes board_secret as their existing dev_token argument.
--    dev_grant_landing_bonus (real ICAN money) is deliberately NOT
--    reachable this way — PublicBoardTab hides that UI when rendered with
--    allowGrants={false} for a support-link viewer.
--
--    Copies forward the full current definition (all branches) rather than
--    replacing it — this function is shared across repos, so dropping any
--    existing branch here would silently break another app's dev panel.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.landing_messages_is_dev(dev_token TEXT DEFAULT NULL)
RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  -- digital-city-era's own real-session allowlist (is_dev_operator(),
  -- SECURE_DEV_PANEL_ACCESS.sql) — must already exist in this shared
  -- project for this branch to work; harmless no-op call otherwise fails
  -- only if that migration was never run at all.
  IF public.is_dev_operator() THEN
    RETURN true;
  END IF;

  -- digital-city-era / FARM-AGENT / ICAN's own hardcoded dev-panel tokens.
  IF dev_token IN ('dev_Sup3rmarktera_KV25', 'dev_Farm_Ag3nt_KV25', 'dev_ICAN_Pr0_KV25') THEN
    RETURN true;
  END IF;

  -- mybodaguy's real authenticated developer session.
  IF EXISTS (
    SELECT 1 FROM public.mbg_users
    WHERE id = auth.uid() AND role_type = 'developer'
  ) THEN
    RETURN true;
  END IF;

  -- NEW: a verified mybodaguy support link scoped to 'public-board'.
  IF public.mbg_support_link_is_valid(dev_token, 'public-board') THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

-- ------------------------------------------------------------
-- 6. Messages (support inbox) — chatService.ts's real-developer functions
--    are plain `.from()` calls under RLS, not RPCs, so a link visitor with
--    no auth.uid() can't reuse them directly. These SECURITY DEFINER
--    wrappers give a scoped, revocable equivalent for chat_conversations /
--    chat_messages, gated by mbg_support_link_is_valid() instead of RLS.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mbg_support_list_conversations(p_dev_secret TEXT)
RETURNS SETOF public.chat_conversations
SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
BEGIN
  IF NOT public.mbg_support_link_is_valid(p_dev_secret, 'messages') THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  RETURN QUERY
    SELECT * FROM public.chat_conversations
    WHERE origin_app = 'mybodaguy'
    ORDER BY last_message_at DESC;
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_support_list_conversations(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.mbg_support_fetch_messages(p_dev_secret TEXT, p_conversation_id UUID)
RETURNS SETOF public.chat_messages
SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
BEGIN
  IF NOT public.mbg_support_link_is_valid(p_dev_secret, 'messages') THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  RETURN QUERY
    SELECT * FROM public.chat_messages
    WHERE conversation_id = p_conversation_id
    ORDER BY created_at ASC;
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_support_fetch_messages(TEXT, UUID) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.mbg_support_send_message(
  p_dev_secret TEXT, p_conversation_id UUID, p_sender_name TEXT, p_body TEXT
) RETURNS public.chat_messages
SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
DECLARE
  result public.chat_messages;
BEGIN
  IF NOT public.mbg_support_link_is_valid(p_dev_secret, 'messages') THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  INSERT INTO public.chat_messages (conversation_id, sender_role, sender_name, body)
  VALUES (p_conversation_id, 'dev', p_sender_name, p_body)
  RETURNING * INTO result;
  RETURN result;
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_support_send_message(TEXT, UUID, TEXT, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.mbg_support_mark_conversation_read(p_dev_secret TEXT, p_conversation_id UUID)
RETURNS VOID
SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
BEGIN
  IF NOT public.mbg_support_link_is_valid(p_dev_secret, 'messages') THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  UPDATE public.chat_conversations SET unread_by_dev = false WHERE id = p_conversation_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_support_mark_conversation_read(TEXT, UUID) TO anon, authenticated;

-- Without this, PostgREST keeps serving its cached schema and these
-- brand-new RPCs 404 from the client for a while after this script runs.
NOTIFY pgrst, 'reload schema';

SELECT 'mybodaguy Support Console installed' AS status;
-- ============================================================================
-- VERIFY (run as the main developer, then anonymously)
-- ============================================================================
-- SELECT mbg_dev_create_support_link('Test', 'test1234', ARRAY['messages','public-board']);
-- SELECT mbg_support_get_link_access('<token from above>');
-- SELECT mbg_support_verify_link_password('<token>', 'test1234');
-- SELECT * FROM mbg_support_links;
-- ============================================================================
