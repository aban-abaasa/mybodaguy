-- ============================================================================
-- ADD DEV TAB PERMISSIONS — Run ONCE in the shared Supabase SQL Editor,
-- AFTER ADD_DEVELOPER_SELF_SERVICE_ACCESS.sql (depends on
-- public.mbg_developer_emails and public.is_mbg_developer() from that
-- migration).
-- ============================================================================
-- Lets ONE main developer (bodagoera@gmail.com) control which
-- DeveloperDashboard tabs each other developer can see, instead of every
-- developer seeing everything. Regular developers (added via
-- mbg_promote_to_developer) start locked to no tabs until the main
-- developer assigns some; the main developer always sees every tab
-- regardless of allowed_tabs.
--
-- Permissions live on mbg_developer_emails (email-keyed), not mbg_users,
-- for the same reason role status does — so they follow the person across
-- however many auth.users rows/providers end up representing them (see
-- ADD_DEVELOPER_SELF_SERVICE_ACCESS.sql's Google sign-in note).
--
-- allowed_tabs = NULL means "unrestricted / all tabs" — used for
-- abanabaasa2@gmail.com and bodagoera@gmail.com (both already developers
-- before this migration), so nobody who already had full access loses it
-- silently.
-- ============================================================================

BEGIN;

ALTER TABLE public.mbg_developer_emails ADD COLUMN IF NOT EXISTS is_main BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.mbg_developer_emails ADD COLUMN IF NOT EXISTS allowed_tabs TEXT[] DEFAULT NULL;

UPDATE public.mbg_developer_emails SET is_main = true WHERE lower(email) = 'bodagoera@gmail.com';

-- New developers added from now on start locked out (empty tabs) until the
-- main developer grants some — existing rows are untouched by this DEFAULT
-- since it only applies to future inserts.
ALTER TABLE public.mbg_developer_emails ALTER COLUMN allowed_tabs SET DEFAULT '{}';


-- Re-point mbg_promote_to_developer so a genuinely NEW developer gets the
-- locked-out default above; re-promoting someone already in
-- mbg_developer_emails (ON CONFLICT) leaves their existing
-- allowed_tabs/is_main untouched.
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

  INSERT INTO public.mbg_developer_emails (email, allowed_tabs) VALUES (lower(target_email), '{}')
  ON CONFLICT (email) DO NOTHING;

  UPDATE public.mbg_users
    SET role_type = 'developer', updated_at = NOW()
    WHERE id = target_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mbg_promote_to_developer(UUID) TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- mbg_developer_self — the caller's own row, so DeveloperDashboard.tsx
-- knows which tabs to show without needing a separate "list everyone"
-- permission.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mbg_developer_self()
RETURNS TABLE (email TEXT, is_main BOOLEAN, allowed_tabs TEXT[])
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT is_mbg_developer() THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  RETURN QUERY
    SELECT d.email, d.is_main, d.allowed_tabs
    FROM public.mbg_developer_emails d
    WHERE lower(d.email) = lower(auth.email());
END;
$$;

GRANT EXECUTE ON FUNCTION public.mbg_developer_self() TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- mbg_list_developers — every developer's row, for the main developer's
-- management UI. Restricted to is_main, not just any developer.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mbg_list_developers()
RETURNS TABLE (email TEXT, is_main BOOLEAN, allowed_tabs TEXT[], added_at TIMESTAMPTZ)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.mbg_developer_emails WHERE lower(email) = lower(auth.email()) AND is_main = true
  ) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  RETURN QUERY
    SELECT d.email, d.is_main, d.allowed_tabs, d.added_at
    FROM public.mbg_developer_emails d
    ORDER BY d.is_main DESC, d.added_at ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mbg_list_developers() TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- mbg_set_developer_tabs — main-developer-only. Pass tabs = NULL to grant
-- unrestricted (all tabs) access to that developer.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mbg_set_developer_tabs(target_email TEXT, tabs TEXT[])
RETURNS VOID
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.mbg_developer_emails WHERE lower(email) = lower(auth.email()) AND is_main = true
  ) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  UPDATE public.mbg_developer_emails
    SET allowed_tabs = tabs
    WHERE lower(email) = lower(trim(target_email));
END;
$$;

GRANT EXECUTE ON FUNCTION public.mbg_set_developer_tabs(TEXT, TEXT[]) TO authenticated;

COMMIT;

-- No separate "search accounts" RPC here on purpose — the Developers tab's
-- grant-access picker reuses `users` (already fetched via
-- userService.getAllUsers() for the Users tab) client-side instead, same
-- simplification applied to digital-city-era's DevPanel.jsx. One fewer
-- RPC surface to keep in sync with is_main changes.
