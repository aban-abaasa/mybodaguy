-- ============================================================================
-- OPERATOR APPLICATION MESSAGING — reuses the existing shared support-chat
-- system (digital-city-era/backend/database/seeds/CREATE_CHAT_SUPPORT_SYSTEM.sql,
-- chat_conversations/chat_messages, already powering the floating widget and
-- the Dev Panel "Messages" tab) instead of a parallel table — an operator
-- application just gets its own conversation thread, tagged so it can be
-- told apart from ordinary support chats.
--
-- Two real gaps had to be closed to do this safely, not invented gaps:
--   1. The kind column mybodaguy's own chatService.ts / DeveloperDashboard.tsx
--      MessagesTab already reference (listConversations({kind}), "row.kind
--      === 'team'") turned out to already exist live — added by
--      digital-city-era/backend/database/seeds/ADD_CHAT_TEAM_CHANNEL.sql,
--      NOT by CREATE_CHAT_SUPPORT_SYSTEM.sql as first assumed — but with a
--      CHECK constraint restricting it to ('support', 'team') only, which
--      rejected every insert with kind='operator_application' ("new row
--      ... violates check constraint chat_conversations_kind_check").
--      Widened below rather than assumed away.
--   2. chat_conversations.user_id references digital-city-era's OWN
--      public.users(id), not mbg_users/auth.users — inserting a BodaGo-only
--      auth.uid() there would foreign-key-violate for any account that
--      never signed up on digital-city-era. Added a separate, correctly-
--      scoped mbg_user_id column instead of forcing user_id to do a job it
--      can't safely do across apps.
--
-- No new sender_role needed for automated messages — they're sent exactly
-- the way MessagesTab's own reply box already sends a developer's message
-- (sender_role='dev', sender_name='BodaGo Team'), so an automated notice
-- and a real developer reply are indistinguishable in the UI, which is the
-- point: the applicant just sees "BodaGo Team" talking to them.
--
-- Run after ADD_COUNTRY_TO_SYNC_USER.sql (needs mbg_user_profiles.country)
-- and FIX_OPERATOR_APPLICATION_UPGRADE_PATH.sql — re-creates
-- mbg_apply_as_operator and mbg_review_operator_application again (same
-- upgrade-path logic as that file) to add the chat integration.
-- ============================================================================

ALTER TABLE public.chat_conversations
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'support',
  ADD COLUMN IF NOT EXISTS application_id UUID REFERENCES public.mbg_operator_applications(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS mbg_user_id UUID REFERENCES public.mbg_users(id) ON DELETE SET NULL;

-- Widen chat_conversations_kind_check (ADD_CHAT_TEAM_CHANNEL.sql:
-- CHECK (kind IN ('support', 'team'))) to also allow 'operator_application'.
-- Idempotent drop+add, same pattern as ADD_BUSINESS_TYPE_TO_SUPERMARKETS.sql.
DO $$
DECLARE
  con RECORD;
BEGIN
  FOR con IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public' AND rel.relname = 'chat_conversations' AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%kind%'
  LOOP
    EXECUTE format('ALTER TABLE public.chat_conversations DROP CONSTRAINT %I', con.conname);
  END LOOP;
END $$;
ALTER TABLE public.chat_conversations
  ADD CONSTRAINT chat_conversations_kind_check CHECK (kind IN ('support', 'team', 'operator_application'));

CREATE INDEX IF NOT EXISTS idx_chat_conversations_kind ON public.chat_conversations(kind);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_application ON public.chat_conversations(application_id);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_mbg_user ON public.chat_conversations(mbg_user_id);

-- ============================================================================
-- Re-create mbg_apply_as_operator (same logic as FIX_OPERATOR_APPLICATION_UPGRADE_PATH.sql)
-- plus: open a chat_conversations thread for this application and post the
-- automated "under review" message into it.
--
-- mbg_apply_as_operator's parameter list changed between
-- CREATE_OPERATOR_APPLICATIONS.sql (10 args, includes p_operator_country)
-- and this file (9 args, no country param). If FIX_OPERATOR_APPLICATION_UPGRADE_PATH.sql
-- didn't run first (or for any other reason an old overload is still
-- around), CREATE OR REPLACE below would add a SECOND function of the same
-- name rather than replacing it — Postgres allows overloading by argument
-- list — and PostgREST then can't pick one for supabase.rpc('mbg_apply_as_operator', ...)
-- ("function name ... is not unique"). Drop every existing overload first
-- so this file is self-healing regardless of what ran before it.
-- ============================================================================
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
  v_full_name TEXT;
  v_email TEXT;
  v_conversation_id UUID;
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

  SELECT up.full_name, mu.email INTO v_full_name, v_email
  FROM public.mbg_users mu
  LEFT JOIN public.mbg_user_profiles up ON up.user_id = mu.id
  WHERE mu.id = auth.uid();

  INSERT INTO public.mbg_operator_applications (
    user_id, vehicle_type, plate_number, license_number,
    vehicle_model, vehicle_year, vehicle_color, phone,
    operator_country, operator_home_city, notes
  ) VALUES (
    auth.uid(), p_vehicle_type, p_plate_number, p_license_number,
    p_vehicle_model, p_vehicle_year, p_vehicle_color, p_phone,
    v_operator_country, p_operator_home_city, p_notes
  ) RETURNING id INTO v_application_id;

  INSERT INTO public.chat_conversations (
    guest_name, guest_email, mbg_user_id, role, portal, kind, origin_app,
    application_id, subject
  ) VALUES (
    coalesce(v_full_name, 'Applicant'), v_email, auth.uid(), 'customer', 'customer', 'operator_application', 'mybodaguy',
    v_application_id, format('%s driver application', p_vehicle_type)
  ) RETURNING id INTO v_conversation_id;

  INSERT INTO public.chat_messages (conversation_id, sender_role, sender_name, body)
  VALUES (
    v_conversation_id, 'dev', 'BodaGo Team',
    format(
      '🚚 Application received! We''re reviewing your %s application now — our team typically responds within 24-48 hours. Hang tight, and thanks for wanting to drive with BodaGo!',
      p_vehicle_type
    )
  );

  RETURN jsonb_build_object('success', true, 'application_id', v_application_id, 'conversation_id', v_conversation_id);
END;
$$;
-- Explicit argument list, not a bare function name — see
-- CREATE_OPERATOR_APPLICATIONS.sql's comment on this same line for why.
GRANT EXECUTE ON FUNCTION public.mbg_apply_as_operator(
  TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT
) TO authenticated;

-- ============================================================================
-- Re-create mbg_review_operator_application (same upgrade-path logic) plus:
-- post the approve/reject notice into the application's existing chat
-- thread, exactly like a developer's own reply would look.
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

  UPDATE public.mbg_users SET role_type = 'rider', updated_at = now() WHERE id = v_app.user_id AND role_type = 'customer';

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
  RAISE NOTICE '✅ Operator applications now open a real chat_conversations thread (kind=operator_application) with automated BodaGo Team messages on submit/approve/reject — same inbox developers already use for support chat.';
END $$;
