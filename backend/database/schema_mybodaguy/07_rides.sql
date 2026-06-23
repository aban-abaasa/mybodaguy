-- My Boda Guy - Rides
-- Ride bookings and tracking

CREATE TYPE ride_status AS ENUM (
  'pending',      -- Requested by customer
  'accepted',     -- Accepted by rider
  'in_progress',  -- Rider is on the way or with customer
  'completed',    -- Ride completed successfully
  'cancelled',    -- Cancelled by customer or rider
  'failed'        -- Failed for any reason
);

CREATE TYPE cancellation_by AS ENUM ('customer', 'rider', 'system');

CREATE TABLE IF NOT EXISTS public.rides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  rider_id UUID REFERENCES public.riders(id) ON DELETE RESTRICT,
  stage_id UUID NOT NULL REFERENCES public.stages(id) ON DELETE RESTRICT,
  
  -- Locations
  pickup_location TEXT NOT NULL,
  pickup_lat DECIMAL(10, 8) NOT NULL,
  pickup_lng DECIMAL(11, 8) NOT NULL,
  dropoff_location TEXT NOT NULL,
  dropoff_lat DECIMAL(10, 8) NOT NULL,
  dropoff_lng DECIMAL(11, 8) NOT NULL,
  
  -- Ride details
  status ride_status NOT NULL DEFAULT 'pending',
  distance_km DECIMAL(10, 2),
  duration_minutes INTEGER,
  fare DECIMAL(10, 2) NOT NULL,
  
  -- Timestamps
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  
  -- Cancellation details
  cancelled_by cancellation_by,
  cancellation_reason TEXT,
  
  -- Ratings
  customer_rating DECIMAL(3, 2) CHECK (customer_rating >= 0 AND customer_rating <= 5),
  rider_rating DECIMAL(3, 2) CHECK (rider_rating >= 0 AND rider_rating <= 5),
  customer_review TEXT,
  rider_review TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.rides ENABLE ROW LEVEL SECURITY;

-- Customers can read their own rides
DROP POLICY IF EXISTS rides_read_customer ON public.rides;
CREATE POLICY rides_read_customer ON public.rides
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.id = rides.customer_id
        AND c.user_id = auth.uid()
    )
  );

-- Riders can read their assigned rides
DROP POLICY IF EXISTS rides_read_rider ON public.rides;
CREATE POLICY rides_read_rider ON public.rides
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.riders r
      WHERE r.id = rides.rider_id
        AND r.user_id = auth.uid()
    )
  );

-- Customers can create ride requests
DROP POLICY IF EXISTS rides_insert_customer ON public.rides;
CREATE POLICY rides_insert_customer ON public.rides
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.id = customer_id
        AND c.user_id = auth.uid()
        AND c.is_active = true
    )
    AND status = 'pending'
    AND rider_id IS NULL
  );

-- Customers can update their rides (cancel, rate)
DROP POLICY IF EXISTS rides_update_customer ON public.rides;
CREATE POLICY rides_update_customer ON public.rides
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.id = rides.customer_id
        AND c.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.id = rides.customer_id
        AND c.user_id = auth.uid()
    )
  );

-- Riders can update their assigned rides (accept, start, complete, cancel)
DROP POLICY IF EXISTS rides_update_rider ON public.rides;
CREATE POLICY rides_update_rider ON public.rides
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.riders r
      WHERE r.id = rides.rider_id
        AND r.user_id = auth.uid()
        AND r.status = 'active'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.riders r
      WHERE r.id = rides.rider_id
        AND r.user_id = auth.uid()
        AND r.status = 'active'
    )
  );

-- Stage chairpersons can read rides from their stage
DROP POLICY IF EXISTS rides_read_stage_chair ON public.rides;
CREATE POLICY rides_read_stage_chair ON public.rides
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.committee_members cm
      WHERE cm.user_id = auth.uid()
        AND cm.role = 'stage_chairperson'
        AND cm.region_type = 'stage'
        AND cm.region_id = rides.stage_id
        AND cm.is_active = true
    )
  );

-- Higher-level chairpersons can read rides in their regions
DROP POLICY IF EXISTS rides_read_chairpersons ON public.rides;
CREATE POLICY rides_read_chairpersons ON public.rides
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.committee_members cm
      JOIN public.stages s ON s.id = rides.stage_id
      WHERE cm.user_id = auth.uid()
        AND cm.is_active = true
        AND (
          (cm.role = 'parish_chairperson' AND cm.region_type = 'parish' AND cm.region_id = s.parish_id)
          OR
          (cm.role = 'subcounty_chairperson' AND cm.region_type = 'subcounty' AND EXISTS (
            SELECT 1 FROM public.parishes p WHERE p.id = s.parish_id AND p.subcounty_id = cm.region_id
          ))
          OR
          (cm.role = 'division_chairperson' AND cm.region_type = 'division' AND EXISTS (
            SELECT 1 FROM public.parishes p
            JOIN public.subcounties sc ON sc.id = p.subcounty_id
            WHERE p.id = s.parish_id AND sc.division_id = cm.region_id
          ))
          OR
          (cm.role = 'district_chairperson' AND cm.region_type = 'district' AND EXISTS (
            SELECT 1 FROM public.parishes p
            JOIN public.subcounties sc ON sc.id = p.subcounty_id
            JOIN public.divisions d ON d.id = sc.division_id
            WHERE p.id = s.parish_id AND d.district_id = cm.region_id
          ))
        )
    )
  );

-- Developers can read all rides
DROP POLICY IF EXISTS rides_read_developer ON public.rides;
CREATE POLICY rides_read_developer ON public.rides
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
DROP POLICY IF EXISTS rides_service_role ON public.rides;
CREATE POLICY rides_service_role ON public.rides
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Indexes for performance
CREATE INDEX IF NOT EXISTS rides_customer_id_idx ON public.rides(customer_id);
CREATE INDEX IF NOT EXISTS rides_rider_id_idx ON public.rides(rider_id);
CREATE INDEX IF NOT EXISTS rides_stage_id_idx ON public.rides(stage_id);
CREATE INDEX IF NOT EXISTS rides_status_idx ON public.rides(status);
CREATE INDEX IF NOT EXISTS rides_requested_at_idx ON public.rides(requested_at DESC);
CREATE INDEX IF NOT EXISTS rides_completed_at_idx ON public.rides(completed_at DESC);
CREATE INDEX IF NOT EXISTS rides_pickup_location_idx ON public.rides(pickup_lat, pickup_lng);
CREATE INDEX IF NOT EXISTS rides_dropoff_location_idx ON public.rides(dropoff_lat, dropoff_lng);

COMMIT;
