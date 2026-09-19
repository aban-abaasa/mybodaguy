-- ============================================================================
-- Chairperson Commission tab — real earnings instead of hardcoded "UGX 0".
-- ============================================================================
-- mbg_complete_ride / mbg_confirm_cash_received (ADD_RIDE_PAYMENT_METHOD_AND_
-- COMMISSION.sql, ADD_CASH_COMMISSION_DEBT_TRACKING.sql) already write real
-- rows into public.mbg_commissions for every paid-out chairperson commission
-- (recipient_id, commission_amount, status='paid', paid_at). But
-- COMPLETE_MYBODAGUY_SETUP.sql only ever granted that table a
-- service_role-only RLS policy — no authenticated chairperson could SELECT
-- their own rows, so ChairpersonDashboard.tsx's Commission tab had nothing
-- to query and shipped with hardcoded "UGX 0" placeholders instead. This
-- just opens read access to a chairperson's own commission rows; nothing
-- about how commissions are earned or written changes.
-- ============================================================================

DROP POLICY IF EXISTS mbg_commissions_read_own ON public.mbg_commissions;
CREATE POLICY mbg_commissions_read_own ON public.mbg_commissions
  FOR SELECT
  USING (auth.uid() = recipient_id);

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ Chairpersons can now read their own mbg_commissions rows — Commission tab can show real earnings.';
END $$;
