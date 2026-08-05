-- Employee-booked, company-paid transport.
-- Run after SHARED_CORPORATE_TRANSPORT_AND_MONTHLY_RIDERS.sql,
-- ADD_RIDE_PAYMENT_METHOD_AND_COMMISSION.sql and the business-wallet migrations.

ALTER TABLE public.mbg_rides
  ADD COLUMN IF NOT EXISTS company_profile_id UUID REFERENCES public.business_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS company_employee_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS company_transport_allocation_id UUID,
  ADD COLUMN IF NOT EXISTS company_billing_mode TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.mbg_rides'::regclass
       AND conname = 'mbg_rides_payment_method_check'
  ) THEN
    ALTER TABLE public.mbg_rides DROP CONSTRAINT mbg_rides_payment_method_check;
  END IF;
  ALTER TABLE public.mbg_rides
    ADD CONSTRAINT mbg_rides_payment_method_check
    CHECK (payment_method IN ('wallet','cash','company'));
END $$;

CREATE TABLE IF NOT EXISTS public.mbg_company_transport_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  employee_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at TIMESTAMPTZ,
  daily_start_time TIME NOT NULL DEFAULT '06:00',
  daily_end_time TIME NOT NULL DEFAULT '18:00',
  allowed_days SMALLINT[] NOT NULL DEFAULT ARRAY[0,1,2,3,4,5,6],
  billing_mode TEXT NOT NULL DEFAULT 'per_ride' CHECK (billing_mode IN ('per_ride','monthly')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','expired','cancelled')),
  assigned_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.mbg_company_transport_allocations
  ADD COLUMN IF NOT EXISTS daily_start_time TIME NOT NULL DEFAULT '06:00',
  ADD COLUMN IF NOT EXISTS daily_end_time TIME NOT NULL DEFAULT '18:00';

CREATE INDEX IF NOT EXISTS idx_mbg_company_transport_allocations_employee
  ON public.mbg_company_transport_allocations(employee_user_id, status, starts_at, ends_at);

CREATE INDEX IF NOT EXISTS idx_mbg_rides_company_transport_tracking
  ON public.mbg_rides(company_profile_id, company_employee_user_id, created_at DESC)
  WHERE company_profile_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.mbg_company_transport_charges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID NOT NULL UNIQUE REFERENCES public.mbg_rides(id) ON DELETE CASCADE,
  business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  employee_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  allocation_id UUID NOT NULL REFERENCES public.mbg_company_transport_allocations(id) ON DELETE RESTRICT,
  amount_ican NUMERIC(18,8) NOT NULL CHECK (amount_ican > 0),
  billing_mode TEXT NOT NULL CHECK (billing_mode IN ('per_ride','monthly')),
  status TEXT NOT NULL DEFAULT 'accrued' CHECK (status IN ('accrued','paid','failed')),
  wallet_transaction_id UUID REFERENCES public.ican_business_wallet_transactions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at TIMESTAMPTZ
);

ALTER TABLE public.mbg_company_transport_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mbg_company_transport_charges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mbg_company_transport_allocations_access ON public.mbg_company_transport_allocations;
CREATE POLICY mbg_company_transport_allocations_access
  ON public.mbg_company_transport_allocations FOR ALL TO authenticated
  USING (public.mbg_business_member(business_profile_id) OR employee_user_id = auth.uid())
  WITH CHECK (public.ican_business_admin(business_profile_id));

DROP POLICY IF EXISTS mbg_company_transport_charges_access ON public.mbg_company_transport_charges;
CREATE POLICY mbg_company_transport_charges_access
  ON public.mbg_company_transport_charges FOR SELECT TO authenticated
  USING (public.mbg_business_member(business_profile_id) OR employee_user_id = auth.uid());

-- Called by the BodaGo/Supermarkera customer page. The employee's auth ID is
-- the Gmail-linked identity; no company selector is trusted from the browser.
CREATE OR REPLACE FUNCTION public.mbg_get_company_transport_benefit()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row RECORD;
BEGIN
  SELECT a.id, a.business_profile_id, a.billing_mode, a.starts_at, a.ends_at,
         a.daily_start_time, a.daily_end_time,
         bp.business_name
    INTO v_row
    FROM public.mbg_company_transport_allocations a
    JOIN public.business_profiles bp ON bp.id = a.business_profile_id
   WHERE a.employee_user_id = auth.uid()
     AND a.status = 'active'
     AND now() >= a.starts_at
     AND (a.ends_at IS NULL OR now() <= a.ends_at)
     AND EXTRACT(DOW FROM now())::SMALLINT = ANY(a.allowed_days)
     AND (
       (a.daily_start_time <= a.daily_end_time AND LOCALTIME::TIME BETWEEN a.daily_start_time AND a.daily_end_time)
       OR
       (a.daily_start_time > a.daily_end_time AND (LOCALTIME::TIME >= a.daily_start_time OR LOCALTIME::TIME <= a.daily_end_time))
     )
   ORDER BY a.starts_at DESC
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('eligible', false, 'payment_method', 'wallet');
  END IF;
  RETURN jsonb_build_object(
    'eligible', true, 'payment_method', 'company',
    'business_profile_id', v_row.business_profile_id,
    'allocation_id', v_row.id, 'billing_mode', v_row.billing_mode,
    'business_name', v_row.business_name, 'starts_at', v_row.starts_at,
    'ends_at', v_row.ends_at, 'daily_start_time', v_row.daily_start_time,
    'daily_end_time', v_row.daily_end_time
  );
