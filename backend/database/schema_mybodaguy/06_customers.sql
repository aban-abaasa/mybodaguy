-- My Boda Guy - Customers
-- Customer profiles for ride booking

CREATE TABLE IF NOT EXISTS public.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  default_pickup_location TEXT,
  default_pickup_lat DECIMAL(10, 8),
  default_pickup_lng DECIMAL(11, 8),
  rating DECIMAL(3, 2) DEFAULT 5.00 CHECK (rating >= 0 AND rating <= 5),
  total_rides INTEGER DEFAULT 0,
  completed_rides INTEGER DEFAULT 0,
  cancelled_rides INTEGER DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

-- Customers can read their own record
DROP POLICY IF EXISTS customers_read_own ON public.customers;
CREATE POLICY customers_read_own ON public.customers
  FOR SELECT
  USING (auth.uid() = user_id);

-- Customers can insert their own record
DROP POLICY IF EXISTS customers_insert_own ON public.customers;
CREATE POLICY customers_insert_own ON public.customers
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Customers can update their own record
DROP POLICY IF EXISTS customers_update_own ON public.customers;
CREATE POLICY customers_update_own ON public.customers
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Developers can read all customers
DROP POLICY IF EXISTS customers_read_developer ON public.customers;
CREATE POLICY customers_read_developer ON public.customers
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
        AND role_type = 'developer'
        AND is_active = true
    )
  );

-- Service role has full access
DROP POLICY IF EXISTS customers_service_role ON public.customers;
CREATE POLICY customers_service_role ON public.customers
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS customers_user_id_idx ON public.customers(user_id);
CREATE INDEX IF NOT EXISTS customers_rating_idx ON public.customers(rating);
CREATE INDEX IF NOT EXISTS customers_is_active_idx ON public.customers(is_active);

COMMIT;
