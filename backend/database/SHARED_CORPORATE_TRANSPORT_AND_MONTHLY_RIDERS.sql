-- BodaGoEra corporate transport, company fleet, and monthly rider contracts.

ALTER TABLE IF EXISTS public.mbg_riders
  ADD COLUMN IF NOT EXISTS business_profile_id UUID REFERENCES public.business_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ownership_mode TEXT DEFAULT 'personal',
  ADD COLUMN IF NOT EXISTS assigned_employee_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF to_regclass('public.mbg_riders') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'public.mbg_riders'::regclass
      AND conname = 'mbg_riders_ownership_mode_check'
  ) THEN
    ALTER TABLE public.mbg_riders ADD CONSTRAINT mbg_riders_ownership_mode_check
      CHECK (ownership_mode IN ('personal', 'company'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.mbg_company_fleet_vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  vehicle_type TEXT NOT NULL CHECK (vehicle_type IN ('motorcycle', 'bicycle', 'tuktuk', 'car', 'van', 'truck')),
  registration_number TEXT NOT NULL,
  make TEXT,
  model TEXT,
  year INTEGER,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'maintenance', 'retired', 'suspended')),
  assigned_driver_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  cmms_asset_id UUID,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_profile_id, registration_number)
);

CREATE TABLE IF NOT EXISTS public.mbg_corporate_transport_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  contract_name TEXT NOT NULL,
  billing_cycle TEXT NOT NULL DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly', 'prepaid')),
  monthly_limit NUMERIC(15,2),
  credit_limit NUMERIC(15,2),
  currency TEXT NOT NULL DEFAULT 'UGX',
  allowed_vehicle_types TEXT[] NOT NULL DEFAULT ARRAY['motorcycle','bicycle','tuktuk','car','van','truck'],
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'suspended', 'expired', 'cancelled')),
  starts_on DATE NOT NULL DEFAULT CURRENT_DATE,
  ends_on DATE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mbg_corporate_ride_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES public.mbg_corporate_transport_contracts(id) ON DELETE CASCADE,
  business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  ride_count INTEGER NOT NULL DEFAULT 1 CHECK (ride_count > 0),
  requested_vehicle_type TEXT,
  recurrence TEXT CHECK (recurrence IN ('once', 'daily', 'weekly', 'monthly')),
  pickup_location TEXT,
  dropoff_location TEXT,
  scheduled_for TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'dispatched', 'completed', 'cancelled', 'rejected')),
  estimated_total NUMERIC(15,2) DEFAULT 0,
  actual_total NUMERIC(15,2) DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mbg_rider_employment_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  rider_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pay_type TEXT NOT NULL DEFAULT 'per_ride' CHECK (pay_type IN ('per_ride', 'monthly', 'hybrid')),
  monthly_salary NUMERIC(15,2) DEFAULT 0,
  ride_incentive_rate NUMERIC(8,2) DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'UGX',
  starts_on DATE NOT NULL DEFAULT CURRENT_DATE,
  ends_on DATE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'suspended', 'ended', 'rejected')),
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mbg_rider_monthly_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employment_contract_id UUID NOT NULL REFERENCES public.mbg_rider_employment_contracts(id) ON DELETE CASCADE,
  business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  rider_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  base_salary NUMERIC(15,2) NOT NULL DEFAULT 0,
  ride_incentives NUMERIC(15,2) NOT NULL DEFAULT 0,
  deductions NUMERIC(15,2) NOT NULL DEFAULT 0,
  net_amount NUMERIC(15,2) GENERATED ALWAYS AS
    (base_salary + ride_incentives - deductions) STORED,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'paid', 'held', 'cancelled')),
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employment_contract_id, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_mbg_fleet_business
  ON public.mbg_company_fleet_vehicles(business_profile_id, status);
CREATE INDEX IF NOT EXISTS idx_mbg_contract_business
  ON public.mbg_corporate_transport_contracts(business_profile_id, status);
CREATE INDEX IF NOT EXISTS idx_mbg_ride_requests_contract
  ON public.mbg_corporate_ride_requests(contract_id, status);
CREATE INDEX IF NOT EXISTS idx_mbg_rider_contract_business
  ON public.mbg_rider_employment_contracts(business_profile_id, status);

ALTER TABLE public.mbg_company_fleet_vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mbg_corporate_transport_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mbg_corporate_ride_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mbg_rider_employment_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mbg_rider_monthly_payments ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.mbg_business_member(p_business_profile_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.ican_business_member(p_business_profile_id);
$$;

-- A chairperson may only receive commission after completing the committee
-- profile. This prevents payouts to placeholder/auto-created assignments.
CREATE OR REPLACE FUNCTION public.mbg_chairperson_commission_eligible(p_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.mbg_committee_members cm
    JOIN public.mbg_user_profiles up ON up.user_id = cm.user_id
    JOIN public.committee_member_details cmd ON cmd.committee_member_id = cm.id
    WHERE cm.user_id = p_user_id
      AND cm.is_active = true
      AND COALESCE(cm.commission_rate, 0) > 0
      AND NULLIF(BTRIM(up.full_name), '') IS NOT NULL
      AND NULLIF(BTRIM(up.phone), '') IS NOT NULL
      AND NULLIF(BTRIM(cmd.full_name), '') IS NOT NULL
      AND NULLIF(BTRIM(cmd.national_id), '') IS NOT NULL
      AND NULLIF(BTRIM(cmd.emergency_contact_name), '') IS NOT NULL
      AND NULLIF(BTRIM(cmd.emergency_contact_phone), '') IS NOT NULL
  );
$$;

GRANT EXECUTE ON FUNCTION public.mbg_chairperson_commission_eligible(UUID) TO authenticated, service_role;

DROP POLICY IF EXISTS mbg_fleet_business_access ON public.mbg_company_fleet_vehicles;
CREATE POLICY mbg_fleet_business_access ON public.mbg_company_fleet_vehicles
  FOR ALL TO authenticated USING (public.mbg_business_member(business_profile_id))
  WITH CHECK (public.ican_business_admin(business_profile_id));

DROP POLICY IF EXISTS mbg_contract_business_access ON public.mbg_corporate_transport_contracts;
CREATE POLICY mbg_contract_business_access ON public.mbg_corporate_transport_contracts
  FOR ALL TO authenticated USING (public.mbg_business_member(business_profile_id))
  WITH CHECK (public.ican_business_admin(business_profile_id));

DROP POLICY IF EXISTS mbg_ride_request_business_access ON public.mbg_corporate_ride_requests;
CREATE POLICY mbg_ride_request_business_access ON public.mbg_corporate_ride_requests
  FOR ALL TO authenticated USING (public.mbg_business_member(business_profile_id))
  WITH CHECK (public.mbg_business_member(business_profile_id));

DROP POLICY IF EXISTS mbg_rider_contract_business_access ON public.mbg_rider_employment_contracts;
CREATE POLICY mbg_rider_contract_business_access ON public.mbg_rider_employment_contracts
  FOR ALL TO authenticated USING (public.mbg_business_member(business_profile_id))
  WITH CHECK (public.ican_business_admin(business_profile_id));

DROP POLICY IF EXISTS mbg_rider_pay_business_access ON public.mbg_rider_monthly_payments;
CREATE POLICY mbg_rider_pay_business_access ON public.mbg_rider_monthly_payments
  FOR ALL TO authenticated USING (
    public.mbg_business_member(business_profile_id) OR rider_user_id = auth.uid()
  )
  WITH CHECK (public.ican_business_admin(business_profile_id));
