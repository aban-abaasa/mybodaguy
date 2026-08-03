-- ============================================================================
-- Authenticated committee membership and per-chairperson rate-sharing limit
-- ============================================================================

-- Every committee row must already be backed by an mbg_users row, which is
-- synced from auth.users by the assignment flow. Keep the limit at the
-- database boundary so direct RPC/table writes cannot bypass the UI.
CREATE OR REPLACE FUNCTION public.enforce_committee_member_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  member_count INTEGER;
BEGIN
  IF NEW.is_active AND NEW.parent_chairperson_id IS NOT NULL THEN
    SELECT COUNT(DISTINCT cm.user_id)
      INTO member_count
      FROM public.mbg_committee_members cm
     WHERE cm.parent_chairperson_id = NEW.parent_chairperson_id
       AND cm.is_active = true
       AND cm.user_id <> NEW.user_id;

    IF member_count >= 10 THEN
      RAISE EXCEPTION 'A chairperson may share commission rates with a maximum of 10 active committee members';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS committee_member_limit ON public.mbg_committee_members;
CREATE TRIGGER committee_member_limit
BEFORE INSERT OR UPDATE OF parent_chairperson_id, user_id, is_active
ON public.mbg_committee_members
FOR EACH ROW
EXECUTE FUNCTION public.enforce_committee_member_limit();

COMMENT ON FUNCTION public.enforce_committee_member_limit() IS
  'Limits each chairperson to 10 distinct active subordinate committee members for commission sharing';
