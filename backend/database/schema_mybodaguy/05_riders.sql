-- My Boda Guy - Riders
-- Riders (drivers) registered at stages

CREATE TYPE vehicle_type AS ENUM ('motorcycle', 'bicycle', 'tuktuk');
CREATE TYPE rider_status AS ENUM ('pending', 'active', 'suspended', 'inactive');

CREATE TABLE IF NOT EXISTS public.riders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  stage_id UUID NOT NULL REFERENCES public.stages(id) ON DELETE RESTRICT,
  vehicle_type vehicle_type NOT NULL DEFAULT 'motorcycle',
  plate_number TEXT NOT NULL UNIQUE,
  license_number TEXT NOT NULL,
  license_expiry DATE,
  vehicle_model TEXT,
  vehicle_year INTEGER,
  vehicle_color TEXT,
  status rider_status NOT NULL DEFAULT 'pending',
  is_available BOOLEAN NOT NULL DEFAULT false,
  rating DECIMAL(3, 2) DEFAULT 0.00 CHECK (rating >= 0 AND rating <= 5),
  total_rides INTEGER DEFAULT 0,
  completed_rides INTEGER DEFAULT 0,
  cancelled_rides INTEGER DEFAULT 0,
  approved_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.riders ENABLE ROW LEVEL SECURITY;

-- Riders can read their own record
DROP POLICY IF EXISTS riders_read_own ON public.riders;
CREATE POLICY riders_read_own ON public.riders
  FOR SELECT
  USING (auth.uid() = user_id);

-- Riders can insert their own record (registration)
DROP POLICY IF EXISTS riders_insert_own ON public.riders;
CREATE POLICY riders_insert_own ON public.riders
  FOR INSERT
  WITH CHECK (auth.uid() = user_id AND status = 'pending');

-- Riders can update their own availability
DROP POLICY IF EXISTS riders_update_own_availability ON public.riders;
CREATE POLICY riders_update_own_availability ON public.riders
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Stage chairpersons can read riders in their stage
DROP POLICY IF EXISTS riders_read_stage_chair ON public.riders;
CREATE POLICY riders_read_stage_chair ON public.riders
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.committee_members cm
      WHERE cm.user_id = auth.uid()
        AND cm.role = 'stage_chairperson'
        AND cm.region_type = 'stage'
        AND cm.region_id = riders.stage_id
        AND cm.is_active = true
    )
  );

-- Stage chairpersons can approve/suspend riders
DROP POLICY IF EXISTS riders_update_stage_chair ON public.riders;
CREATE POLICY riders_update_stage_chair ON public.riders
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.committee_members cm
      WHERE cm.user_id = auth.uid()
        AND cm.role = 'stage_chairperson'
        AND cm.region_type = 'stage'
        AND cm.region_id = riders.stage_id
        AND cm.is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.committee_members cm
      WHERE cm.user_id = auth.uid()
        AND cm.role = 'stage_chairperson'
        AND cm.region_type = 'stage'
        AND cm.region_id = riders.stage_id
        AND cm.is_active = true
    )
  );

-- Developers can read all riders
DROP POLICY IF EXISTS riders_read_developer ON public.riders;
CREATE POLICY riders_read_developer ON public.riders
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
        AND role_type = 'developer'
        AND is_active = true
    )
  );

-- Customers can read active available riders (for ride requests)
DROP POLICY IF EXISTS riders_read_customers ON public.riders;
CREATE POLICY riders_read_customers ON public.riders
  FOR SELECT
  USING (
    status = 'active' 
    AND is_available = true
    AND EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
        AND role_type = 'customer'
    )
  );

-- Service role has full access
DROP POLICY IF EXISTS riders_service_role ON public.riders;
CREATE POLICY riders_service_role ON public.riders
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS riders_user_id_idx ON public.riders(user_id);
CREATE INDEX IF NOT EXISTS riders_stage_id_idx ON public.riders(stage_id);
CREATE INDEX IF NOT EXISTS riders_status_idx ON public.riders(status);
CREATE INDEX IF NOT EXISTS riders_is_available_idx ON public.riders(is_available);
CREATE INDEX IF NOT EXISTS riders_plate_number_idx ON public.riders(plate_number);
CREATE INDEX IF NOT EXISTS riders_rating_idx ON public.riders(rating);

COMMIT;
