-- ============================================================================
-- ADD DEVELOPER SELF-SERVICE ACCESS — Run ONCE in the shared Supabase SQL
-- Editor (same project as digital-city-era/supermarkera).
-- ============================================================================
-- Goal: let an existing developer grant developer-panel access to another
-- account, without needing DB access for every new hire.
--
-- Two things needed for that to be both possible and safe:
--
-- 1. mbg_users_update_developer — an RLS policy letting a developer UPDATE
--    ANY row in mbg_users (needed to set someone else's role_type). A
--    version of this exists in COMPLETE_ACCESS_LEVEL_VERIFICATION.sql, but
--    written as a raw `EXISTS (SELECT ... FROM mbg_users ...)` subquery —
--    the exact self-referencing pattern FIX_RLS_RECURSION_FINAL.sql had to
--    replace with a SECURITY DEFINER helper (is_mbg_developer()) after it
--    caused "infinite recursion detected in policy" (42P17) errors. This
--    migration uses that same safe helper instead of repeating the raw
--    pattern, and re-creates is_mbg_developer() itself (idempotent) in
--    case FIX_RLS_RECURSION_FINAL.sql was never actually run on the live
--    project — this repo has several conflicting mbg_users RLS migrations
--    and it's unclear which ran last.
--
-- 2. A fix for a privilege-escalation hole this otherwise opens up:
--    mbg_users_update_own (01_users.sql) lets ANY signed-in user update
--    their OWN row with no restriction on which columns change — including
--    role_type. That means, right now, any customer can already run
--    `supabase.from('mbg_users').update({role_type:'developer'}).eq('id',
--    <their own id>)` from the browser console and grant themselves
--    developer access, bypassing the whole dev panel gate. This has
--    nothing to do with #1 above (it works today, independent of this
--    migration) — it's a pre-existing gap this migration also closes.
--    A BEFORE UPDATE trigger blocks any change TO role_type='developer'
--    unless the caller is already an active developer (or service_role).
--    Only the 'developer' transition is restricted here — promotion to
--    rider/chairperson is untouched (separate, pre-existing behavior, out
--    of scope for this change).
--
--    Developer status is also sticky in the other direction: once
--    role_type = 'developer', nothing except a direct service_role/DB
--    action can change it to anything else — see the second half of
--    mbg_block_developer_self_grant() below, plus the CASE guard added to
--    handle_new_auth_user_mbg()'s upsert so a re-fired signup trigger can
--    never silently overwrite an existing developer with 'customer'.
--
-- 3. Google sign-in support: handle_new_auth_user_mbg() (01_users.sql)
--    only grants 'developer' to one hardcoded email at auth.users INSERT
--    time. If a user's Google identity ever lands on a different
--    auth.users row than their password identity (depends on this
--    project's Supabase "automatic linking" setting, which isn't
--    controllable from SQL), that new row would default to 'customer' and
--    silently lose developer access. mbg_developer_emails is an
--    email-based allowlist (mirrors digital-city-era's dev_operators) that
--    the signup trigger now also checks, so developer status follows the
--    EMAIL across however many auth.users rows/providers end up
--    representing that person — same approach digital-city-era already
--    uses via is_dev_operator()/auth.email(), which is provider-agnostic
--    for the same reason.
-- ============================================================================

BEGIN;

-- ── 0. Safe, non-recursive "am I a developer" check (re-asserted here in
--      case FIX_RLS_RECURSION_FINAL.sql was never run on the live project).
--      SECURITY DEFINER means this SELECT bypasses RLS entirely instead of
--      re-triggering mbg_users' own policies — that self-reference is what
--      caused the earlier 42P17 recursion errors.
CREATE OR REPLACE FUNCTION public.is_mbg_developer()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.mbg_users
    WHERE id = auth.uid() AND role_type = 'developer' AND is_active = true
  );
END;
$$;

-- ── 1. Developers can read/UPDATE any user row (role assignment etc.) ─────
--      Re-asserting mbg_users_read_developer too (not just the new UPDATE
--      policy) — every login fetches the caller's own mbg_users row, and if
--      whatever's currently live for this SELECT policy is still the raw
--      self-referencing version, THAT (not anything new here) is the more
--      likely cause of logins/signups hanging, since it runs on every
--      session, not just role-grant actions.
DROP POLICY IF EXISTS mbg_users_read_developer ON public.mbg_users;
CREATE POLICY mbg_users_read_developer ON public.mbg_users
  FOR SELECT
  USING (is_mbg_developer());

