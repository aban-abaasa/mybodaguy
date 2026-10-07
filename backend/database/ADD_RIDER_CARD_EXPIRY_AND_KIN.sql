-- ============================================================================
-- RIDER ID CARD: ONE-YEAR EXPIRY, NEXT OF KIN, HOME LOCATION
--
-- 1. EXPIRY. A rider's QR ID card is valid for ONE YEAR from the day it is paid
--    (developer-editable: mbg_platform_settings 'rider_card.validity_months', default 12).
--    * Every card that is already paid gets paid_at + 1 year (a card paid 14 months ago
--      is therefore already expired and must be renewed).
--    * An expired card stops verifying: the QR page says "Card expired" and shows nothing
--      about the rider. It cannot be printed.
--    * RENEWING = paying the card fee again on the SAME card (mbg_pay_rider_card). It is
--      open once the card is expired or has 30 days or fewer left, and the new year is
--      added on top of the days still left, so renewing early loses nothing. The fee is
--      shared through the tree exactly like the first payment.
--
-- 2. NEXT OF KIN + HOME LOCATION. Stored on the rider's record (mbg_riders):
--    next_of_kin_name, next_of_kin_phone, next_of_kin_relationship, home_location.
--    The rider fills them in from My Card; their district chairperson can fill them in
--    for them (mbg_set_rider_kin_details). They are printed on the BACK of the card and
--    are visible to the rider and to the chairpersons over them. They are NOT returned
--    by the public QR check: a stranger who scans a card never sees a family member's
--    phone number or where the rider sleeps.
--
-- Run after ADD_RIDER_ID_CARDS.sql. Run ADD_INSURANCE_ON_RIDER_CARD.sql before OR after
-- this file: both define the same card payload (it has been updated to match), and this
-- file keeps working whether or not insurance is installed. Safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Validity setting
-- ----------------------------------------------------------------------------
INSERT INTO public.mbg_platform_settings (key, value, value_type, description, category, is_public)
VALUES (
  'rider_card.validity_months', '12', 'number',
  'How many months a paid rider ID card stays valid before it must be renewed (paying the card fee again). Developer-editable.',
  'rider_card', true
)
ON CONFLICT (key) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 2. Columns
-- ----------------------------------------------------------------------------
ALTER TABLE public.mbg_rider_cards
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- Cards that were paid before expiry existed: one year from the day they were paid.
UPDATE public.mbg_rider_cards
   SET expires_at = COALESCE(paid_at, issued_at) + INTERVAL '1 year'
 WHERE status = 'active' AND expires_at IS NULL;

ALTER TABLE public.mbg_riders
  ADD COLUMN IF NOT EXISTS next_of_kin_name         TEXT,
  ADD COLUMN IF NOT EXISTS next_of_kin_phone        TEXT,
  ADD COLUMN IF NOT EXISTS next_of_kin_relationship TEXT,
  ADD COLUMN IF NOT EXISTS home_location            TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mbg_riders_kin_lengths') THEN
    ALTER TABLE public.mbg_riders ADD CONSTRAINT mbg_riders_kin_lengths CHECK (
      (next_of_kin_name         IS NULL OR char_length(next_of_kin_name)         <= 80)  AND
      (next_of_kin_phone        IS NULL OR char_length(next_of_kin_phone)        <= 24)  AND
      (next_of_kin_relationship IS NULL OR char_length(next_of_kin_relationship) <= 30)  AND
      (home_location            IS NULL OR char_length(home_location)            <= 160)
    );
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 3. Insurance stays optional: if it is not installed, the card says "unavailable"
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.mbg_rider_insurance_summary(uuid,uuid)') IS NULL THEN
    EXECUTE $f$
      CREATE FUNCTION public.mbg_rider_insurance_summary(p_user_id UUID, p_rider_id UUID)
      RETURNS JSONB
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
      'SELECT jsonb_build_object(''state'', ''unavailable'', ''policies'', ''[]''::JSONB)'
    $f$;
    REVOKE ALL ON FUNCTION public.mbg_rider_insurance_summary(UUID, UUID) FROM PUBLIC, anon, authenticated;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 4. Everything a card shows (same as before, plus expiry, next of kin, home)
