-- ============================================================================
-- BECOME A TRANSPORT SERVICE PROVIDER — self-service application
-- Run after CREATE_JOURNEY_BOOKING_ENGINE.sql (needs mbg_vehicle_type's
-- 'car'/'van'/'truck' values and mbg_riders.operator_type/operator_country/
-- service_countries columns added there).
-- ============================================================================
-- Today the only way to become a rider is a chairperson/developer directly
-- assigning an existing account via mbg_assign_rider (riderService.ts) —
-- there was no self-service "customer applies, developer reviews" path.
-- This adds one: a customer picks a vehicle type (car/van/truck) on their
-- own dashboard, submits an application, and it shows up in the developer
-- dashboard's new "Applications" tab for approve/reject.
--
-- car -> operator_type 'passenger' (ordinary BodaGo rides)
-- van/truck -> operator_type 'cargo' (supermarkera-style deliveries), since
-- those vehicle sizes are what mbg_dispatch_delivery_for_purchase_order
-- filters on (see CREATE_JOURNEY_BOOKING_ENGINE.sql).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.mbg_operator_applications (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES public.mbg_users(id) ON DELETE CASCADE,
  vehicle_type      TEXT NOT NULL CHECK (vehicle_type IN ('car', 'van', 'truck')),
  plate_number      TEXT NOT NULL,
  license_number    TEXT NOT NULL,
  vehicle_model     TEXT,
  vehicle_year      INTEGER,
  vehicle_color     TEXT,
  phone             TEXT,
  operator_country  TEXT NOT NULL DEFAULT 'Uganda',
  operator_home_city TEXT,
  notes             TEXT,
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by       UUID REFERENCES public.mbg_users(id) ON DELETE SET NULL,
  reviewed_at       TIMESTAMPTZ,
  rejection_reason  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mbg_operator_applications_status_idx ON public.mbg_operator_applications(status);
CREATE INDEX IF NOT EXISTS mbg_operator_applications_user_idx ON public.mbg_operator_applications(user_id);

ALTER TABLE public.mbg_operator_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mbg_operator_applications_read_own ON public.mbg_operator_applications;
CREATE POLICY mbg_operator_applications_read_own ON public.mbg_operator_applications
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS mbg_operator_applications_developer_read ON public.mbg_operator_applications;
CREATE POLICY mbg_operator_applications_developer_read ON public.mbg_operator_applications
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.mbg_users WHERE id = auth.uid() AND role_type = 'developer' AND is_active = true)
  );

DROP POLICY IF EXISTS mbg_operator_applications_service_role ON public.mbg_operator_applications;
CREATE POLICY mbg_operator_applications_service_role ON public.mbg_operator_applications
  FOR ALL USING (auth.role() = 'service_role');

-- ============================================================================
-- Customer applies. One open (pending) application at a time — re-applying
-- while already pending just errors instead of creating duplicates.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.mbg_apply_as_operator(
  p_vehicle_type TEXT,
  p_plate_number TEXT,
  p_license_number TEXT,
  p_vehicle_model TEXT DEFAULT NULL,
  p_vehicle_year INTEGER DEFAULT NULL,
  p_vehicle_color TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_operator_country TEXT DEFAULT 'Uganda',
  p_operator_home_city TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_application_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;
  IF p_vehicle_type NOT IN ('car', 'van', 'truck') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid vehicle type');
  END IF;
  IF trim(coalesce(p_plate_number, '')) = '' OR trim(coalesce(p_license_number, '')) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Plate number and license number are required');
  END IF;

  IF EXISTS (SELECT 1 FROM public.mbg_riders WHERE user_id = auth.uid()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'You are already a registered driver/operator');
  END IF;
  IF EXISTS (SELECT 1 FROM public.mbg_operator_applications WHERE user_id = auth.uid() AND status = 'pending') THEN
    RETURN jsonb_build_object('success', false, 'error', 'You already have a pending application');
  END IF;

  INSERT INTO public.mbg_operator_applications (
    user_id, vehicle_type, plate_number, license_number,
    vehicle_model, vehicle_year, vehicle_color, phone,
    operator_country, operator_home_city, notes
  ) VALUES (
    auth.uid(), p_vehicle_type, p_plate_number, p_license_number,
    p_vehicle_model, p_vehicle_year, p_vehicle_color, p_phone,
    coalesce(p_operator_country, 'Uganda'), p_operator_home_city, p_notes
  ) RETURNING id INTO v_application_id;

  RETURN jsonb_build_object('success', true, 'application_id', v_application_id);
END;
$$;
-- Explicit argument list (not a bare function name) — GRANT has to resolve
-- the function by name alone when no args are given, which throws
-- "function name ... is not unique" the instant more than one overload of
-- mbg_apply_as_operator exists (e.g. this file re-run after
-- FIX_OPERATOR_APPLICATION_UPGRADE_PATH.sql already changed the arg list).
-- Typed like this, the GRANT is unambiguous regardless of what else exists.
GRANT EXECUTE ON FUNCTION public.mbg_apply_as_operator(
  TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT
) TO authenticated;

-- ============================================================================
-- Developer reviews. On approve: creates the mbg_riders row (status
-- 'active' immediately — the application itself was the review step, no
-- second approval gate once a developer has said yes) with stage_id NULL
-- (only meaningful for Uganda's chairperson hierarchy — see
-- CREATE_JOURNEY_BOOKING_ENGINE.sql's note on why it's nullable).
-- ============================================================================
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

  v_operator_type := CASE WHEN v_app.vehicle_type = 'car' THEN 'passenger' ELSE 'cargo' END;

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
  ) RETURNING id INTO v_rider_id;

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
  RAISE NOTICE '✅ Operator applications ready: customers can apply (mbg_apply_as_operator), developers review (mbg_review_operator_application).';
END $$;