DROP POLICY IF EXISTS mbg_users_update_developer ON public.mbg_users;
CREATE POLICY mbg_users_update_developer ON public.mbg_users
  FOR UPDATE
  USING (is_mbg_developer())
  WITH CHECK (is_mbg_developer());

-- ── 2. Block self/other escalation TO developer unless already a developer ─
CREATE OR REPLACE FUNCTION public.mbg_block_developer_self_grant()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Granting developer: only an existing active developer (or service_role,
  -- e.g. the signup trigger's upsert) may do this.
  IF NEW.role_type = 'developer' AND OLD.role_type IS DISTINCT FROM 'developer' THEN
    IF auth.role() <> 'service_role' AND NOT is_mbg_developer() THEN
      RAISE EXCEPTION 'Only an existing active developer may grant developer access';
    END IF;
  END IF;

  -- Once a developer, always a developer: role_type can never move away
  -- from 'developer' through the app (roleService.ts's demoteToCustomer
  -- included) — only a direct service_role/DB action can. This is a
  -- backstop; handle_new_auth_user_mbg()'s upsert is written to never even
  -- attempt this, so in normal operation this branch should never fire.
  IF OLD.role_type = 'developer' AND NEW.role_type IS DISTINCT FROM 'developer' THEN
    IF auth.role() <> 'service_role' THEN
      RAISE EXCEPTION 'Developer accounts cannot be downgraded';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mbg_users_block_developer_self_grant ON public.mbg_users;
CREATE TRIGGER mbg_users_block_developer_self_grant
BEFORE UPDATE ON public.mbg_users
FOR EACH ROW EXECUTE FUNCTION public.mbg_block_developer_self_grant();

-- ── 3. Email-based developer allowlist, so developer status survives ──────
--      signing in via a different provider (e.g. Google) than the one
--      originally used to create the account.
CREATE TABLE IF NOT EXISTS public.mbg_developer_emails (
  email    TEXT PRIMARY KEY,
  added_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO public.mbg_developer_emails (email) VALUES
  ('abanabaasa2@gmail.com'),
  ('bodagoera@gmail.com')
ON CONFLICT (email) DO NOTHING;

-- Signup trigger now checks the allowlist (case-insensitively) instead of
-- a single hardcoded email — any auth.users row created (any provider)
-- for an allowlisted email becomes 'developer' immediately.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user_mbg()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_role mbg_user_role_type;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.mbg_developer_emails
    WHERE lower(email) = lower(COALESCE(NEW.email, ''))
  ) THEN
    user_role := 'developer';
  ELSE
    user_role := 'customer';
  END IF;

  -- Never downgrade an existing developer here: if this id's row is
  -- already 'developer', keep it that way regardless of what user_role
  -- was just computed (e.g. an allowlist edge case) — see the sticky-
  -- developer note at the top of this file.
  INSERT INTO public.mbg_users (id, email, role_type)
  VALUES (NEW.id, COALESCE(NEW.email, ''), user_role)
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        role_type = CASE
          WHEN public.mbg_users.role_type = 'developer' THEN 'developer'
          ELSE EXCLUDED.role_type
        END,
        updated_at = NOW();

  INSERT INTO public.mbg_user_profiles (user_id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', 'User'))
  ON CONFLICT (user_id) DO NOTHING;

  IF user_role = 'customer' THEN
    INSERT INTO public.mbg_customers (user_id)
    VALUES (NEW.id)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- Self-service grant now also RPC-driven, so promoting someone updates
-- BOTH their current row AND the email allowlist in one call (the plain
-- client-side `.update()` in roleService.ts only did the former, which
-- would leave a newly-granted developer's OTHER sign-in methods/providers
-- still defaulting to 'customer').
CREATE OR REPLACE FUNCTION public.mbg_promote_to_developer(target_user_id UUID)
RETURNS VOID
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  target_email TEXT;
BEGIN
  IF NOT is_mbg_developer() THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT email INTO target_email FROM public.mbg_users WHERE id = target_user_id;
  IF target_email IS NULL THEN
    RAISE EXCEPTION 'user not found';
  END IF;

  INSERT INTO public.mbg_developer_emails (email) VALUES (lower(target_email))
  ON CONFLICT (email) DO NOTHING;

  UPDATE public.mbg_users
    SET role_type = 'developer', updated_at = NOW()
    WHERE id = target_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mbg_promote_to_developer(UUID) TO authenticated;

COMMIT;

-- Verify with: run as a non-developer account and confirm this fails:
--   update public.mbg_users set role_type = 'developer' where id = auth.uid();
-- then as an active developer, confirm this succeeds against ANY user id:
--   update public.mbg_users set role_type = 'developer' where id = '<other-user-id>';
