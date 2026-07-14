-- ============================================================================
-- MULTI-VEHICLE SUPPORT — a person can hold BOTH a Motorcycle/boda rider
-- registration AND a Car/Van/Truck operator registration at once (e.g.
-- someone who owns both), switching which one is "active" for receiving
-- requests instead of the previous one-vehicle-per-account model.
--
-- Previously mbg_riders.user_id was UNIQUE — approving a second vehicle
-- type (see FIX_OPERATOR_APPLICATION_UPGRADE_PATH.sql's upgrade path)
-- UPGRADED the existing row in place, silently discarding the old vehicle.
-- That's now replaced with: unique per (user_id, vehicle_type), an explicit
-- "which one is active right now" pointer on mbg_users, and a switch RPC.
--
-- Matching (mbg_find_available_riders / mbg_find_available_vehicles /
-- journey+cargo dispatch) needs NO changes at all — they already iterate
-- mbg_riders rows independently and only ever match on is_available=true,
-- and mbg_switch_active_vehicle below guarantees at most one vehicle per
-- person is ever is_available=true. Multi-vehicle composes for free there.
--
-- Run after ADD_OPERATOR_APPLICATION_MULTI_ROLE.sql.
-- ============================================================================

-- 1. Loosen the one-vehicle-per-person constraint to one-per-(person,type).
DO $$
DECLARE
  con RECORD;
BEGIN
  FOR con IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public' AND rel.relname = 'mbg_riders' AND c.contype = 'u'
      AND pg_get_constraintdef(c.oid) = 'UNIQUE (user_id)'
  LOOP
    EXECUTE format('ALTER TABLE public.mbg_riders DROP CONSTRAINT %I', con.conname);
  END LOOP;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public' AND rel.relname = 'mbg_riders' AND c.contype = 'u'
      AND pg_get_constraintdef(c.oid) LIKE '%user_id, vehicle_type%'
  ) THEN
    ALTER TABLE public.mbg_riders ADD CONSTRAINT mbg_riders_user_id_vehicle_type_key UNIQUE (user_id, vehicle_type);
  END IF;
END $$;

-- 2. Which vehicle is "active" (receiving requests / shown in the header)
--    right now — NULL means "just use whichever single vehicle they have",
--    the pre-multi-vehicle default.
ALTER TABLE public.mbg_users
  ADD COLUMN IF NOT EXISTS active_vehicle_type TEXT NULL;

-- Backfill: anyone who already has exactly one mbg_riders row gets it set
-- as their active vehicle, so nothing changes for existing single-vehicle
-- accounts.
UPDATE public.mbg_users mu
SET active_vehicle_type = r.vehicle_type::TEXT
FROM public.mbg_riders r
WHERE r.user_id = mu.id
  AND mu.active_vehicle_type IS NULL
  AND (SELECT count(*) FROM public.mbg_riders r2 WHERE r2.user_id = mu.id) = 1;

-- ============================================================================
-- 3. Switch which vehicle is active. Forces every OTHER vehicle for this
--    person offline first — a person can only actually be driving (and
--    receiving requests for) one vehicle at a time.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.mbg_switch_active_vehicle(p_vehicle_type TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.mbg_riders WHERE user_id = auth.uid() AND vehicle_type::TEXT = p_vehicle_type) THEN
    RETURN jsonb_build_object('success', false, 'error', 'You are not registered as a ' || p_vehicle_type || ' operator');
  END IF;

  PERFORM set_config('mbg.trusted_write', 'true', true);
  UPDATE public.mbg_riders
  SET is_available = false, updated_at = now()
  WHERE user_id = auth.uid() AND vehicle_type::TEXT <> p_vehicle_type;

  UPDATE public.mbg_users
  SET active_vehicle_type = p_vehicle_type, updated_at = now()
  WHERE id = auth.uid();

  RETURN jsonb_build_object('success', true, 'active_vehicle_type', p_vehicle_type);
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_switch_active_vehicle TO authenticated;

-- ============================================================================
-- 4. Re-create mbg_review_operator_application: approving a second vehicle
--    type now INSERTS a new mbg_riders row (kept alongside the existing
--    one) instead of upgrading/overwriting it, and switches the account's
--    active_vehicle_type to the newly approved one. ON CONFLICT now targets
--    (user_id, vehicle_type) — only a genuine re-approval of the exact same
--    type (which mbg_apply_as_operator already blocks up front) would ever
--    conflict.
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
  v_conversation_id UUID;
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

  SELECT id INTO v_conversation_id FROM public.chat_conversations WHERE application_id = p_application_id LIMIT 1;

  IF NOT p_approve THEN
    UPDATE public.mbg_operator_applications
    SET status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(),
        rejection_reason = p_rejection_reason, updated_at = now()
    WHERE id = p_application_id;

    IF v_conversation_id IS NOT NULL THEN
      INSERT INTO public.chat_messages (conversation_id, sender_role, sender_name, body)
      VALUES (
        v_conversation_id, 'dev', 'BodaGo Team',
        format(
          'Thanks for applying to be a BodaGo %s operator. Unfortunately we can''t approve this application right now%s. You''re welcome to update your details and apply again anytime.',
          v_app.vehicle_type,
          CASE WHEN coalesce(trim(p_rejection_reason), '') <> '' THEN ' — ' || p_rejection_reason ELSE '' END
        )
      );
    END IF;

    RETURN jsonb_build_object('success', true, 'status', 'rejected');
  END IF;

  v_operator_type := CASE WHEN v_app.vehicle_type IN ('van', 'truck') THEN 'cargo' ELSE 'passenger' END;

  PERFORM set_config('mbg.trusted_write', 'true', true);

  -- Any existing vehicle(s) go offline — the newly approved one becomes
  -- the active one below, and only one vehicle is ever online at once.
  UPDATE public.mbg_riders SET is_available = false, updated_at = now() WHERE user_id = v_app.user_id;

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
  ON CONFLICT (user_id, vehicle_type) DO UPDATE SET
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

  UPDATE public.mbg_users
  SET role_type = 'rider',
      active_vehicle_type = v_app.vehicle_type,
      user_roles = CASE
        WHEN 'rider' = ANY(COALESCE(user_roles, ARRAY['customer']::text[]))
        THEN COALESCE(user_roles, ARRAY['customer']::text[])
        ELSE array_append(COALESCE(user_roles, ARRAY['customer']::text[]), 'rider')
      END,
      updated_at = now()
  WHERE id = v_app.user_id;

  UPDATE public.mbg_operator_applications
  SET status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
  WHERE id = p_application_id;

  IF v_conversation_id IS NOT NULL THEN
    INSERT INTO public.chat_messages (conversation_id, sender_role, sender_name, body)
    VALUES (
      v_conversation_id, 'dev', 'BodaGo Team',
      format(
        '🎉 You''re approved! Welcome aboard as a BodaGo %s operator. Head to your Rider dashboard, go online, and start earning today. Drive safe out there!',
        v_app.vehicle_type
      )
    );
  END IF;

  RETURN jsonb_build_object('success', true, 'status', 'approved', 'rider_id', v_rider_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_review_operator_application TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ Multi-vehicle support ready: mbg_riders now allows one row per (person, vehicle_type); mbg_users.active_vehicle_type + mbg_switch_active_vehicle() control which one is live; approving a new vehicle type adds it alongside any existing ones instead of replacing them.';
END $$;
