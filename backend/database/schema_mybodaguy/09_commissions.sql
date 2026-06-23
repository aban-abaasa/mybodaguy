-- My Boda Guy - Commissions
-- Commission distribution to chairpersons at different levels

CREATE TYPE commission_status AS ENUM ('pending', 'paid', 'failed');

CREATE TABLE IF NOT EXISTS public.commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID NOT NULL REFERENCES public.rides(id) ON DELETE RESTRICT,
  payment_id UUID NOT NULL REFERENCES public.payments(id) ON DELETE RESTRICT,
  
  -- Recipient details
  recipient_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  recipient_role TEXT NOT NULL,
  region_type region_type NOT NULL,
  region_id UUID NOT NULL,
  
  -- Commission details
  ride_fare DECIMAL(10, 2) NOT NULL,
  commission_percentage DECIMAL(5, 2) NOT NULL,
  commission_amount DECIMAL(10, 2) NOT NULL,
  
  -- Status
  status commission_status NOT NULL DEFAULT 'pending',
  
  -- Payment details
  paid_at TIMESTAMPTZ,
  payment_method payment_method,
  payment_reference TEXT,
  
  -- Failure details
  failed_at TIMESTAMPTZ,
  failure_reason TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.commissions ENABLE ROW LEVEL SECURITY;

-- Recipients can read their own commissions
DROP POLICY IF EXISTS commissions_read_own ON public.commissions;
CREATE POLICY commissions_read_own ON public.commissions
  FOR SELECT
  USING (auth.uid() = recipient_id);

-- Developers can read all commissions
DROP POLICY IF EXISTS commissions_read_developer ON public.commissions;
CREATE POLICY commissions_read_developer ON public.commissions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
        AND role_type = 'developer'
        AND is_active = true
    )
  );

-- Service role has full access (for commission processing)
DROP POLICY IF EXISTS commissions_service_role ON public.commissions;
CREATE POLICY commissions_service_role ON public.commissions
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Indexes
CREATE INDEX IF NOT EXISTS commissions_ride_id_idx ON public.commissions(ride_id);
CREATE INDEX IF NOT EXISTS commissions_payment_id_idx ON public.commissions(payment_id);
CREATE INDEX IF NOT EXISTS commissions_recipient_id_idx ON public.commissions(recipient_id);
CREATE INDEX IF NOT EXISTS commissions_status_idx ON public.commissions(status);
CREATE INDEX IF NOT EXISTS commissions_region_idx ON public.commissions(region_type, region_id);
CREATE INDEX IF NOT EXISTS commissions_created_at_idx ON public.commissions(created_at DESC);

COMMIT;
