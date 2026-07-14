-- ============================================================================
-- Applications submitted BEFORE ADD_OPERATOR_APPLICATION_CHAT_INTEGRATION.sql
-- ran have no chat_conversations row (mbg_apply_as_operator only creates one
-- going forward) — the Applications tab correctly showed "No conversation
-- thread found" for those, which reads like reply is broken when it's
-- really just missing data. Worse on the applicant's own status screen:
-- ApplicationChatThread rendered nothing at all for a missing thread.
-- This lets either side (the applicant themselves, or a developer) create
-- the missing thread on demand, idempotently.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.mbg_ensure_operator_application_conversation(p_application_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_app public.mbg_operator_applications%ROWTYPE;
  v_full_name TEXT;
  v_email TEXT;
  v_conversation_id UUID;
BEGIN
  SELECT * INTO v_app FROM public.mbg_operator_applications WHERE id = p_application_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Application not found');
  END IF;

  IF auth.uid() IS DISTINCT FROM v_app.user_id
     AND NOT EXISTS (SELECT 1 FROM public.mbg_users WHERE id = auth.uid() AND role_type = 'developer' AND is_active = true) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  SELECT id INTO v_conversation_id FROM public.chat_conversations WHERE application_id = p_application_id LIMIT 1;
  IF v_conversation_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'conversation_id', v_conversation_id, 'created', false);
  END IF;

  SELECT up.full_name, mu.email INTO v_full_name, v_email
  FROM public.mbg_users mu
  LEFT JOIN public.mbg_user_profiles up ON up.user_id = mu.id
  WHERE mu.id = v_app.user_id;

  INSERT INTO public.chat_conversations (
    guest_name, guest_email, mbg_user_id, role, portal, kind, origin_app,
    application_id, subject
  ) VALUES (
    coalesce(v_full_name, 'Applicant'), v_email, v_app.user_id, 'customer', 'customer', 'operator_application', 'mybodaguy',
    p_application_id, format('%s driver application', v_app.vehicle_type)
  ) RETURNING id INTO v_conversation_id;

  INSERT INTO public.chat_messages (conversation_id, sender_role, sender_name, body)
  VALUES (
    v_conversation_id, 'dev', 'BodaGo Team',
    format('Hi! Following up on your %s application — feel free to ask any questions here.', v_app.vehicle_type)
  );

  RETURN jsonb_build_object('success', true, 'conversation_id', v_conversation_id, 'created', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_ensure_operator_application_conversation TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ mbg_ensure_operator_application_conversation ready — backfills a chat thread for any application that predates the chat integration.';
END $$;
