-- My Boda Guy - Payments
-- Payment tracking for rides

CREATE TYPE payment_method AS ENUM ('cash', 'mobile_money', 'card', 'wallet');
CREATE TYPE payment_status AS ENUM ('pending', 'completed', 'failed', 'refunded');

CREATE TABLE IF NOT EXISTS public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID NOT NULL REFERENCES public.rides(id) ON DELETE RESTRICT,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  rider_id UUID NOT NULL REFERENCES public.riders(id) ON DELETE RESTRICT,
  
  amount DECIMAL(10, 2) NOT NULL,
  payment_method payment_method NOT NULL DEFAULT 'cash',
  status payment_status NOT NULL DEFAULT 'pending',
  
  -- External payment details
  transaction_id TEXT,
  payment_provider TEXT,
  provider_reference TEXT,
  
  -- Mobile money details
  phone_number TEXT,
  
  -- Timestamps
  initiated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,
  
  -- Failure/refund details
  failure_reason TEXT,
  refund_reason TEXT,
  refund_amount DECIMAL(10, 2),
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- Customers can read their own payments
DROP POLICY IF EXISTS payments_read_customer ON public.payments;
CREATE POLICY payments_read_customer ON public.payments
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.id = payments.customer_id
        AND c.user_id = auth.uid()
    )
  );

-- Riders can read their ride payments
DROP POLICY IF EXISTS payments_read_rider ON public.payments;
CREATE POLICY payments_read_rider ON public.payments
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.riders r
      WHERE r.id = payments.rider_id
        AND r.user_id = auth.uid()
    )
  );

-- Customers can create payments for their rides
DROP POLICY IF EXISTS payments_insert_customer ON public.payments;
CREATE POLICY payments_insert_customer ON public.payments
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.id = customer_id
        AND c.user_id = auth.uid()
    )
  );

-- Developers can read all payments
DROP POLICY IF EXISTS payments_read_developer ON public.payments;
CREATE POLICY payments_read_developer ON public.payments
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
        AND role_type = 'developer'
        AND is_active = true
    )
  );

-- Service role has full access (for payment processing)
DROP POLICY IF EXISTS payments_service_role ON public.payments;
CREATE POLICY payments_service_role ON public.payments
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Indexes
CREATE INDEX IF NOT EXISTS payments_ride_id_idx ON public.payments(ride_id);
CREATE INDEX IF NOT EXISTS payments_customer_id_idx ON public.payments(customer_id);
CREATE INDEX IF NOT EXISTS payments_rider_id_idx ON public.payments(rider_id);
CREATE INDEX IF NOT EXISTS payments_status_idx ON public.payments(status);
CREATE INDEX IF NOT EXISTS payments_transaction_id_idx ON public.payments(transaction_id);
CREATE INDEX IF NOT EXISTS payments_initiated_at_idx ON public.payments(initiated_at DESC);

COMMIT;