--    New columns are read through jsonb so an old row shape never breaks it.
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
    -- The card's own one-year validity. An expired card owes its fee again (to renew).
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
-- 5. District chairperson: the riders list, now with kin and home for riders
--    who have no card yet (so the chairperson can fill them in)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mbg_get_district_riders_for_cards()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_districts UUID[] := public.mbg_my_district_ids();
BEGIN
  IF cardinality(v_districts) = 0 THEN
    RETURN '[]'::jsonb;
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(row_json ORDER BY sort_district, sort_stage, sort_name)
    FROM (
      SELECT
        di.name AS sort_district,
        st.name AS sort_stage,
        COALESCE(NULLIF(btrim(up.full_name), ''), split_part(u.email, '@', 1)) AS sort_name,
        jsonb_build_object(
          'rider_id',     r.id,
          'full_name',    COALESCE(NULLIF(btrim(up.full_name), ''), split_part(u.email, '@', 1)),
          'avatar_url',   up.avatar_url,
          'vehicle_type', r.vehicle_type::text,
          'plate_number', r.plate_number,
          'rider_status', r.status::text,
          'stage',        st.name,
          'parish',       pa.name,
          'subcounty',    sc.name,
          'division',     dv.name,
          'district',     di.name,
          -- Chairperson-only: the full permit number, so it can be corrected.
          'license_number',  r.license_number,
          'license_expiry',  r.license_expiry,
          'permit_status',   public.mbg_permit_status(r.license_expiry),
          'permit_days_left', (r.license_expiry - current_date),
          'next_of_kin_name',         r.next_of_kin_name,
          'next_of_kin_phone',        r.next_of_kin_phone,
          'next_of_kin_relationship', r.next_of_kin_relationship,
          'home_location',            r.home_location,
          'card',         CASE WHEN c.id IS NULL THEN NULL ELSE public.mbg_rider_card_payload(c.id) END
        ) AS row_json
      FROM public.mbg_riders r
      JOIN public.mbg_users      u  ON u.id  = r.user_id
      JOIN public.mbg_stages     st ON st.id = r.stage_id
      JOIN public.mbg_parishes   pa ON pa.id = st.parish_id
      JOIN public.mbg_subcounties sc ON sc.id = pa.subcounty_id
      JOIN public.mbg_divisions  dv ON dv.id = sc.division_id
      JOIN public.mbg_districts  di ON di.id = dv.district_id
      LEFT JOIN public.mbg_user_profiles up ON up.user_id = r.user_id
      LEFT JOIN LATERAL (
        SELECT c1.id
          FROM public.mbg_rider_cards c1
         WHERE c1.rider_id = r.id AND c1.status IN ('pending_payment', 'active')
         ORDER BY c1.issued_at DESC
         LIMIT 1
      ) c ON true
      WHERE dv.district_id = ANY (v_districts)
    ) s
  ), '[]'::jsonb);
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. Next of kin + home location — the rider for themselves, or their district
--    chairperson. A blank field clears it. Returns the refreshed card if there is one.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mbg_set_rider_kin_details(
  p_rider_id     UUID,
  p_kin_name     TEXT DEFAULT NULL,
  p_kin_phone    TEXT DEFAULT NULL,
  p_kin_relation TEXT DEFAULT NULL,
  p_home         TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_districts   UUID[] := public.mbg_my_district_ids();
  v_district_id UUID;
  v_owner       UUID;
  v_name        TEXT := NULLIF(btrim(p_kin_name), '');
  v_phone       TEXT := NULLIF(btrim(p_kin_phone), '');
  v_relation    TEXT := NULLIF(btrim(p_kin_relation), '');
  v_home        TEXT := NULLIF(btrim(p_home), '');
  v_card_id     UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Please sign in');
  END IF;

  SELECT r.user_id INTO v_owner FROM public.mbg_riders r WHERE r.id = p_rider_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Rider not found');
  END IF;

  IF v_owner <> auth.uid() THEN
    v_district_id := public.mbg_rider_district_id(p_rider_id);
    IF v_district_id IS NULL OR NOT (v_district_id = ANY (v_districts)) THEN
      RETURN jsonb_build_object('success', false, 'error', 'You can only edit your own details');
    END IF;
  END IF;

  IF v_name IS NOT NULL AND char_length(v_name) > 80 THEN
    RETURN jsonb_build_object('success', false, 'error', 'The next of kin''s name can be at most 80 characters');
  END IF;
  IF v_phone IS NOT NULL AND (char_length(v_phone) > 24 OR v_phone !~ '^[0-9+()\s-]{7,}$') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Enter a valid phone number for the next of kin');
  END IF;
  IF v_relation IS NOT NULL AND char_length(v_relation) > 30 THEN
    RETURN jsonb_build_object('success', false, 'error', 'The relationship can be at most 30 characters');
  END IF;
  IF v_home IS NOT NULL AND char_length(v_home) > 160 THEN
    RETURN jsonb_build_object('success', false, 'error', 'The home location can be at most 160 characters');
  END IF;
  -- A contact with a name but no number (or the reverse) is of no use in an emergency.
  IF (v_name IS NULL) <> (v_phone IS NULL) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Give both the next of kin''s name and phone number, or leave both blank');
  END IF;

  UPDATE public.mbg_riders
     SET next_of_kin_name = v_name,
         next_of_kin_phone = v_phone,
         next_of_kin_relationship = v_relation,
         home_location = v_home,
         updated_at = now()
   WHERE id = p_rider_id;

  SELECT c.id INTO v_card_id
    FROM public.mbg_rider_cards c
   WHERE c.rider_id = p_rider_id AND c.status IN ('pending_payment', 'active')
   ORDER BY c.issued_at DESC
   LIMIT 1;

  RETURN jsonb_build_object(
    'success', true,
    'card', CASE WHEN v_card_id IS NULL THEN NULL ELSE public.mbg_rider_card_payload(v_card_id) END
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. Pay the fee — activate a new card OR renew one that has expired / is about to
--
-- One transaction: if anything after the debit raises, the debit rolls back
-- with it. A declined debit (insufficient ICAN, no wallet) is returned as an
-- error with nothing changed. Every payment sets expires_at one validity period
-- on from the later of "now" and the current expiry.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mbg_pay_rider_card(p_card_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_levels  CONSTANT TEXT[] := ARRAY['stage', 'parish', 'subcounty', 'division', 'district'];
  v_card    public.mbg_rider_cards%ROWTYPE;
  v_status  TEXT;
  v_debit   JSONB;
  v_part    NUMERIC;
  v_rid     UUID;
  v_users   UUID[];
  v_user    UUID;
  v_each    NUMERIC;
  v_ref     TEXT;
  v_renewal BOOLEAN := false;
  v_months  INT;
  v_base    TIMESTAMPTZ;
  i         INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Please sign in');
  END IF;

  SELECT * INTO v_card FROM public.mbg_rider_cards WHERE id = p_card_id FOR UPDATE;
  IF NOT FOUND OR v_card.rider_user_id <> auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Card not found');
  END IF;

  IF v_card.status = 'active' THEN
    -- Paid and still comfortably valid: nothing to do (a double tap is harmless).
    IF v_card.expires_at IS NOT NULL AND v_card.expires_at > now() + INTERVAL '30 days' THEN
      RETURN jsonb_build_object('success', true, 'already_paid', true,
                                'card', public.mbg_rider_card_payload(v_card.id));
    END IF;
    -- A paid card with no expiry yet (SQL run mid-way): give it one without charging.
    IF v_card.expires_at IS NULL THEN
      UPDATE public.mbg_rider_cards
         SET expires_at = COALESCE(v_card.paid_at, v_card.issued_at) + INTERVAL '1 year', updated_at = now()
       WHERE id = v_card.id;
      RETURN jsonb_build_object('success', true, 'already_paid', true,
                                'card', public.mbg_rider_card_payload(v_card.id));
    END IF;
    v_renewal := true;
  ELSIF v_card.status <> 'pending_payment' THEN
    RETURN jsonb_build_object('success', false, 'error', 'This card was cancelled');
  END IF;

  SELECT r.status::text INTO v_status FROM public.mbg_riders r WHERE r.id = v_card.rider_id;
  IF v_status IS DISTINCT FROM 'active' THEN
    RETURN jsonb_build_object('success', false, 'error',
      CASE WHEN v_renewal THEN 'Your rider account is not active, so this card cannot be renewed'
           ELSE 'Your rider account is not active, so this card cannot be paid for' END);
  END IF;

  -- A renewal is its own payment, so it gets its own reference (the first payment keeps the old one).
  -- It is keyed on the expiry being renewed: every renewal moves that date on, so each one is unique,
  -- and the row lock above makes a double tap see the new date and stop at "already paid".
  v_ref := 'rider_card:' || v_card.id::text
           || CASE WHEN v_renewal THEN ':renew:' || floor(extract(epoch FROM v_card.expires_at))::bigint::text ELSE '' END;
  v_debit := public.mbg_debit_journey_fare(auth.uid(), v_card.fee_ican, 'mybodaguy', v_ref);
  IF NOT COALESCE((v_debit ->> 'success')::BOOLEAN, false) THEN
    RETURN jsonb_build_object('success', false,
                              'error', COALESCE(v_debit ->> 'error', 'Wallet payment failed'));
  END IF;

  -- Share the fee: one equal part per level of the rider's chain.
  v_part := v_card.fee_ican / cardinality(v_levels);

  FOR i IN 1 .. cardinality(v_levels) LOOP
    IF i = 1 THEN
      SELECT r.stage_id INTO v_rid FROM public.mbg_riders r WHERE r.id = v_card.rider_id;
    ELSE
      SELECT rp.parent_id INTO v_rid FROM public.mbg_region_parent(v_levels[i - 1], v_rid) rp;
    END IF;

    v_users := NULL;
    IF v_rid IS NOT NULL THEN
      SELECT array_agg(DISTINCT cm.user_id) INTO v_users
        FROM public.mbg_committee_members cm
       WHERE cm.region_type::text = v_levels[i]
         AND cm.region_id = v_rid
         AND cm.is_active = true;
    END IF;

    IF v_users IS NULL THEN
      -- Nobody holds this level: ICANera keeps its part (recorded, not credited).
      INSERT INTO public.mbg_rider_card_shares (card_id, level, region_id, recipient_user_id, amount_ican)
      VALUES (v_card.id, v_levels[i], v_rid, NULL, v_part);
      CONTINUE;
    END IF;

    v_each := ROUND(v_part / cardinality(v_users), 8);
    FOREACH v_user IN ARRAY v_users LOOP
      IF v_each > 0 THEN
        PERFORM public.mbg_credit_ride_earning(
          v_user, v_each, 'mybodaguy', v_ref,
          v_levels[i] || ' chairperson share of rider ID card ' || v_card.card_number
            || CASE WHEN v_renewal THEN ' (renewal)' ELSE '' END
        );
      END IF;
      INSERT INTO public.mbg_rider_card_shares (card_id, level, region_id, recipient_user_id, amount_ican)
      VALUES (v_card.id, v_levels[i], v_rid, v_user, v_each);
    END LOOP;
  END LOOP;

  -- A new year, added on top of whatever is still left of the current one.
  v_months := GREATEST(1, COALESCE(public.mbg_get_setting_numeric('rider_card.validity_months', 12), 12)::INT);
  v_base := CASE WHEN v_renewal THEN GREATEST(now(), v_card.expires_at) ELSE now() END;

  UPDATE public.mbg_rider_cards
     SET status = 'active',
         paid_at = now(),
         payment_tx_id = NULLIF(v_debit ->> 'tx_id', '')::UUID,
         expires_at = v_base + make_interval(months => v_months),
         updated_at = now()
   WHERE id = v_card.id;

  RETURN jsonb_build_object('success', true, 'renewed', v_renewal,
                            'card', public.mbg_rider_card_payload(v_card.id));
END;
$$;

-- ----------------------------------------------------------------------------
-- 8. Public QR check — an expired card no longer verifies
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
    -- Deliberately NOT here: next of kin and home location.
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 9. Grants
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.mbg_get_district_riders_for_cards()   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mbg_set_rider_kin_details(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mbg_pay_rider_card(UUID)              FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mbg_verify_rider_card(TEXT)           FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.mbg_get_district_riders_for_cards()   TO authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_set_rider_kin_details(UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_pay_rider_card(UUID)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_verify_rider_card(TEXT)           TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ Rider cards now expire after 1 year (renew by paying the fee again), and carry next of kin + home location (private to the rider and their chairpersons).';
END $$;
