-- ============================================================================
-- FIX: approval only overwrote mbg_users.role_type (a single value), never
-- touching mbg_users.user_roles (the TEXT[] array the actual multi-role
-- system — ENABLE_MULTI_ROLE_SYSTEM.sql, get_user_roles()/add_user_role() —
-- and UnifiedDashboard.tsx's tabbed header both read). Net effect: an
-- approved operator's user_roles array still only contained ['customer'],
-- so UnifiedDashboard's userRoles.length === 1 branch rendered a single
-- dashboard with no role tabs at all, same as before approval — the "Rider"
-- tab this whole feature is supposed to unlock never actually appeared.
--
-- Also dropped the "AND role_type = 'customer'" guard on the UPDATE: an
-- existing motorcycle rider upgrading to car/van/truck (the upgrade path
-- FIX_OPERATOR_APPLICATION_UPGRADE_PATH.sql added) already has
-- role_type='rider', so that guard would have silently skipped the roles
-- update for every upgrade approval.
--
-- Run after ADD_OPERATOR_APPLICATION_CHAT_INTEGRATION.sql — re-creates
-- mbg_review_operator_application again (same logic) with this one fix.
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

  -- Keep role_type = 'rider' (unchanged from before — some existing RLS/UI
  -- may still key off it) AND add 'rider' into the real multi-role array so
  -- the account keeps its customer identity too, and UnifiedDashboard shows
  -- both as tabs instead of silently dropping to a single-role view.
  UPDATE public.mbg_users
  SET role_type = 'rider',
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
  RAISE NOTICE '✅ Approval now adds rider to mbg_users.user_roles (multi-role array), not just role_type — UnifiedDashboard will show both Customer and Rider tabs.';
END $$;
