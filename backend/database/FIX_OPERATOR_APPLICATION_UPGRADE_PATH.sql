-- ============================================================================
-- FIX: "Become a Driver" was permanently blocked for anyone who already had
-- ANY mbg_riders row — including an ordinary motorcycle boda rider, since
-- mbg_riders only allows one row per user_id (UNIQUE). The block now only
-- triggers when re-applying for the SAME vehicle type already held; a
-- motorcycle rider can still apply to add/switch to car/van/truck, and vice
-- versa.
--
-- Also widens the applicable roles: the self-service form now covers every
-- individually-driveable vehicle type — motorcycle/bicycle/tuktuk (boda
-- rides) as well as car/van/truck (transport service provider) — all
-- selectable from the one form, not just car/van/truck. (trailer/ship stay
-- fleet/admin-only — not something an individual self-applies for.)
--
-- Also: p_operator_country is dropped from the application entirely.
-- Country is already captured once, at signup (SignInPage.tsx's country
-- select -> auth metadata -> sync_user_from_auth -> mbg_user_profiles.country,
-- see ADD_COUNTRY_TO_SYNC_USER.sql) — the same source of truth ICAN itself
-- uses for the account. Asking again here would just let the client claim a
-- different country than what's on file; mbg_apply_as_operator now reads it
-- from mbg_user_profiles instead of trusting a parameter.
--
-- Run after CREATE_OPERATOR_APPLICATIONS.sql — replaces both of its
-- functions with corrected versions.
-- ============================================================================

-- Widen the table's vehicle_type CHECK from car/van/truck to every
-- individually-selectable type (idempotent drop+add, same pattern as
-- ADD_BUSINESS_TYPE_TO_SUPERMARKETS.sql).
DO $$
DECLARE
  con RECORD;
BEGIN
  FOR con IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public' AND rel.relname = 'mbg_operator_applications' AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%vehicle_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.mbg_operator_applications DROP CONSTRAINT %I', con.conname);
  END LOOP;
END $$;
ALTER TABLE public.mbg_operator_applications
  ADD CONSTRAINT mbg_operator_applications_vehicle_type_check
  CHECK (vehicle_type IN ('motorcycle', 'bicycle', 'tuktuk', 'car', 'van', 'truck'));

-- Changing the parameter list means CREATE OR REPLACE would leave the old
-- 10-arg overload from CREATE_OPERATOR_APPLICATIONS.sql callable alongside
-- this one (Postgres treats a different signature as a different function),
-- so drop every existing overload first — same approach as
-- FIX_ONBOARD_SUPERMARKET_RPC.sql / ADD_BUSINESS_TYPE_TO_SUPERMARKETS.sql.
DO $$
DECLARE
  fn RECORD;
BEGIN
  FOR fn IN
    SELECT pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'mbg_apply_as_operator'
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS public.mbg_apply_as_operator(%s)', fn.args);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.mbg_apply_as_operator(
  p_vehicle_type TEXT,
  p_plate_number TEXT,
  p_license_number TEXT,
  p_vehicle_model TEXT DEFAULT NULL,
  p_vehicle_year INTEGER DEFAULT NULL,
  p_vehicle_color TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_operator_home_city TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_application_id UUID;
  v_operator_country TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;
  IF p_vehicle_type NOT IN ('motorcycle', 'bicycle', 'tuktuk', 'car', 'van', 'truck') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid vehicle type');
  END IF;
  IF trim(coalesce(p_plate_number, '')) = '' OR trim(coalesce(p_license_number, '')) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Plate number and license number are required');
  END IF;

  -- Only block re-applying for the exact vehicle type already held — e.g.
  -- an existing motorcycle rider can still apply to add/switch to
  -- car/van/truck (or vice versa); only a duplicate application for the
  -- same type is rejected.
  IF EXISTS (
    SELECT 1 FROM public.mbg_riders
    WHERE user_id = auth.uid() AND vehicle_type::TEXT = p_vehicle_type
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'You are already a registered ' || p_vehicle_type || ' operator');
  END IF;
  IF EXISTS (SELECT 1 FROM public.mbg_operator_applications WHERE user_id = auth.uid() AND status = 'pending') THEN
    RETURN jsonb_build_object('success', false, 'error', 'You already have a pending application');
  END IF;

  SELECT coalesce(country, 'Uganda') INTO v_operator_country
  FROM public.mbg_user_profiles WHERE user_id = auth.uid();
  v_operator_country := coalesce(v_operator_country, 'Uganda');

  INSERT INTO public.mbg_operator_applications (
    user_id, vehicle_type, plate_number, license_number,
    vehicle_model, vehicle_year, vehicle_color, phone,
    operator_country, operator_home_city, notes
  ) VALUES (
    auth.uid(), p_vehicle_type, p_plate_number, p_license_number,
    p_vehicle_model, p_vehicle_year, p_vehicle_color, p_phone,
    v_operator_country, p_operator_home_city, p_notes
  ) RETURNING id INTO v_application_id;

  RETURN jsonb_build_object('success', true, 'application_id', v_application_id);
