-- Storage bucket for real product photo uploads.
--
-- The existing shared Supermartkera schema (public.products.images JSONB)
-- has no upload flow — AddProductModal only accepts a plain image_url text
-- field. This bucket lets a supermarket owner actually upload a photo from
-- MyBodaGuy's product manager; the resulting public URL is written into
-- products.images, so it shows up anywhere else that already reads that
-- column (e.g. lookup_product_by_barcode's `p.images`).
--
-- RLS is already disabled on public.products/public.inventory/public.categories
-- in the live project (see digital-city-era/backend/database/migrations/
-- FIX_PRODUCTS_RLS.sql) — any authenticated client can already write products.
-- This bucket matches that same trust model rather than introducing a new,
-- inconsistent write barrier.

INSERT INTO storage.buckets (id, name, public)
VALUES ('product-photos', 'product-photos', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS mbg_product_photos_public_read ON storage.objects;
CREATE POLICY mbg_product_photos_public_read ON storage.objects
  FOR SELECT
  USING (bucket_id = 'product-photos');

DROP POLICY IF EXISTS mbg_product_photos_authenticated_upload ON storage.objects;
CREATE POLICY mbg_product_photos_authenticated_upload ON storage.objects
  FOR INSERT
  WITH CHECK (bucket_id = 'product-photos' AND auth.role() = 'authenticated');

DROP POLICY IF EXISTS mbg_product_photos_owner_modify ON storage.objects;
CREATE POLICY mbg_product_photos_owner_modify ON storage.objects
  FOR UPDATE
  USING (bucket_id = 'product-photos' AND owner = auth.uid())
  WITH CHECK (bucket_id = 'product-photos' AND owner = auth.uid());

DROP POLICY IF EXISTS mbg_product_photos_owner_delete ON storage.objects;
CREATE POLICY mbg_product_photos_owner_delete ON storage.objects
  FOR DELETE
  USING (bucket_id = 'product-photos' AND owner = auth.uid());

DO $$
BEGIN
  RAISE NOTICE '✅ product-photos storage bucket ready.';
END $$;
