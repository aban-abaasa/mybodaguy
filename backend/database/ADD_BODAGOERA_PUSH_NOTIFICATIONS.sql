-- ============================================================
-- BodaGoEra: real phone push for ride requests, ride updates, chat and calls
-- ============================================================
-- Uses the ICANera push relay ("wallet-push" Edge Function, one VAPID key
-- pair, one device table) - see ICAN/backend/ICAN_APP_PUSH_REGISTRATION.sql.
-- A person who taps "Turn on alerts" in BodaGoEra gets:
--
--   * RIDER    - a new ride request assigned to them, and a cancellation
--   * CUSTOMER - rider accepted / ride started / ride completed / cancelled
--   * BOTH     - a chat message from the other person on the ride
--   * BOTH     - an INCOMING CALL that rings the phone even when the app is
--                closed. Calls are signalled over Supabase Realtime, which
--                only reaches an open app, so the caller's app also calls
--                mbg_notify_incoming_call() once; the push wakes the phone and
--                the call's repeating ring (45 s) connects when the app opens.
--
-- Run AFTER ICAN/backend/ICAN_APP_PUSH_REGISTRATION.sql, then redeploy the
-- wallet-push Edge Function (it now knows the bodagoera_* sources).
-- Safe to run more than once.
-- ============================================================

