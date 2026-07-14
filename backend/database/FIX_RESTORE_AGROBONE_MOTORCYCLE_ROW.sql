-- ============================================================================
-- ONE-OFF DATA REPAIR: agrobone0@gmail.com is a chairperson whose mbg_riders
-- row was auto-created as 'motorcycle' (FIX_ASSIGN_CHAIRPERSON_SYNC_USER_ROLES.sql
-- / FIX_ALL_CHAIRPERSONS_ADD_ROLES.sql's "every chairperson must also be a
-- rider" auto-create), then had its vehicle_type overwritten to 'car' by the
-- pre-multi-vehicle version of mbg_review_operator_application (which used
-- ON CONFLICT (user_id) DO UPDATE — upgrade-in-place — before
-- ADD_MULTI_VEHICLE_SUPPORT.sql replaced it with ON CONFLICT (user_id,
-- vehicle_type)). That overwrite already happened and can't be undone by
-- re-running the migration; this restores the missing motorcycle row
-- directly, the same way the chairperson auto-create mechanism would have,
-- reusing the stage_id already on their car row.
--
-- Not a code fix — run once in the Supabase SQL editor for this account.
-- user_roles already contains 'rider', so no role sync is needed here.
-- ============================================================================

INSERT INTO public.mbg_riders (
  user_id, stage_id, vehicle_type, plate_number, license_number, status, approved_by, approved_at
)
SELECT r.user_id, r.stage_id, 'motorcycle',
       'PENDING-' || replace(r.user_id::text, '-', ''),
       'PENDING-' || replace(r.user_id::text, '-', ''),
       'active', r.approved_by, now()
FROM public.mbg_riders r
JOIN public.mbg_users mu ON mu.id = r.user_id
WHERE mu.email = 'agrobone0@gmail.com' AND r.vehicle_type = 'car'
ON CONFLICT (user_id, vehicle_type) DO NOTHING;
