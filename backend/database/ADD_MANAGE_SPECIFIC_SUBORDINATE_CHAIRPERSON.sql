-- ============================================================================
-- Real management of a SPECIFIC subordinate chairperson.
-- ============================================================================
-- ChairpersonDashboard.tsx's "Chairpersons" tab only ever listed subordinates
-- (SubordinateChairperson[]) — clicking a card did nothing, there was no way
-- to actually manage one specific person (change their commission rate,
-- deactivate them). chairpersonService.updateSubordinateStatus() existed but
-- was dead code: nothing in the UI called it, and it also updated
-- mbg_committee_members directly from the client — which years of
-- FIX_INFINITE_RECURSION_RLS.sql / FIX_RLS_RECURSION_FINAL.sql history in
-- this file shows is exactly the kind of self-referencing RLS policy
-- (USING an EXISTS subquery against mbg_committee_members itself) that kept
-- breaking with infinite recursion on this table. Rather than add yet
-- another such policy, this is a single SECURITY DEFINER RPC — same
-- pattern as mbg_assign_chairperson / get_subordinate_chairpersons — that
-- authorizes the caller in plain plpgsql (no RLS self-reference at all) and
-- only ever touches ONE row: the subordinate whose parent_chairperson_id
-- points at one of the caller's own active committee memberships (i.e.
-- direct reports only, same scope as get_subordinate_chairpersons).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.mbg_update_subordinate_chairperson(
  p_committee_id UUID,
  p_commission_rate DECIMAL DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_authorized BOOLEAN;
  v_updated UUID;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.mbg_committee_members target
    JOIN public.mbg_committee_members parent
      ON parent.id = target.parent_chairperson_id
    WHERE target.id = p_committee_id
      AND parent.user_id = auth.uid()
      AND parent.is_active = true
  ) INTO v_authorized;

  IF NOT v_authorized THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized to manage this chairperson — they are not your direct report');
  END IF;

  IF p_commission_rate IS NOT NULL AND (p_commission_rate < 0 OR p_commission_rate > 100) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Commission rate must be between 0 and 100');
  END IF;

  UPDATE public.mbg_committee_members
  SET commission_rate = COALESCE(p_commission_rate, commission_rate),
      is_active = COALESCE(p_is_active, is_active),
      notes = COALESCE(p_notes, notes),
      updated_at = now()
  WHERE id = p_committee_id
  RETURNING id INTO v_updated;

  RETURN jsonb_build_object('success', true, 'id', v_updated);
END;
$$;

GRANT EXECUTE ON FUNCTION public.mbg_update_subordinate_chairperson(UUID, DECIMAL, BOOLEAN, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ mbg_update_subordinate_chairperson ready — a chairperson can now change a direct report''s commission rate or active status from the Chairpersons tab.';
END $$;