-- The two people on a ride, as auth user ids --------------------------------
CREATE OR REPLACE FUNCTION public.mbg_ride_parties(p_ride_id UUID)
RETURNS TABLE (customer_user_id UUID, rider_user_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.user_id, r.user_id
    FROM public.mbg_rides ride
    JOIN public.mbg_customers c ON c.id = ride.customer_id
    LEFT JOIN public.mbg_riders r ON r.id = ride.rider_id
   WHERE ride.id = p_ride_id;
$$;
REVOKE ALL ON FUNCTION public.mbg_ride_parties(UUID) FROM PUBLIC, anon, authenticated;

-- One place that builds a push for one person -------------------------------
CREATE OR REPLACE FUNCTION public.mbg_push(
  p_user_id UUID, p_source TEXT, p_title TEXT, p_message TEXT,
  p_ride_id UUID, p_tag TEXT DEFAULT NULL, p_video BOOLEAN DEFAULT FALSE
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS NULL THEN RETURN; END IF;
  PERFORM public.ican_push_relay(jsonb_build_object(
    'id', gen_random_uuid(),
    'recipient_user_id', p_user_id,
    'source', p_source,
    'title', p_title,
    'message', p_message,
    'ride_id', p_ride_id,
    'tag', p_tag,
    'video', p_video
  ));
END;
$$;
REVOKE ALL ON FUNCTION public.mbg_push(UUID, TEXT, TEXT, TEXT, UUID, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;

-- Ride requests and ride status changes -------------------------------------
CREATE OR REPLACE FUNCTION public.mbg_push_ride_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer UUID;
  v_rider    UUID;
  v_actor    UUID := auth.uid();
  v_route    TEXT := left(NEW.pickup_location, 40) || ' → ' || left(NEW.dropoff_location, 40);
  v_request  TEXT := v_route || ' · UGX ' || to_char(NEW.fare, 'FM999,999,999');
  v_tag      TEXT := 'mbg-ride-' || NEW.id;
BEGIN
  SELECT customer_user_id, rider_user_id INTO v_customer, v_rider FROM public.mbg_ride_parties(NEW.id);

  -- A ride handed to a specific rider (new booking, or re-assigned) = a request.
  -- (OLD only exists on UPDATE, so it is only read inside the UPDATE branch.)
  IF NEW.status::TEXT = 'pending' AND NEW.rider_id IS NOT NULL THEN
    IF TG_OP = 'INSERT' THEN
      PERFORM public.mbg_push(v_rider, 'bodagoera_ride', 'New ride request', v_request, NEW.id, v_tag);
      RETURN NEW;
    ELSIF NEW.rider_id IS DISTINCT FROM OLD.rider_id THEN
      PERFORM public.mbg_push(v_rider, 'bodagoera_ride', 'New ride request', v_request, NEW.id, v_tag);
      RETURN NEW;
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
   IF NEW.status IS DISTINCT FROM OLD.status THEN
    CASE NEW.status::TEXT
      WHEN 'accepted' THEN
        PERFORM public.mbg_push(v_customer, 'bodagoera_ride', 'Your rider accepted', 'Your rider is on the way. ' || v_route, NEW.id, v_tag);
      WHEN 'in_progress' THEN
        PERFORM public.mbg_push(v_customer, 'bodagoera_ride', 'Your ride has started', v_route, NEW.id, v_tag);
      WHEN 'completed' THEN
        PERFORM public.mbg_push(v_customer, 'bodagoera_ride', 'Ride completed', 'Thank you for riding with BodaGoEra.', NEW.id, v_tag);
      WHEN 'cancelled' THEN
        -- Tell the other person. No signed-in actor (a system cancel) tells both.
        IF v_actor IS DISTINCT FROM v_customer THEN
          PERFORM public.mbg_push(v_customer, 'bodagoera_ride', 'Ride cancelled', v_route, NEW.id, v_tag);
        END IF;
        IF v_actor IS DISTINCT FROM v_rider THEN
          PERFORM public.mbg_push(v_rider, 'bodagoera_ride', 'Ride cancelled', v_route, NEW.id, v_tag);
        END IF;
      ELSE
        NULL;
    END CASE;
   END IF;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Ride push failed - %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mbg_ride_push ON public.mbg_rides;
CREATE TRIGGER mbg_ride_push
AFTER INSERT OR UPDATE OF status, rider_id ON public.mbg_rides
FOR EACH ROW EXECUTE FUNCTION public.mbg_push_ride_event();

-- Ride chat messages ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mbg_push_ride_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer UUID;
  v_rider    UUID;
  v_target   UUID;
BEGIN
  SELECT customer_user_id, rider_user_id INTO v_customer, v_rider FROM public.mbg_ride_parties(NEW.ride_id);
  v_target := CASE WHEN NEW.sender_user_id = v_customer THEN v_rider ELSE v_customer END;
  PERFORM public.mbg_push(v_target, 'bodagoera_message', 'New message', left(NEW.message, 120), NEW.ride_id, 'mbg-msg-' || NEW.ride_id);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Ride message push failed - %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mbg_ride_message_push ON public.mbg_ride_messages;
CREATE TRIGGER mbg_ride_message_push
AFTER INSERT ON public.mbg_ride_messages
FOR EACH ROW EXECUTE FUNCTION public.mbg_push_ride_message();

-- Incoming call ---------------------------------------------------------------
-- Called by the CALLER's app once when it starts ringing. Only a person on the
-- ride can ring the other person on it.
CREATE OR REPLACE FUNCTION public.mbg_notify_incoming_call(
  p_ride_id     UUID,
  p_caller_name TEXT DEFAULT NULL,
  p_video       BOOLEAN DEFAULT FALSE
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_customer UUID;
  v_rider    UUID;
  v_target   UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to place a call';
  END IF;

  SELECT customer_user_id, rider_user_id INTO v_customer, v_rider FROM public.mbg_ride_parties(p_ride_id);
  IF v_uid = v_customer THEN v_target := v_rider;
  ELSIF v_uid = v_rider THEN v_target := v_customer;
  ELSE RAISE EXCEPTION 'You are not on this ride';
  END IF;

  IF v_target IS NULL THEN RETURN FALSE; END IF;

  PERFORM public.mbg_push(
    v_target, 'bodagoera_call',
    CASE WHEN p_video THEN 'Incoming video call' ELSE 'Incoming call' END,
    COALESCE(NULLIF(trim(left(p_caller_name, 60)), ''), 'Your ride partner') || ' is calling you - tap to answer.',
    p_ride_id, 'mbg-call-' || p_ride_id, p_video
  );
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.mbg_notify_incoming_call(UUID, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mbg_notify_incoming_call(UUID, TEXT, BOOLEAN) TO authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'BodaGoEra ride requests, updates, messages and calls now dispatch push alerts' AS status;
