-- ============================================================================
-- Live-DB diagnosis: scanning a real, freshly-generated delivery QR
-- (bodagoera.icanera.space/verify/<code>) showed "Not a valid receipt" even
-- though the receipt genuinely existed. Calling icanera_verify_delivery_receipt
-- directly (same public RPC the page uses) returned:
--
--   {"code":"42703","message":"record \"v_receipt\" has no field
--    \"picked_up_confirmed_by_email\""}
--
-- icanera_verify_delivery_receipt (last redefined in
-- ADD_DELIVERY_ESCROW_DEADLINE_AND_RIDER_LIABILITY.sql) reads
-- v_receipt.picked_up_confirmed_by_email, but that column is only ever
-- added by ICAN/backend/ADD_DELIVERY_RECEIPT_APPROVAL_TRACKING.sql — which,
-- on this project, was apparently never actually run, even though later
-- migrations assume it was. PL/pgSQL doesn't validate %ROWTYPE field
-- references at CREATE FUNCTION time, only at first execution, so the
-- broken function deployed silently and only failed once actually called.
-- VerifyReceiptPage.tsx also ignored the RPC's `error`, so the real 42703
-- got masked as a generic "Not a valid receipt".
--
-- This is the missing half of ADD_DELIVERY_RECEIPT_APPROVAL_TRACKING.sql —
-- just the column, not its function bodies (those are stale relative to the
-- escrow-aware versions already live; re-running that whole file would
-- regress icanera_confirm_pickup back to a version without settlement-leg
-- release / delivery_due_at). Safe to run any time — additive, idempotent.
-- ============================================================================

ALTER TABLE public.icanera_delivery_receipts
  ADD COLUMN IF NOT EXISTS picked_up_confirmed_by_email TEXT;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ icanera_delivery_receipts.picked_up_confirmed_by_email added — icanera_verify_delivery_receipt and icanera_confirm_pickup can now actually run instead of failing with a hidden 42703.';
END $$;
