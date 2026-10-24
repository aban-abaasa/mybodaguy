-- ============================================================================
-- Ride a rider straight from the QR on their ID card — with or without an account.
--
-- The QR on a rider's card (https://bodagoera.icanera.space/rider-card/<code>) used
-- to open the public verification page only. Now anybody who scans it can also
-- ask THAT rider for a ride from the same page, pay in whichever way suits them,
-- and follow / cancel the request — without ever creating an account.
--
-- Paying:
--   · Mobile money, card or cash — no account needed. The customer pays the rider
--     directly; the ride settles like any cash ride (the customer pays the fare
--     plus the platform's transaction fee, the rider keeps exactly the fare and the
--     fee is taken from the rider's wallet at the end of the trip). The
--     transaction fee is the existing commission.icanera_platform_fee_percentage.
--   · ICAN wallet — needs a (free) account. Rides paid this way are NOT charged the
--     transaction fee: the wallet is debited the fare only, the rider is credited
--     the whole fare, and nothing is owed on top. (mbg_rides.platform_charge_waived.)
--
-- Why a shared "guest" customer instead of anonymous sign-in: the sign-up
-- triggers on auth.users (all_users, ican_user_profiles, …) are shared with the
-- other apps and need an email, so an anonymous Supabase session would fail to
-- create. Guests are therefore booked under one internal customer account that
-- nobody can sign in to; who they really are lives on the ride (guest_name /
-- guest_phone) and a secret per-ride token (only its hash is stored) is what lets
-- the guest's browser see and cancel its own request.
--
-- What this file adds (all idempotent):
--   mbg_rides                       booked_via_card_qr, platform_charge_waived,
--                                   qr_pay_channel, guest_name, guest_phone,
--                                   guest_token_hash
--   mbg_card_ride_quote(...)        anon + authenticated: is the rider free, what
--                                   would the ride cost, what is the fee
--   mbg_card_ride_request(...)      anon + authenticated: creates the request
--   mbg_card_ride_status(...)       anon + authenticated: the guest's own view
--   mbg_card_ride_cancel(...)       anon + authenticated: the guest cancels
--   mbg_complete_ride               same as ADD_EXACT_FARE_AND_CHARGES_ON_TOP.sql
--                                   except a wallet-paid QR ride is not charged the fee
--
-- Run after ADD_RIDER_ID_CARDS.sql and ADD_EXACT_FARE_AND_CHARGES_ON_TOP.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Columns on the ride
-- ----------------------------------------------------------------------------

ALTER TABLE public.mbg_rides
  ADD COLUMN IF NOT EXISTS booked_via_card_qr     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS platform_charge_waived BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS qr_pay_channel         TEXT,
  ADD COLUMN IF NOT EXISTS guest_name             TEXT,
  ADD COLUMN IF NOT EXISTS guest_phone            TEXT,
  ADD COLUMN IF NOT EXISTS guest_token_hash       TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mbg_rides_qr_pay_channel_check') THEN
    ALTER TABLE public.mbg_rides
      ADD CONSTRAINT mbg_rides_qr_pay_channel_check
      CHECK (qr_pay_channel IS NULL OR qr_pay_channel IN ('mobile_money', 'card', 'cash', 'wallet'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS mbg_rides_guest_phone_open_idx
  ON public.mbg_rides (guest_phone)
  WHERE booked_via_card_qr AND guest_phone IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 2. The internal customer that guest rides are booked under. It has no
--    password and no identity, so nobody can ever sign in as it. Created
--    through auth.users so the normal sign-up triggers build its mbg_users /
--    mbg_customers rows (same column handling as CREATE_BODAGO_DEV_USER.sql:
--    the token columns must be '' and not NULL).
-- ----------------------------------------------------------------------------

DO $$
DECLARE
  v_email   CONSTANT TEXT := 'qr-guest@bodagoera.invalid';
  v_user_id UUID;
BEGIN
  SELECT id INTO v_user_id FROM auth.users WHERE lower(email) = v_email;

  IF v_user_id IS NULL THEN
    v_user_id := gen_random_uuid();
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, confirmation_token, recovery_token,
      email_change, email_change_token_new, email_change_token_current,
      phone_change, phone_change_token, reauthentication_token,
      raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated',
      v_email, '',
      now(), '', '',
      '', '', '',
      '', '', '',
      '{"provider":"email","providers":["email"]}', '{"full_name":"QR guest rider customer"}',
      now(), now()
    );
  END IF;

  -- The sign-up triggers normally do these; make sure, whichever way it was created.
  INSERT INTO public.mbg_users (id, email, role_type)
  VALUES (v_user_id, v_email, 'customer')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.mbg_customers (user_id)
  VALUES (v_user_id)
  ON CONFLICT (user_id) DO NOTHING;
END $$;

-- The guest customer's id, or NULL if section 2 has not run.
CREATE OR REPLACE FUNCTION public.mbg_qr_guest_customer_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id
    FROM public.mbg_customers c
    JOIN public.mbg_users u ON u.id = c.user_id
   WHERE u.email = 'qr-guest@bodagoera.invalid'
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.mbg_qr_guest_customer_id() FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. Which rider does this card code belong to?  Only an active, paid, unexpired
--    card whose rider is active resolves; anything else is NULL.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mbg_card_ride_rider(p_code TEXT)
RETURNS public.mbg_riders LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rider public.mbg_riders%ROWTYPE;
BEGIN
  IF p_code IS NULL OR length(p_code) < 16 OR length(p_code) > 64 OR p_code !~ '^[A-Za-z0-9]+$' THEN
    RETURN NULL;
  END IF;

  SELECT r.* INTO v_rider
    FROM public.mbg_rider_cards c
    JOIN public.mbg_riders r ON r.id = c.rider_id
   WHERE c.verify_code = p_code
     AND c.status = 'active'
     AND (c.expires_at IS NULL OR c.expires_at > now())
     AND r.status = 'active';
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  RETURN v_rider;
END;
$$;
REVOKE ALL ON FUNCTION public.mbg_card_ride_rider(TEXT) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. Quote: is this rider free right now, and what would the ride cost?
--    Coordinates are optional — without them only availability comes back.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mbg_card_ride_quote(
  p_code TEXT,
  p_pickup_lat NUMERIC DEFAULT NULL, p_pickup_lng NUMERIC DEFAULT NULL,
  p_dropoff_lat NUMERIC DEFAULT NULL, p_dropoff_lng NUMERIC DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rider       public.mbg_riders%ROWTYPE;
  v_distance_km NUMERIC;
  v_multiplier  NUMERIC := public.mbg_current_time_multiplier();
  v_fare        NUMERIC;
  v_charge      NUMERIC;
BEGIN
  v_rider := public.mbg_card_ride_rider(p_code);
  IF v_rider.id IS NULL THEN
    RETURN jsonb_build_object('available', false, 'reason', 'This rider card can not take rides right now.');
  END IF;

  IF NOT COALESCE(v_rider.is_available, false) THEN
    RETURN jsonb_build_object('available', false, 'reason', 'This rider is not taking rides at the moment. Please try again shortly.');
  END IF;
  IF EXISTS (SELECT 1 FROM public.mbg_rides WHERE rider_id = v_rider.id AND status = 'pending') THEN
    RETURN jsonb_build_object('available', false, 'reason', 'This rider already has a request waiting for an answer. Please try again in a moment.');
  END IF;

  IF p_pickup_lat IS NULL OR p_pickup_lng IS NULL OR p_dropoff_lat IS NULL OR p_dropoff_lng IS NULL THEN
    RETURN jsonb_build_object('available', true);
  END IF;

  v_distance_km := public.mbg_haversine_km(p_pickup_lat, p_pickup_lng, p_dropoff_lat, p_dropoff_lng);
  IF v_distance_km IS NULL THEN
    RETURN jsonb_build_object('available', true);
  END IF;

  v_fare   := public.mbg_price_ride_for_rider(v_rider, v_distance_km, v_multiplier, NULL, NULL);
  v_charge := public.mbg_ride_customer_charge_ugx(v_fare);

  RETURN jsonb_build_object(
    'available', true,
    'fare', v_fare,
    'distance_km', ROUND(v_distance_km, 2),
    'duration_min', GREATEST(2, ROUND(v_distance_km / 25 * 60)),
    'time_multiplier', v_multiplier,
    'transaction_fee', v_charge,
    'fee_pct', public.mbg_get_setting_numeric('commission.icanera_platform_fee_percentage', 8)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_card_ride_quote(TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5. Request the ride.
--
--   p_pay_channel  'mobile_money' | 'card' | 'cash'  — no account needed; the
--                  customer pays the rider directly, fare + transaction fee.
--                  'wallet' — needs a signed-in account; fare only, no fee.
--
-- Returns the ride id and a secret token. The token is the guest's only handle
-- on the ride (status / cancel), so it is shown once and only its hash is kept.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mbg_card_ride_request(
  p_code TEXT,
  p_pickup_location TEXT, p_pickup_lat NUMERIC, p_pickup_lng NUMERIC,
  p_dropoff_location TEXT, p_dropoff_lat NUMERIC, p_dropoff_lng NUMERIC,
  p_pay_channel TEXT,
  p_guest_name TEXT DEFAULT NULL,
  p_guest_phone TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid           UUID := auth.uid();
  v_rider         public.mbg_riders%ROWTYPE;
  v_customer_id   UUID;
  v_name          TEXT := left(btrim(COALESCE(p_guest_name, '')), 80);
  v_phone         TEXT := left(btrim(COALESCE(p_guest_phone, '')), 24);
  v_phone_digits  TEXT := regexp_replace(COALESCE(p_guest_phone, ''), '\D', '', 'g');
  v_waived        BOOLEAN;
  v_payment       TEXT;
  v_distance_km   NUMERIC;
  v_multiplier    NUMERIC := public.mbg_current_time_multiplier();
  v_fare          NUMERIC;
  v_is_boda       BOOLEAN;
  v_is_company    BOOLEAN;
  v_charge        NUMERIC;
  v_rider_earning NUMERIC;
  v_chair_total   NUMERIC;
  v_platform_net  NUMERIC;
  v_stage_id      UUID;
  v_ride_id       UUID;
  v_token         UUID := gen_random_uuid();
  v_notes         TEXT;
  v_channel_label TEXT;
BEGIN
  IF p_pay_channel IS NULL OR p_pay_channel NOT IN ('mobile_money', 'card', 'cash', 'wallet') THEN
    RAISE EXCEPTION 'Choose how you will pay: mobile money, card, cash or ICAN wallet';
  END IF;
  IF p_pay_channel = 'wallet' AND v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to pay with your ICAN wallet. It is the only way to ride with no transaction fee.';
  END IF;

  -- Without an account the rider must still know who is coming and how to ring them.
  IF v_uid IS NULL THEN
    IF length(v_name) < 2 THEN
      RAISE EXCEPTION 'Please tell the rider your name';
    END IF;
    IF length(v_phone_digits) < 9 OR length(v_phone_digits) > 15 THEN
      RAISE EXCEPTION 'Please give a phone number the rider can reach you on';
    END IF;
  END IF;

  IF p_pickup_lat IS NULL OR p_pickup_lng IS NULL OR p_dropoff_lat IS NULL OR p_dropoff_lng IS NULL
     OR p_pickup_lat NOT BETWEEN -90 AND 90 OR p_dropoff_lat NOT BETWEEN -90 AND 90
     OR p_pickup_lng NOT BETWEEN -180 AND 180 OR p_dropoff_lng NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'Choose where you are and where you are going';
  END IF;

  v_rider := public.mbg_card_ride_rider(p_code);
  IF v_rider.id IS NULL THEN
    RAISE EXCEPTION 'This rider card can not take rides right now';
  END IF;
  IF v_uid IS NOT NULL AND v_rider.user_id = v_uid THEN
    RAISE EXCEPTION 'You can not book a ride with your own card';
  END IF;
  IF NOT COALESCE(v_rider.is_available, false) THEN
    RAISE EXCEPTION 'This rider is not taking rides at the moment. Please try again shortly.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.mbg_rides WHERE rider_id = v_rider.id AND status = 'pending') THEN
    RAISE EXCEPTION 'This rider already has a request waiting for an answer. Please try again in a moment.';
  END IF;

  -- One open ride per phone, and a ceiling per hour, so a scanned card can not be used to spam a rider.
  IF length(v_phone_digits) >= 9 THEN
    IF EXISTS (
      SELECT 1 FROM public.mbg_rides
       WHERE booked_via_card_qr AND guest_phone = v_phone
         AND status IN ('pending', 'accepted', 'in_progress')
    ) THEN
      RAISE EXCEPTION 'You already have a ride request open. Cancel it or wait for it to finish first.';
    END IF;
    IF (SELECT count(*) FROM public.mbg_rides
         WHERE booked_via_card_qr AND guest_phone = v_phone
           AND requested_at > now() - interval '1 hour') >= 5 THEN
      RAISE EXCEPTION 'Too many requests from this phone. Please try again later.';
    END IF;
  END IF;

  v_distance_km := public.mbg_haversine_km(p_pickup_lat, p_pickup_lng, p_dropoff_lat, p_dropoff_lng);
  IF v_distance_km IS NULL OR v_distance_km > 500 THEN
    RAISE EXCEPTION 'Invalid pickup/dropoff coordinates';
  END IF;

  v_fare       := public.mbg_price_ride_for_rider(v_rider, v_distance_km, v_multiplier, NULL, NULL);
  v_is_boda    := v_rider.vehicle_type::TEXT IN ('motorcycle', 'bicycle', 'tuktuk');
  v_is_company := v_rider.business_profile_id IS NOT NULL;

  -- ICAN wallet = no transaction fee. Everything else pays the usual charge on top.
  v_waived  := (p_pay_channel = 'wallet');
  v_payment := CASE WHEN v_waived THEN 'wallet' ELSE 'cash' END;

  SELECT s.o_customer_charge, s.o_rider_earning, s.o_chair_total, s.o_platform_net
    INTO v_charge, v_rider_earning, v_chair_total, v_platform_net
    FROM public.mbg_compute_ride_charges(v_fare, v_is_boda, v_is_company) s;
  IF v_waived THEN
    v_charge := 0; v_chair_total := 0; v_platform_net := 0;
  END IF;

  -- Whose ride is it? A signed-in person keeps it in their own account; a guest rides under the shared guest customer.
  IF v_uid IS NOT NULL THEN
    SELECT id INTO v_customer_id FROM public.mbg_customers WHERE user_id = v_uid;
    IF v_customer_id IS NULL THEN
      INSERT INTO public.mbg_customers (user_id) VALUES (v_uid) RETURNING id INTO v_customer_id;
    END IF;
  ELSE
    v_customer_id := public.mbg_qr_guest_customer_id();
    IF v_customer_id IS NULL THEN
      RAISE EXCEPTION 'Guest rides are not set up yet';
    END IF;
  END IF;

  SELECT id INTO v_stage_id FROM public.mbg_stages
   WHERE is_active = true AND location_lat IS NOT NULL AND location_lng IS NOT NULL
   ORDER BY public.mbg_haversine_km(location_lat, location_lng, p_pickup_lat, p_pickup_lng) ASC
   LIMIT 1;
  IF v_stage_id IS NULL THEN
    SELECT id INTO v_stage_id FROM public.mbg_stages WHERE is_active = true LIMIT 1;
  END IF;
  IF v_stage_id IS NULL THEN
    RAISE EXCEPTION 'No active stage is configured yet to route this request through';
  END IF;

  v_channel_label := CASE p_pay_channel
    WHEN 'mobile_money' THEN 'mobile money'
    WHEN 'card'         THEN 'card'
    WHEN 'cash'         THEN 'cash'
    ELSE 'ICAN wallet'
  END;
  v_notes := left(
    'Scanned your rider card'
    || CASE WHEN length(v_name) > 0 THEN ' · ' || v_name ELSE '' END
    || CASE WHEN length(v_phone) > 0 THEN ' · ' || v_phone ELSE '' END
    || ' · pays by ' || v_channel_label
    || CASE WHEN v_waived THEN ' (no transaction fee)' ELSE '' END
    || CASE WHEN length(btrim(COALESCE(p_notes, ''))) > 0 THEN ' · ' || btrim(p_notes) ELSE '' END,
    500
  );

  INSERT INTO public.mbg_rides (
    customer_id, rider_id, stage_id,
    pickup_location, pickup_lat, pickup_lng,
    dropoff_location, dropoff_lat, dropoff_lng,
    status, distance_km, duration_minutes, fare,
    service_type, delivery_mode, supermarket_id,
    power_type_requested, umbrella_requested, delivery_bag_requested,
    time_multiplier, rider_earning, chairperson_commission_total,
    order_notes, payment_method, cart, max_delivery_hours, expense_classification,
    customer_business_profile_id, cargo_weight_kg, cargo_class,
    booked_via_card_qr, platform_charge_waived, qr_pay_channel,
    guest_name, guest_phone, guest_token_hash
  ) VALUES (
    v_customer_id, v_rider.id, v_stage_id,
    COALESCE(NULLIF(btrim(p_pickup_location), ''), 'Pickup point'), p_pickup_lat, p_pickup_lng,
    COALESCE(NULLIF(btrim(p_dropoff_location), ''), 'Drop-off point'), p_dropoff_lat, p_dropoff_lng,
    'pending', v_distance_km, GREATEST(2, ROUND(v_distance_km / 25 * 60)), v_fare,
    'ride', NULL, NULL,
    NULL, false, false,
    v_multiplier, v_rider_earning, v_chair_total,
    v_notes, v_payment, NULL, NULL, NULL,
    NULL, NULL, 'standard',
    true, v_waived, p_pay_channel,
    NULLIF(v_name, ''), NULLIF(v_phone, ''), encode(sha256(convert_to(v_token::TEXT, 'UTF8')), 'hex')
  ) RETURNING id, fare, rider_earning INTO v_ride_id, v_fare, v_rider_earning;

  -- A company rider's own pricing can change the fare as the row is written, so
  -- the fee record and the answer use what was actually stored.
  SELECT s.o_customer_charge, s.o_platform_net INTO v_charge, v_platform_net
    FROM public.mbg_compute_ride_charges(v_fare, v_is_boda, v_is_company) s;
  IF v_waived THEN
    v_charge := 0; v_platform_net := 0;
  END IF;

  INSERT INTO public.mbg_ride_platform_fees (ride_id, platform_fee_ugx) VALUES (v_ride_id, v_platform_net);

  RETURN jsonb_build_object(
    'success', true,
    'ride_id', v_ride_id,
    'token', v_token,
    'fare', v_fare,
    'platform_charge', v_charge,
    'customer_total', v_fare + v_charge,
    'fee_waived', v_waived,
    'payment_channel', p_pay_channel,
    'distance_km', ROUND(v_distance_km, 2)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_card_ride_request(
  TEXT, TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, TEXT
) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 6. The guest's own view of the ride, and cancelling it. The token is checked
--    against the stored hash; a signed-in customer can also use their session.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mbg_card_ride_owns(p_ride public.mbg_rides, p_token UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_ride.booked_via_card_qr AND (
    (p_token IS NOT NULL
      AND p_ride.guest_token_hash = encode(sha256(convert_to(p_token::TEXT, 'UTF8')), 'hex'))
    OR EXISTS (SELECT 1 FROM public.mbg_customers c WHERE c.id = p_ride.customer_id AND c.user_id = auth.uid())
  );
$$;
REVOKE ALL ON FUNCTION public.mbg_card_ride_owns(public.mbg_rides, UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.mbg_card_ride_status(p_ride_id UUID, p_token UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ride   public.mbg_rides%ROWTYPE;
  v_charge NUMERIC;
BEGIN
  SELECT * INTO v_ride FROM public.mbg_rides WHERE id = p_ride_id;
  IF NOT FOUND OR NOT public.mbg_card_ride_owns(v_ride, p_token) THEN
    RAISE EXCEPTION 'Ride not found';
  END IF;

  v_charge := CASE
    WHEN v_ride.platform_charge_waived AND v_ride.payment_method = 'wallet' THEN 0
    ELSE public.mbg_ride_customer_charge_ugx(v_ride.fare)
  END;

  RETURN jsonb_build_object(
    'status', v_ride.status,
    'fare', v_ride.fare,
    'platform_charge', v_charge,
    'customer_total', v_ride.fare + v_charge,
    'fee_waived', v_ride.platform_charge_waived,
    'payment_channel', v_ride.qr_pay_channel,
    'payment_method', v_ride.payment_method,
    'pickup_location', v_ride.pickup_location,
    'dropoff_location', v_ride.dropoff_location,
    'cancelled_by', v_ride.cancelled_by,
    'cancellation_reason', v_ride.cancellation_reason,
    'requested_at', v_ride.requested_at,
    'accepted_at', v_ride.accepted_at,
    'started_at', v_ride.started_at,
    'completed_at', v_ride.completed_at
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_card_ride_status(UUID, UUID) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.mbg_card_ride_cancel(p_ride_id UUID, p_token UUID DEFAULT NULL, p_reason TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ride   public.mbg_rides%ROWTYPE;
  v_reason TEXT := left(btrim(COALESCE(p_reason, '')), 300);
BEGIN
  SELECT * INTO v_ride FROM public.mbg_rides WHERE id = p_ride_id FOR UPDATE;
  IF NOT FOUND OR NOT public.mbg_card_ride_owns(v_ride, p_token) THEN
    RAISE EXCEPTION 'Ride not found';
  END IF;
  IF v_ride.status NOT IN ('pending', 'accepted') THEN
    RAISE EXCEPTION 'This ride can no longer be cancelled here. Please speak to your rider.';
  END IF;
  IF length(v_reason) < 3 THEN
    v_reason := 'Cancelled by the customer';
  END IF;

  UPDATE public.mbg_rides
     SET status = 'cancelled', cancelled_at = now(), cancelled_by = 'customer',
         cancellation_reason = v_reason, updated_at = now()
   WHERE id = p_ride_id;

  IF v_ride.rider_id IS NOT NULL THEN
    PERFORM set_config('mbg.trusted_write', 'true', true);
    UPDATE public.mbg_riders
       SET is_available = true, cancelled_rides = cancelled_rides + 1, updated_at = now()
     WHERE id = v_ride.rider_id;
  END IF;
  UPDATE public.mbg_customers
     SET cancelled_rides = cancelled_rides + 1, updated_at = now()
   WHERE id = v_ride.customer_id;

  RETURN jsonb_build_object('success', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_card_ride_cancel(UUID, UUID, TEXT) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 7. mbg_complete_ride — identical to ADD_EXACT_FARE_AND_CHARGES_ON_TOP.sql except
--    that a ride flagged platform_charge_waived (booked from a rider card QR and
--    paid from the ICAN wallet) is debited the fare only and settles no charge.
--    If such a ride ends up paid in cash after all, the usual charge applies.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mbg_complete_ride(p_ride_id UUID, p_payment_method TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ride public.mbg_rides%ROWTYPE;
  v_rider_id UUID;
  v_rider_user_id UUID;
  v_rider_vehicle_type TEXT;
  v_is_boda BOOLEAN;
  v_is_company BOOLEAN;
  v_customer_user_id UUID;
  v_payment_id UUID;
  v_fare_ican NUMERIC;
  v_platform_fee_pct NUMERIC := public.mbg_get_setting_numeric('commission.icanera_platform_fee_percentage', 8);
  v_customer_charge_ican NUMERIC;
  v_debit JSONB;
  v_charge_ugx NUMERIC;
  v_charged_now BOOLEAN := FALSE;
  v_actual_method TEXT;
  v_is_pending_customer_confirmation BOOLEAN;
  v_rider_balance_ican NUMERIC;
  v_owed_ican NUMERIC;
  v_taken_ican NUMERIC := 0;
  v_taken_ugx NUMERIC := 0;
  v_debt_added_ugx NUMERIC := 0;
  ICAN_TO_UGX CONSTANT NUMERIC := 5000;
BEGIN
  SELECT id, user_id, vehicle_type::TEXT, business_profile_id IS NOT NULL
    INTO v_rider_id, v_rider_user_id, v_rider_vehicle_type, v_is_company
  FROM public.mbg_riders WHERE user_id = auth.uid();
  SELECT * INTO v_ride FROM public.mbg_rides WHERE id = p_ride_id AND rider_id = v_rider_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ride not found or not yours';
  END IF;
  IF v_ride.status <> 'in_progress' THEN
    RAISE EXCEPTION 'Ride must be in progress to complete';
  END IF;

  v_actual_method := lower(COALESCE(p_payment_method, v_ride.payment_method));
  IF v_ride.wallet_charged_at_acceptance THEN
    v_actual_method := 'wallet';
  END IF;
  IF v_actual_method NOT IN ('cash', 'wallet') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Payment method must be cash or wallet');
  END IF;

  v_is_boda := v_rider_vehicle_type IN ('motorcycle', 'bicycle', 'tuktuk');
  SELECT user_id INTO v_customer_user_id FROM public.mbg_customers WHERE id = v_ride.customer_id;

  v_is_pending_customer_confirmation := (v_ride.service_type = 'delivery' AND v_ride.delivery_mode = 'supermarket');

  -- The platform charge the customer pays on top of the fare — the same
  -- amount whether this ends up cash or wallet.
  -- A wallet-paid ride booked from a rider card QR carries no charge at all.
  v_charge_ugx := CASE
    WHEN v_actual_method = 'wallet' AND COALESCE(v_ride.platform_charge_waived, FALSE) THEN 0
    ELSE public.mbg_ride_customer_charge_ugx(v_ride.fare)
  END;

  IF v_actual_method = 'wallet' THEN
    v_fare_ican := ROUND(v_ride.fare / ICAN_TO_UGX, 8);

    IF NOT v_ride.wallet_charged_at_acceptance THEN
      v_customer_charge_ican := ROUND(
        v_fare_ican * (1 + CASE WHEN COALESCE(v_ride.platform_charge_waived, FALSE) THEN 0 ELSE v_platform_fee_pct END / 100), 8);
      v_debit := public.mbg_debit_journey_fare(
        v_customer_user_id, v_customer_charge_ican, 'mybodaguy', p_ride_id::TEXT,
        CASE WHEN v_ride.service_type = 'delivery' THEN COALESCE(v_ride.expense_classification, 'personal_expense') ELSE NULL END
      );

      IF NOT COALESCE((v_debit ->> 'success')::BOOLEAN, false) THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', COALESCE(v_debit ->> 'error', 'Wallet payment failed'),
          'payment_method_attempted', 'wallet'
        );
      END IF;

      -- Settled below, once the payment row exists for the chairperson records.
      v_charged_now := TRUE;
    END IF;
  END IF;

  UPDATE public.mbg_rides SET
    status = 'completed', payment_method = v_actual_method, completed_at = now(), updated_at = now()
  WHERE id = p_ride_id;

  UPDATE public.mbg_payments SET status = 'completed', completed_at = now(), updated_at = now()
  WHERE ride_id = p_ride_id RETURNING id INTO v_payment_id;

  UPDATE public.mbg_customers SET
    total_rides = total_rides + 1, completed_rides = completed_rides + 1, updated_at = now()
  WHERE id = v_ride.customer_id;

  PERFORM set_config('mbg.trusted_write', 'true', true);

  IF v_actual_method = 'wallet' THEN
    -- The charge just collected on top of the fare: chairpersons are paid out
    -- of it, ICANera credited the rest. (A store delivery's charge was already
    -- settled when the wallet was debited at acceptance.)
    IF v_charged_now THEN
      PERFORM public.mbg_settle_ride_charge(
        p_ride_id, v_payment_id, v_ride.stage_id, v_ride.fare, v_charge_ugx,
        v_is_boda AND NOT COALESCE(v_is_company, FALSE) AND v_payment_id IS NOT NULL,
        v_customer_user_id, 'ride-wallet-surcharge:' || p_ride_id::text,
        'chairperson commission',
        format('ICANera platform fee on ride/delivery %s (charge on top of the fare, wallet)', p_ride_id)
      );
    END IF;

    IF v_is_pending_customer_confirmation THEN
      NULL;
    ELSE
      PERFORM public.mbg_pay_rider_for_ride(p_ride_id);
    END IF;

    UPDATE public.mbg_riders SET
      is_available = true, total_rides = total_rides + 1, completed_rides = completed_rides + 1, updated_at = now()
    WHERE id = v_rider_id;

  ELSE
    -- Cash: the customer handed the rider the fare PLUS the charge, so the
    -- rider is holding the platform's money and keeps exactly the fare once
    -- it is taken back. Out of the platform's float, the chairpersons (boda)
    -- are paid and ICANera is credited the rest of the charge immediately...
    PERFORM public.mbg_settle_ride_charge(
      p_ride_id, v_payment_id, v_ride.stage_id, v_ride.fare, v_charge_ugx,
      v_is_boda AND NOT COALESCE(v_is_company, FALSE) AND v_payment_id IS NOT NULL,
      v_rider_user_id, 'ride-cash-platform-fee:' || p_ride_id::text,
      'chairperson commission (cash settlement)',
      format('ICANera platform fee on cash ride %s (charge on top of the fare, taken from the rider''s wallet)', p_ride_id)
    );

    -- ...and the charge is debited from the rider's wallet now. Whatever the
    -- balance can't cover becomes the running debt, recovered from their next
    -- wallet-paid ride (mbg_pay_rider_for_ride).
    IF v_charge_ugx > 0 THEN
      v_owed_ican := ROUND(v_charge_ugx / ICAN_TO_UGX, 8);
      SELECT ican_balance INTO v_rider_balance_ican
        FROM public.ican_user_wallets WHERE user_id = v_rider_user_id FOR UPDATE;
      v_taken_ican := LEAST(GREATEST(COALESCE(v_rider_balance_ican, 0), 0), v_owed_ican);

      IF v_taken_ican > 0 THEN
        v_debit := public.mbg_debit_journey_fare(v_rider_user_id, v_taken_ican, 'mybodaguy', p_ride_id::TEXT, NULL);
        IF COALESCE((v_debit ->> 'success')::BOOLEAN, false) THEN
          UPDATE public.ican_coin_transactions
             SET note = format('ICANera platform charge on cash ride (ref: %s)', p_ride_id)
           WHERE id = (v_debit ->> 'tx_id')::UUID;
        ELSE
          v_taken_ican := 0;
        END IF;
      END IF;

      v_taken_ugx := ROUND(v_taken_ican * ICAN_TO_UGX);
      v_debt_added_ugx := GREATEST(v_charge_ugx - v_taken_ugx, 0);
    END IF;

    IF v_debt_added_ugx > 0 THEN
      UPDATE public.mbg_riders
         SET cash_commission_debt_ugx = cash_commission_debt_ugx + v_debt_added_ugx
       WHERE id = v_rider_id;
    END IF;

    UPDATE public.mbg_rides SET cash_confirmed_at = now(), updated_at = now() WHERE id = p_ride_id;

    UPDATE public.mbg_riders SET
      is_available = true, total_rides = total_rides + 1, completed_rides = completed_rides + 1, updated_at = now()
    WHERE id = v_rider_id;
  END IF;

  BEGIN
    UPDATE public.icanera_delivery_receipts
    SET status = 'delivered', delivered_at = now()
    WHERE source_app = 'mybodaguy' AND reference_type = 'mbg_ride' AND reference_id = p_ride_id
      AND status IN ('paid', 'picked_up');
  EXCEPTION WHEN undefined_table THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'rider_earning', v_ride.rider_earning,
    'payment_method', v_actual_method,
    'platform_charge_ugx', v_charge_ugx,
    'customer_total_ugx', v_ride.fare + v_charge_ugx,
    'commission_due_ugx', CASE WHEN v_actual_method = 'cash' THEN v_charge_ugx ELSE 0 END,
    'charge_taken_from_wallet_ugx', v_taken_ugx,
    'charge_added_to_debt_ugx', v_debt_added_ugx,
    'awaiting_customer_confirmation', v_is_pending_customer_confirmation AND v_actual_method = 'wallet'
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_complete_ride(UUID, TEXT) TO authenticated;