END;
$$;
REVOKE ALL ON FUNCTION public.mbg_get_company_transport_benefit() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mbg_get_company_transport_benefit() TO authenticated;

CREATE OR REPLACE FUNCTION public.mbg_allocate_company_transport_worker(
  p_business_profile_id UUID, p_employee_email TEXT, p_starts_at TIMESTAMPTZ,
  p_ends_at TIMESTAMPTZ DEFAULT NULL, p_billing_mode TEXT DEFAULT 'per_ride',
  p_daily_start_time TIME DEFAULT '06:00', p_daily_end_time TIME DEFAULT '18:00'
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE v_employee UUID; v_allocation UUID;
BEGIN
  IF NOT public.ican_business_admin(p_business_profile_id) THEN
    RAISE EXCEPTION 'Business administrator access required';
  END IF;
  SELECT id INTO v_employee FROM auth.users WHERE lower(email) = lower(trim(p_employee_email)) LIMIT 1;
  IF v_employee IS NULL THEN RAISE EXCEPTION 'No signed-in account matches this Gmail address'; END IF;
  IF p_billing_mode NOT IN ('per_ride','monthly') THEN RAISE EXCEPTION 'Invalid billing mode'; END IF;
  IF p_daily_start_time IS NULL OR p_daily_end_time IS NULL THEN RAISE EXCEPTION 'Daily start and end times are required'; END IF;
  INSERT INTO public.mbg_company_transport_allocations
    (business_profile_id,employee_user_id,starts_at,ends_at,daily_start_time,daily_end_time,billing_mode,assigned_by)
  VALUES
    (p_business_profile_id,v_employee,p_starts_at,p_ends_at,p_daily_start_time,p_daily_end_time,p_billing_mode,auth.uid())
  RETURNING id INTO v_allocation;
  RETURN jsonb_build_object('success',true,'allocation_id',v_allocation,'employee_user_id',v_employee);
END;
$$;
REVOKE ALL ON FUNCTION public.mbg_allocate_company_transport_worker(UUID,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,TEXT,TIME,TIME) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mbg_allocate_company_transport_worker(UUID,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,TEXT,TIME,TIME) TO authenticated;

-- This wrapper deliberately calls the existing, well-tested request engine.
-- It changes the payment source only after the ride has been created, so the
-- employee's ordinary customer booking and rider matching behavior is reused.
CREATE OR REPLACE FUNCTION public.mbg_request_company_ride(
  p_service_type TEXT, p_delivery_mode TEXT, p_supermarket_id UUID, p_rider_id UUID,
  p_pickup_location TEXT, p_pickup_lat NUMERIC, p_pickup_lng NUMERIC,
  p_dropoff_location TEXT, p_dropoff_lat NUMERIC, p_dropoff_lng NUMERIC,
  p_power_type_requested TEXT, p_umbrella_requested BOOLEAN,
  p_order_notes TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_benefit JSONB; v_result JSONB; v_ride_id UUID;
BEGIN
  v_benefit := public.mbg_get_company_transport_benefit();
  IF COALESCE((v_benefit->>'eligible')::BOOLEAN, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'This Gmail account has no active company transport allocation';
  END IF;
  v_result := public.mbg_request_ride(
    p_service_type, p_delivery_mode, p_supermarket_id, p_rider_id,
    p_pickup_location, p_pickup_lat, p_pickup_lng,
    p_dropoff_location, p_dropoff_lat, p_dropoff_lng,
    p_power_type_requested, p_umbrella_requested, p_order_notes, 'wallet'
  );
  v_ride_id := NULLIF(v_result->>'ride_id','')::UUID;
  UPDATE public.mbg_rides
     SET payment_method = 'company',
         company_profile_id = NULLIF(v_benefit->>'business_profile_id','')::UUID,
         company_employee_user_id = auth.uid(),
         company_transport_allocation_id = NULLIF(v_benefit->>'allocation_id','')::UUID,
         company_billing_mode = COALESCE(v_benefit->>'billing_mode','per_ride')
   WHERE id = v_ride_id AND customer_id IN (
     SELECT id FROM public.mbg_customers WHERE user_id = auth.uid()
   );
  RETURN v_result || jsonb_build_object(
    'payment_method','company',
    'company_profile_id',v_benefit->>'business_profile_id',
    'billing_mode',v_benefit->>'billing_mode'
  );
END;
$$;
REVOKE ALL ON FUNCTION public.mbg_request_company_ride(TEXT,TEXT,UUID,UUID,TEXT,NUMERIC,NUMERIC,TEXT,NUMERIC,NUMERIC,TEXT,BOOLEAN,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mbg_request_company_ride(TEXT,TEXT,UUID,UUID,TEXT,NUMERIC,NUMERIC,TEXT,NUMERIC,NUMERIC,TEXT,BOOLEAN,TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.mbg_charge_company_transport_ride()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_amount NUMERIC; v_wallet public.ican_business_wallets; v_tx UUID;
BEGIN
  IF NEW.status <> 'completed' OR OLD.status = 'completed' OR NEW.payment_method <> 'company' THEN
    RETURN NEW;
  END IF;
  v_amount := ROUND((NEW.fare / 5000) * (1 + public.mbg_get_setting_numeric('commission.wallet_customer_surcharge_percentage',7)/100),8);
  IF NEW.company_billing_mode = 'monthly' THEN
    INSERT INTO public.mbg_company_transport_charges
      (ride_id,business_profile_id,employee_user_id,allocation_id,amount_ican,
       billing_mode,status)
    VALUES
      (NEW.id,NEW.company_profile_id,NEW.company_employee_user_id,
       NEW.company_transport_allocation_id,v_amount,'monthly','accrued');
    UPDATE public.mbg_riders SET is_available = true WHERE id = NEW.rider_id;
    RETURN NEW;
  END IF;
  SELECT * INTO v_wallet
    FROM public.ican_business_wallets
   WHERE business_profile_id = NEW.company_profile_id AND status = 'active'
   FOR UPDATE;
  IF NOT FOUND OR v_wallet.ican_balance < v_amount THEN
    RAISE EXCEPTION 'Company transport wallet has insufficient balance';
  END IF;
  UPDATE public.ican_business_wallets
     SET ican_balance = ican_balance - v_amount,
         total_spent = total_spent + v_amount, updated_at = now()
   WHERE id = v_wallet.id;
  INSERT INTO public.ican_business_wallet_transactions
    (business_profile_id, initiated_by, recipient_user_id, amount_ican, note,
     reference_id, status, executed_at, direction, source_app, operation_type, metadata)
  VALUES
    (NEW.company_profile_id, NEW.company_employee_user_id, NULL, v_amount,
     'Company-paid worker transport', NEW.id::TEXT, 'completed', now(), 'out',
     'mybodaguy', 'transport_ride',
     jsonb_build_object('ride_id',NEW.id,'billing_mode',NEW.company_billing_mode))
  RETURNING id INTO v_tx;
  INSERT INTO public.mbg_company_transport_charges
    (ride_id,business_profile_id,employee_user_id,allocation_id,amount_ican,
     billing_mode,status,wallet_transaction_id,paid_at)
  VALUES
    (NEW.id,NEW.company_profile_id,NEW.company_employee_user_id,
     NEW.company_transport_allocation_id,v_amount,
     COALESCE(NEW.company_billing_mode,'per_ride'),
     'paid',v_tx,now());
  UPDATE public.mbg_riders SET is_available = true WHERE id = NEW.rider_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mbg_company_transport_charge_after_completion ON public.mbg_rides;
CREATE TRIGGER mbg_company_transport_charge_after_completion
AFTER UPDATE OF status ON public.mbg_rides
FOR EACH ROW EXECUTE FUNCTION public.mbg_charge_company_transport_ride();

-- Company admins use this once per month for monthly allocations.
CREATE OR REPLACE FUNCTION public.mbg_settle_company_transport_month(
  p_business_profile_id UUID, p_period_start DATE, p_period_end DATE
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_total NUMERIC; v_wallet public.ican_business_wallets; v_tx UUID;
BEGIN
  IF NOT public.ican_business_admin(p_business_profile_id) THEN
    RAISE EXCEPTION 'Business administrator access required';
  END IF;
  SELECT COALESCE(SUM(amount_ican),0) INTO v_total
    FROM public.mbg_company_transport_charges
   WHERE business_profile_id = p_business_profile_id
     AND billing_mode = 'monthly' AND status = 'accrued'
     AND created_at >= p_period_start AND created_at < (p_period_end + 1);
  IF v_total = 0 THEN
    RETURN jsonb_build_object('success',true,'status','nothing_to_settle','amount_ican',0);
  END IF;
  SELECT * INTO v_wallet FROM public.ican_business_wallets
   WHERE business_profile_id = p_business_profile_id AND status='active' FOR UPDATE;
  IF NOT FOUND OR v_wallet.ican_balance < v_total THEN
    RAISE EXCEPTION 'Company transport wallet has insufficient balance';
  END IF;
  UPDATE public.ican_business_wallets
     SET ican_balance=ican_balance-v_total,total_spent=total_spent+v_total,updated_at=now()
   WHERE id=v_wallet.id;
  INSERT INTO public.ican_business_wallet_transactions
    (business_profile_id,initiated_by,amount_ican,note,reference_id,status,
     executed_at,direction,source_app,operation_type,metadata)
  VALUES
    (p_business_profile_id,auth.uid(),v_total,'Monthly company transport settlement',
     p_business_profile_id::TEXT||':'||p_period_start::TEXT||':'||p_period_end::TEXT,
     'completed',now(),'out','mybodaguy','transport_monthly_settlement',
     jsonb_build_object('period_start',p_period_start,'period_end',p_period_end))
  RETURNING id INTO v_tx;
  UPDATE public.mbg_company_transport_charges
     SET status='paid',wallet_transaction_id=v_tx,paid_at=now()
   WHERE business_profile_id=p_business_profile_id AND billing_mode='monthly'
     AND status='accrued' AND created_at >= p_period_start
     AND created_at < (p_period_end + 1);
  RETURN jsonb_build_object('success',true,'status','paid','amount_ican',v_total,'transaction_id',v_tx);
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_settle_company_transport_month(UUID,DATE,DATE) TO authenticated;

-- CMMS usage tracking: assigned workers remain visible even when they have
-- made zero rides in the selected period.
CREATE OR REPLACE FUNCTION public.mbg_company_transport_usage(
  p_business_profile_id UUID,
  p_period_start TIMESTAMPTZ DEFAULT now() - INTERVAL '30 days',
  p_period_end TIMESTAMPTZ DEFAULT now()
)
RETURNS TABLE (
  allocation_id UUID,
  employee_user_id UUID,
  employee_email TEXT,
  billing_mode TEXT,
  allocation_status TEXT,
  daily_start_time TIME,
  daily_end_time TIME,
  ride_count BIGINT,
  completed_ride_count BIGINT,
  total_fare NUMERIC,
  first_order_at TIMESTAMPTZ,
  last_order_at TIMESTAMPTZ,
  order_times JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.ican_business_admin(p_business_profile_id) THEN
    RAISE EXCEPTION 'Business administrator access required';
  END IF;
  RETURN QUERY
  SELECT
    a.id,
    a.employee_user_id,
    lower(au.email)::TEXT,
    a.billing_mode,
    a.status,
    a.daily_start_time,
    a.daily_end_time,
    COUNT(r.id)::BIGINT,
    COUNT(r.id) FILTER (WHERE r.status = 'completed')::BIGINT,
    COALESCE(SUM(r.fare), 0)::NUMERIC,
    MIN(r.created_at),
    MAX(r.created_at),
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'ride_id', r.id,
          'ordered_at', r.created_at,
          'status', r.status,
          'pickup', r.pickup_location,
          'dropoff', r.dropoff_location,
          'fare', r.fare
        ) ORDER BY r.created_at DESC
      ) FILTER (WHERE r.id IS NOT NULL),
      '[]'::JSONB
    )
  FROM public.mbg_company_transport_allocations a
  JOIN auth.users au ON au.id = a.employee_user_id
  LEFT JOIN public.mbg_rides r
    ON r.company_transport_allocation_id = a.id
   AND r.created_at >= p_period_start
   AND r.created_at < p_period_end
  WHERE a.business_profile_id = p_business_profile_id
  GROUP BY a.id, a.employee_user_id, au.email, a.billing_mode, a.status,
           a.daily_start_time, a.daily_end_time
  ORDER BY MAX(r.created_at) DESC NULLS LAST, lower(au.email);
END;
$$;
REVOKE ALL ON FUNCTION public.mbg_company_transport_usage(UUID,TIMESTAMPTZ,TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mbg_company_transport_usage(UUID,TIMESTAMPTZ,TIMESTAMPTZ) TO authenticated;

NOTIFY pgrst,'reload schema';
