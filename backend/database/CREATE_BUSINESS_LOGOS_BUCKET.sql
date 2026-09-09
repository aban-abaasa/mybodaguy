-- Storage bucket for Transport Company / Security Escort business logo
-- uploads. Mirrors CREATE_AVATARS_BUCKET.sql's shape, but keyed by
-- business_profile_id (not auth.uid()) since a business logo is uploaded
-- by whoever administers that business, not by the file's own "owner".
-- Files live under `<business_profile_id>/logo-<timestamp>.<ext>`. The
-- resulting public URL is written to business_profiles.avatar_url via
-- mbg_register_business (CREATE_BODAGOERA_BUSINESS_CATEGORIES_AND_
-- REGISTRATION.sql).

INSERT INTO storage.buckets (id, name, public)
VALUES ('business-logos', 'business-logos', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS mbg_business_logos_public_read ON storage.objects;
CREATE POLICY mbg_business_logos_public_read ON storage.objects
  FOR SELECT
  USING (bucket_id = 'business-logos');

DROP POLICY IF EXISTS mbg_business_logos_admin_upload ON storage.objects;
CREATE POLICY mbg_business_logos_admin_upload ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'business-logos'
    AND public.ican_business_admin(((storage.foldername(name))[1])::uuid)
  );

DROP POLICY IF EXISTS mbg_business_logos_admin_modify ON storage.objects;
CREATE POLICY mbg_business_logos_admin_modify ON storage.objects
  FOR UPDATE
  USING (bucket_id = 'business-logos' AND public.ican_business_admin(((storage.foldername(name))[1])::uuid))
  WITH CHECK (bucket_id = 'business-logos' AND public.ican_business_admin(((storage.foldername(name))[1])::uuid));

DROP POLICY IF EXISTS mbg_business_logos_admin_delete ON storage.objects;
CREATE POLICY mbg_business_logos_admin_delete ON storage.objects
  FOR DELETE
  USING (bucket_id = 'business-logos' AND public.ican_business_admin(((storage.foldername(name))[1])::uuid));

DO $$
BEGIN
  RAISE NOTICE '✅ business-logos storage bucket ready.';
END $$;
