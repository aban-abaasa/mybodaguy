-- Storage bucket for profile picture uploads.
--
-- Backs the avatar upload added to ProfileModal.tsx / avatarService.ts.
-- Files are stored under `<user_id>/avatar-<timestamp>.<ext>` so the RLS
-- policies below can key ownership off the first path segment, following
-- the same pattern as CREATE_PRODUCT_PHOTOS_BUCKET.sql. The resulting
-- public URL is written to mbg_user_profiles.avatar_url.

INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS mbg_avatars_public_read ON storage.objects;
CREATE POLICY mbg_avatars_public_read ON storage.objects
  FOR SELECT
  USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS mbg_avatars_owner_upload ON storage.objects;
CREATE POLICY mbg_avatars_owner_upload ON storage.objects
  FOR INSERT
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS mbg_avatars_owner_modify ON storage.objects;
CREATE POLICY mbg_avatars_owner_modify ON storage.objects
  FOR UPDATE
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS mbg_avatars_owner_delete ON storage.objects;
CREATE POLICY mbg_avatars_owner_delete ON storage.objects
  FOR DELETE
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

DO $$
BEGIN
  RAISE NOTICE '✅ avatars storage bucket ready.';
END $$;