END;
$$;
-- Explicit argument list, not a bare function name — see
-- CREATE_OPERATOR_APPLICATIONS.sql's comment on this same line for why.
GRANT EXECUTE ON FUNCTION public.mbg_apply_as_operator(
  TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT
) TO authenticated;

-- On approve: upsert instead of a bare insert, since a motorcycle rider
-- upgrading to car/van/truck already has a row (mbg_riders.user_id is
-- UNIQUE — one row per person, one vehicle_type at a time in Phase 1).
-- set_config('mbg.trusted_write', ...) is required before touching
-- plate_number/license_number/status/approved_by/approved_at on an UPDATE —
-- mbg_riders_protect_columns() (CREATE_REAL_RIDE_MATCHING_ENGINE.sql)
-- silently reverts those exact columns on any UPDATE that isn't flagged
-- trusted or run as service_role, which would otherwise make the upgrade
-- look like it succeeded while quietly keeping the old plate/license/status.
CREATE OR REPLACE FUNCTION public.mbg_review_operator_application(
  p_application_id UUID,
  p_approve BOOLEAN,
  p_rejection_reason TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_app public.mbg_operator_applications%ROWTYPE;
  v_operator_type TEXT;
  v_rider_id UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.mbg_users WHERE id = auth.uid() AND role_type = 'developer' AND is_active = true) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only a developer can review operator applications');
  END IF;

  SELECT * INTO v_app FROM public.mbg_operator_applications WHERE id = p_application_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Application not found');
  END IF;
  IF v_app.status <> 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Application has already been reviewed');
  END IF;

  IF NOT p_approve THEN
    UPDATE public.mbg_operator_applications
    SET status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(),
        rejection_reason = p_rejection_reason, updated_at = now()
    WHERE id = p_application_id;
    RETURN jsonb_build_object('success', true, 'status', 'rejected');
  END IF;

  -- van/truck are the cargo-scale vehicle types mbg_dispatch_delivery_for_purchase_order
  -- filters on (CREATE_JOURNEY_BOOKING_ENGINE.sql); everything else
  -- individually self-applied for (motorcycle/bicycle/tuktuk/car) is a
  -- passenger ride operator.
  v_operator_type := CASE WHEN v_app.vehicle_type IN ('van', 'truck') THEN 'cargo' ELSE 'passenger' END;

  PERFORM set_config('mbg.trusted_write', 'true', true);

  INSERT INTO public.mbg_riders (
    user_id, vehicle_type, plate_number, license_number,
    vehicle_model, vehicle_year, vehicle_color,
    status, is_available, operator_type, operator_country, operator_home_city,
    service_countries, approved_by, approved_at
  ) VALUES (
    v_app.user_id, v_app.vehicle_type::public.mbg_vehicle_type, v_app.plate_number, v_app.license_number,
    v_app.vehicle_model, v_app.vehicle_year, v_app.vehicle_color,
    'active', false, v_operator_type, v_app.operator_country, v_app.operator_home_city,
    ARRAY[v_app.operator_country], auth.uid(), now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    vehicle_type = EXCLUDED.vehicle_type,
    plate_number = EXCLUDED.plate_number,
    license_number = EXCLUDED.license_number,
    vehicle_model = EXCLUDED.vehicle_model,
    vehicle_year = EXCLUDED.vehicle_year,
    vehicle_color = EXCLUDED.vehicle_color,
    status = 'active',
    operator_type = EXCLUDED.operator_type,
    operator_country = EXCLUDED.operator_country,
    operator_home_city = EXCLUDED.operator_home_city,
    service_countries = EXCLUDED.service_countries,
    approved_by = EXCLUDED.approved_by,
    approved_at = EXCLUDED.approved_at,
    updated_at = now()
  RETURNING id INTO v_rider_id;

  UPDATE public.mbg_users SET role_type = 'rider', updated_at = now() WHERE id = v_app.user_id AND role_type = 'customer';

  UPDATE public.mbg_operator_applications
  SET status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
  WHERE id = p_application_id;

  RETURN jsonb_build_object('success', true, 'status', 'approved', 'rider_id', v_rider_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_review_operator_application TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ Operator applications now cover every individually-selectable role (motorcycle/bicycle/tuktuk/car/van/truck) in one form; only re-applying for the exact same type already held is blocked; approval upgrades the existing mbg_riders row in place; operator_country is read from mbg_user_profiles instead of asked again on the form.';
END $$;
