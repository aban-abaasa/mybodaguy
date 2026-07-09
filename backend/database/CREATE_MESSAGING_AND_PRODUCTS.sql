-- In-app chat between a ride's customer and rider.
--
-- Voice/video calling needs NO new tables — it uses ephemeral Supabase
-- Realtime broadcast channels (same pattern as ICAN's LiveBoardroom), scoped
-- by ride id, so there is nothing to persist for signaling.
--
-- NOTE on products: MyBodaGuy shares its Supabase project with digital-city-era
-- ("Supermartkera"), which already has a real product/inventory/branding
-- system (public.products, public.inventory, public.categories,
-- public.supermarkets.owner_user_id, public.supermarkets.background_image_url —
-- see digital-city-era/backend/database/migrations/CREATE_PRODUCTS_INVENTORY_TABLES.sql
-- and .../seeds/ADD_SUPERMARKET_BRANDING.sql). MyBodaGuy's product picker and
-- supermarket product manager read/write those tables directly instead of a
-- duplicate MyBodaGuy-only table. See CREATE_PRODUCT_PHOTOS_BUCKET.sql for the
-- one genuinely new piece: a Storage bucket for photo uploads (the existing
-- system only had a plain image_url text field, no upload flow).

CREATE TABLE IF NOT EXISTS public.mbg_ride_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID NOT NULL REFERENCES public.mbg_rides(id) ON DELETE CASCADE,
  sender_user_id UUID NOT NULL REFERENCES public.mbg_users(id) ON DELETE CASCADE,
  message TEXT NOT NULL CHECK (char_length(message) BETWEEN 1 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.mbg_ride_messages ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS mbg_ride_messages_ride_id_idx ON public.mbg_ride_messages(ride_id, created_at);

DROP POLICY IF EXISTS mbg_ride_messages_read_participants ON public.mbg_ride_messages;
CREATE POLICY mbg_ride_messages_read_participants ON public.mbg_ride_messages
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.mbg_rides rd
      LEFT JOIN public.mbg_customers c ON c.id = rd.customer_id
      LEFT JOIN public.mbg_riders   r ON r.id = rd.rider_id
      WHERE rd.id = mbg_ride_messages.ride_id
        AND (c.user_id = auth.uid() OR r.user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS mbg_ride_messages_insert_participants ON public.mbg_ride_messages;
CREATE POLICY mbg_ride_messages_insert_participants ON public.mbg_ride_messages
  FOR INSERT
  WITH CHECK (
    sender_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.mbg_rides rd
      LEFT JOIN public.mbg_customers c ON c.id = rd.customer_id
      LEFT JOIN public.mbg_riders   r ON r.id = rd.rider_id
      WHERE rd.id = mbg_ride_messages.ride_id
        AND rd.status IN ('accepted', 'in_progress')
        AND (c.user_id = auth.uid() OR r.user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS mbg_ride_messages_service_role ON public.mbg_ride_messages;
CREATE POLICY mbg_ride_messages_service_role ON public.mbg_ride_messages
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

ALTER PUBLICATION supabase_realtime ADD TABLE public.mbg_ride_messages;

DO $$
BEGIN
  RAISE NOTICE '✅ mbg_ride_messages ready. Products/branding use the existing shared schema — see CREATE_PRODUCT_PHOTOS_BUCKET.sql for the photo-upload bucket.';
END $$;
