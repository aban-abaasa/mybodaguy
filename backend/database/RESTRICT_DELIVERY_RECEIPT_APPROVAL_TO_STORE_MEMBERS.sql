-- A delivery QR is useful to its customer and assigned rider, but strangers
-- must not inspect it and only an active member of the issuing store can
-- verify pickup and release the escrowed settlement legs.

CREATE OR REPLACE FUNCTION public.icanera_is_delivery_store_member(
  p_store_owner_user_id uuid,
  p_auth_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_auth_user_id IS NOT NULL AND (
    p_auth_user_id = p_store_owner_user_id
    OR EXISTS (
      SELECT 1
      FROM public.business_profiles bp
      JOIN public.business_account_members bam
        ON bam.business_profile_id = bp.id
      WHERE bp.user_id = p_store_owner_user_id
        AND bam.auth_user_id = p_auth_user_id
        AND bam.employment_status = 'active'
    )
  );
$$;
REVOKE ALL ON FUNCTION public.icanera_is_delivery_store_member(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.icanera_confirm_pickup(p_verification_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receipt public.icanera_delivery_receipts%ROWTYPE;
  v_email text;
  v_leg jsonb;
  v_leg_index int := 0;
  v_tx_id text;
  v_has_legs boolean;
  v_due_at timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sign in with a company account to approve this pickup.');
  END IF;

  SELECT * INTO v_receipt
  FROM public.icanera_delivery_receipts
  WHERE verification_code = upper(p_verification_code)
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Receipt not found.');
  END IF;

  IF NOT public.icanera_is_delivery_store_member(v_receipt.store_owner_user_id, auth.uid()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only an active member of the issuing store can verify pickup.');
  END IF;

  IF v_receipt.status <> 'paid' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', CASE
        WHEN v_receipt.status IN ('picked_up', 'delivered') THEN
          'Already approved by ' || COALESCE(v_receipt.picked_up_confirmed_by_email, 'someone')
            || ' at ' || to_char(v_receipt.picked_up_at, 'YYYY-MM-DD HH24:MI')
        ELSE 'This receipt is not awaiting pickup'
      END,
      'status', v_receipt.status,
      'picked_up_by_email', v_receipt.picked_up_confirmed_by_email,
      'picked_up_at', v_receipt.picked_up_at
    );
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();
  v_has_legs := v_receipt.settlement_legs IS NOT NULL
    AND jsonb_array_length(v_receipt.settlement_legs) > 0;

  IF v_has_legs THEN
    FOR v_leg IN SELECT * FROM jsonb_array_elements(v_receipt.settlement_legs) LOOP
      v_leg_index := v_leg_index + 1;
      v_tx_id := 'DLV_' || v_receipt.verification_code || '_LEG' || v_leg_index;
      IF COALESCE(v_leg->>'payee_type', 'business') = 'personal' THEN
        PERFORM public.mbg_credit_ride_earning(
          (v_leg->>'payee_id')::uuid,
          (v_leg->>'ican_amount')::numeric,
          v_receipt.source_app,
          v_tx_id,
          COALESCE(v_leg->>'note', 'Delivery order settlement')
        );
      ELSE
        PERFORM public.ican_settle_business_wallet_income(
          (v_leg->>'payee_id')::uuid,
          (v_leg->>'ican_amount')::numeric,
          v_receipt.source_app,
          v_tx_id,
          'pos_sale',
          COALESCE(v_leg->>'note', 'Delivery order settlement'),
          jsonb_build_object(
            'receipt_id', v_receipt.id,
            'reference_type', v_receipt.reference_type,
            'reference_id', v_receipt.reference_id
          )
        );
      END IF;
    END LOOP;
  END IF;

  IF v_receipt.max_delivery_hours IS NOT NULL THEN
    v_due_at := now() + (v_receipt.max_delivery_hours || ' hours')::interval;
  END IF;

  UPDATE public.icanera_delivery_receipts
  SET status = 'picked_up',
      picked_up_at = now(),
      picked_up_confirmed_by = auth.uid(),
      picked_up_confirmed_by_email = v_email,
      settled = v_has_legs,
      settled_at = CASE WHEN v_has_legs THEN now() ELSE NULL END,
      delivery_due_at = v_due_at
  WHERE id = v_receipt.id;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'picked_up',
    'picked_up_by_email', v_email,
    'delivery_due_at', v_due_at
  );
END;
$$;
REVOKE ALL ON FUNCTION public.icanera_confirm_pickup(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.icanera_confirm_pickup(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.icanera_verify_delivery_receipt(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receipt public.icanera_delivery_receipts%ROWTYPE;
  v_is_store_member boolean;
  v_is_related_party boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('is_valid', false, 'membership_required', true);
  END IF;

  SELECT * INTO v_receipt
  FROM public.icanera_delivery_receipts
  WHERE verification_code = upper(p_code);

  IF NOT FOUND THEN
    RETURN jsonb_build_object('is_valid', false);
  END IF;

  v_is_store_member := public.icanera_is_delivery_store_member(v_receipt.store_owner_user_id, auth.uid());
  v_is_related_party := auth.uid() = v_receipt.customer_user_id
    OR auth.uid() = v_receipt.rider_user_id;

  IF NOT v_is_store_member AND NOT v_is_related_party THEN
    RETURN jsonb_build_object('is_valid', false, 'membership_required', true);
  END IF;

  RETURN jsonb_build_object(
    'is_valid', true,
    'status', v_receipt.status,
    'store_name', v_receipt.store_name,
    'item_summary', v_receipt.item_summary,
    'goods_snapshot', v_receipt.goods_snapshot,
    'created_at', v_receipt.created_at,
    'picked_up_at', v_receipt.picked_up_at,
    'picked_up_by_email', v_receipt.picked_up_confirmed_by_email,
    'delivered_at', v_receipt.delivered_at,
    'delivered_by_email', v_receipt.delivered_confirmed_by_email,
    'delivery_due_at', v_receipt.delivery_due_at,
    'is_overdue', (v_receipt.overdue_warned_at IS NOT NULL AND v_receipt.refunded_at IS NULL),
    'refunded_at', v_receipt.refunded_at,
    'is_customer', auth.uid() = v_receipt.customer_user_id,
    'can_confirm_pickup', v_is_store_member
  );
END;
$$;
REVOKE ALL ON FUNCTION public.icanera_verify_delivery_receipt(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.icanera_verify_delivery_receipt(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
