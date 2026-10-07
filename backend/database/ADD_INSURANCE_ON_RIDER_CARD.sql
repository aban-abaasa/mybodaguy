-- ============================================================================
-- INSURANCE ON THE LIVE RIDER CARD (BodaGoEra)
--
-- The rider's QR ID card (ADD_RIDER_ID_CARDS.sql) is answered live every time it is
-- scanned. This adds the rider's insurance cover to it: which company insures them,
-- which plan, until when, and whether the cover is active, in its grace days, expired
-- or missing. Nothing else about the policy is public: no price, no policy holder
-- details, only the insurer's name, the plan, the type of cover, a masked reference
-- (ICV-••••1234) and the end date.
--
-- WHERE THE COVER COMES FROM: ICAN/backend/ADD_INSURANCE_PLATFORM.sql (the same database).
-- Run that file FIRST. This one is safe to run without it too: the card then shows
-- insurance as "unavailable" and keeps working exactly as before — insurance can never
-- break the card.
--
-- What changes:
--   * mbg_rider_card_payload  — gains an 'insurance' object (card owner, chairpersons)
--   * mbg_verify_rider_card   — gains the same object on the public QR page
--   * mbg_rider_insurance_summary — new, internal wrapper that never throws
--   * mbg_business_driver_cover   — new: a company sees which of its drivers are covered
--
-- The card payload and QR check here also carry the card's one-year expiry and the rider's
-- next of kin / home (ADD_RIDER_CARD_EXPIRY_AND_KIN.sql), so this file and that one can be
-- run in either order.
--
-- Run after ADD_RIDER_ID_CARDS.sql. Safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The wrapper — the only thing that knows insurance may not be installed
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mbg_rider_insurance_summary(p_user_id UUID, p_rider_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF to_regprocedure('public.ins_policy_public_summary(uuid,uuid)') IS NULL THEN
    RETURN jsonb_build_object('state', 'unavailable', 'policies', '[]'::JSONB);
  END IF;
  RETURN public.ins_policy_public_summary(p_user_id, p_rider_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('state', 'unavailable', 'policies', '[]'::JSONB);
END;
$$;

REVOKE ALL ON FUNCTION public.mbg_rider_insurance_summary(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. Everything a card shows (same as before, plus 'insurance')
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mbg_rider_card_payload(p_card_id UUID)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'card_id',         c.id,
    'card_number',     c.card_number,
    'verify_code',     c.verify_code,
    'status',          c.status,
    'fee_ican',        c.fee_ican,
    'issued_at',       c.issued_at,
    'paid_at',         c.paid_at,
    'requested_by_rider', c.requested_by_rider,
    'requested_at',    c.requested_at,
    'rider_id',        r.id,
    'full_name',       COALESCE(NULLIF(btrim(up.full_name), ''), split_part(u.email, '@', 1)),
    'avatar_url',      up.avatar_url,
    'vehicle_type',    r.vehicle_type::text,
    'plate_number',    r.plate_number,
    'vehicle_model',   r.vehicle_model,
    'vehicle_color',   r.vehicle_color,
    'rider_status',    r.status::text,
    'rating',          r.rating,
    'completed_rides', r.completed_rides,
    'member_since',    r.created_at,
    'stage',           st.name,
    'parish',          pa.name,
    'subcounty',       sc.name,
    'division',        dv.name,
    'district',        di.name,
    -- Information that differs per division / stage (mbg_card_region_info)
    'division_code',          rd.code,
    'division_contact_name',  rd.contact_name,
    'division_contact_phone', rd.contact_phone,
    'division_notes',         rd.notes,
    'stage_code',             rs.code,
    'stage_contact_name',     rs.contact_name,
    'stage_contact_phone',    rs.contact_phone,
    'stage_notes',            rs.notes,
    'accent_color',           COALESCE(rs.accent_color, rd.accent_color),
    -- Driving permit (the number is masked; the full number never leaves here)
    'license_masked',     public.mbg_mask_license(r.license_number),
    'license_expiry',     r.license_expiry,
    'permit_status',      public.mbg_permit_status(r.license_expiry),
    'permit_days_left',   (r.license_expiry - current_date),
    -- The card's own one-year validity (ADD_RIDER_CARD_EXPIRY_AND_KIN.sql). Read through
    -- jsonb so this works before that file is run; an expired card owes its fee again.
    'expires_at',         (to_jsonb(c) ->> 'expires_at'),
    'card_expired',       x.expired,
    'card_days_left',     CASE WHEN c.status = 'active' AND (to_jsonb(c) ->> 'expires_at') IS NOT NULL
                               THEN ((to_jsonb(c) ->> 'expires_at')::timestamptz::date - current_date) END,
    -- Fees to the chairpersons: the card fee, and ride commission still owed
    -- (read through jsonb so this works before ADD_CASH_COMMISSION_DEBT_TRACKING.sql).
    'card_fee_status',    CASE WHEN c.status = 'pending_payment' OR x.expired THEN 'pending'
                               WHEN c.status = 'active' THEN 'paid'
                               ELSE 'cancelled' END,
    'commission_owed_ugx', COALESCE((to_jsonb(r) ->> 'cash_commission_debt_ugx')::numeric, 0),
    'fees_status',        CASE WHEN c.status = 'pending_payment' OR x.expired
                                 OR COALESCE((to_jsonb(r) ->> 'cash_commission_debt_ugx')::numeric, 0) > 0
                               THEN 'pending' ELSE 'paid' END,
    -- Next of kin and home: for the rider and the chairpersons over them, never the public QR.
    'next_of_kin_name',         (to_jsonb(r) ->> 'next_of_kin_name'),
    'next_of_kin_phone',        (to_jsonb(r) ->> 'next_of_kin_phone'),
    'next_of_kin_relationship', (to_jsonb(r) ->> 'next_of_kin_relationship'),
    'home_location',            (to_jsonb(r) ->> 'home_location')
  ) || jsonb_build_object(
    -- Insurance cover: { state: active | grace | waiting | expired | none | unavailable, policies: [...] }
    'insurance',          public.mbg_rider_insurance_summary(r.user_id, r.id)
  )
  FROM public.mbg_rider_cards c
  CROSS JOIN LATERAL (
    SELECT COALESCE(c.status = 'active' AND (to_jsonb(c) ->> 'expires_at')::timestamptz < now(), false) AS expired
  ) x
  JOIN public.mbg_riders r  ON r.id = c.rider_id
  JOIN public.mbg_users  u  ON u.id = r.user_id
  LEFT JOIN public.mbg_user_profiles up ON up.user_id = r.user_id
  LEFT JOIN public.mbg_stages      st ON st.id = r.stage_id
  LEFT JOIN public.mbg_parishes    pa ON pa.id = st.parish_id
  LEFT JOIN public.mbg_subcounties sc ON sc.id = pa.subcounty_id
  LEFT JOIN public.mbg_divisions   dv ON dv.id = sc.division_id
  LEFT JOIN public.mbg_districts   di ON di.id = dv.district_id
  LEFT JOIN public.mbg_card_region_info rs ON rs.region_type = 'stage'    AND rs.region_id = st.id
  LEFT JOIN public.mbg_card_region_info rd ON rd.region_type = 'division' AND rd.region_id = dv.id
  WHERE c.id = p_card_id;
$$;

REVOKE ALL ON FUNCTION public.mbg_rider_card_payload(UUID) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. Public QR check — answered live, public-safe details only (+ insurance)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mbg_verify_rider_card(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id      UUID;
  v_card    JSONB;
  v_state   TEXT;
BEGIN
  IF p_code IS NULL OR length(p_code) < 16 OR length(p_code) > 64 OR p_code !~ '^[A-Za-z0-9]+$' THEN
    RETURN jsonb_build_object('is_valid', false);
  END IF;

  SELECT c.id INTO v_id FROM public.mbg_rider_cards c WHERE c.verify_code = p_code;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('is_valid', false);
  END IF;

  v_card := public.mbg_rider_card_payload(v_id);

  v_state := CASE
    WHEN v_card ->> 'status' = 'revoked'         THEN 'cancelled'
    WHEN v_card ->> 'status' = 'pending_payment' THEN 'unpaid'
    WHEN (v_card ->> 'card_expired')::boolean    THEN 'expired'
    WHEN v_card ->> 'rider_status' <> 'active'   THEN 'suspended'
    ELSE 'valid'
  END;

  -- An unpaid, cancelled or expired card is not a card: say so, and nothing about the rider.
  IF v_state IN ('unpaid', 'cancelled', 'expired') THEN
    RETURN jsonb_build_object(
      'is_valid', false, 'state', v_state, 'card_number', v_card ->> 'card_number',
      'expires_at', CASE WHEN v_state = 'expired' THEN v_card ->> 'expires_at' END
    );
  END IF;

  RETURN jsonb_build_object(
    'is_valid',        v_state = 'valid',
    'state',           v_state,
    'card_number',     v_card ->> 'card_number',
    'full_name',       v_card ->> 'full_name',
    'avatar_url',      v_card ->> 'avatar_url',
    'vehicle_type',    v_card ->> 'vehicle_type',
    'vehicle_model',   v_card ->> 'vehicle_model',
    'vehicle_color',   v_card ->> 'vehicle_color',
    'plate_number',    v_card ->> 'plate_number',
    'rating',          v_card -> 'rating',
    'completed_rides', v_card -> 'completed_rides',
    'member_since',    v_card ->> 'member_since',
    'issued_at',       v_card ->> 'issued_at',
    'expires_at',      v_card ->> 'expires_at',
    'stage',           v_card ->> 'stage',
    'parish',          v_card ->> 'parish',
    'subcounty',       v_card ->> 'subcounty',
    'division',        v_card ->> 'division',
    'district',        v_card ->> 'district',
    'division_code',          v_card ->> 'division_code',
    'division_contact_name',  v_card ->> 'division_contact_name',
    'division_contact_phone', v_card ->> 'division_contact_phone',
    'division_notes',         v_card ->> 'division_notes',
    'stage_code',             v_card ->> 'stage_code',
    'stage_contact_name',     v_card ->> 'stage_contact_name',
    'stage_contact_phone',    v_card ->> 'stage_contact_phone',
    'stage_notes',            v_card ->> 'stage_notes',
    'accent_color',           v_card ->> 'accent_color',
    'license_masked',         v_card ->> 'license_masked',
    'license_expiry',         v_card ->> 'license_expiry',
    'permit_status',          v_card ->> 'permit_status',
    'permit_days_left',       v_card -> 'permit_days_left',
    'fees', jsonb_build_object(
      'status',              v_card ->> 'fees_status',
      'card_fee_ican',       v_card -> 'fee_ican',
      'card_fee_status',     v_card ->> 'card_fee_status',
      'card_fee_paid_at',    v_card ->> 'paid_at',
      'commission_owed_ugx', v_card -> 'commission_owed_ugx'
    ),
    'insurance',              v_card -> 'insurance'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mbg_verify_rider_card(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mbg_verify_rider_card(TEXT) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. A company's drivers and their cover, for the Drivers roster
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mbg_business_driver_cover(p_business_profile_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.ican_business_member(p_business_profile_id) THEN
    RETURN '[]'::JSONB;
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'rider_id', r.id,
             'insurance', public.mbg_rider_insurance_summary(r.user_id, r.id)))
      FROM public.mbg_riders r
     WHERE r.business_profile_id = p_business_profile_id
  ), '[]'::JSONB);
END;
$$;

REVOKE ALL ON FUNCTION public.mbg_business_driver_cover(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mbg_business_driver_cover(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ The live rider card now shows insurance cover (insurer, plan, valid until). Insurance companies and plans come from ICAN/backend/ADD_INSURANCE_PLATFORM.sql.';
END $$;
