-- ==============================================
-- FIX: mbg_assign_chairperson never synced user_roles,
--      and never auto-assigned the required rider role
-- ==============================================
-- Root cause #1: the live mbg_assign_chairperson(UUID, TEXT, TEXT, UUID, DECIMAL)
-- overload (the one the frontend actually calls, from
-- chairpersonService.ts -> supabase.rpc('mbg_assign_chairperson', { target_user_id, ... }))
-- only updated mbg_users.role_type and mbg_committee_members. It never
-- appended 'chairperson' to mbg_users.user_roles.
--
-- UnifiedDashboard.tsx's role selector reads roles exclusively from
-- get_user_roles() -> mbg_users.user_roles, and only renders the role
-- selector tabs when that array has more than one entry. So newly
-- assigned chairpersons never saw the selector, while existing
-- chairpersons worked only because of a one-time manual backfill run in
-- FIX_ALL_CHAIRPERSONS_ADD_ROLES.sql on 2026-06-24, which fixed the
-- wrong function overload (the dead target_user_email-named one) going
-- forward.
--
-- Root cause #2: every chairperson must also be a rider (business rule),
-- and that auto-assignment logic already existed in
-- CHAIRPERSON_AUTO_RIDER_ASSIGNMENT.sql -- but again, it was written
-- against the dead target_user_email-named overload, so it never ran
-- for real assignments made through the app.
--
-- This migration folds both fixes into the ONE live overload:
--   1. Resolves a stage for the assigned region (walking down the
--      district/division/subcounty/parish/stage hierarchy, same logic
--      as CHAIRPERSON_AUTO_RIDER_ASSIGNMENT.sql), falling back to an
--      existing rider record's stage if the region has none yet.
--   2. Auto-creates an mbg_riders record for the chairperson if they
--      don't already have one and a stage was resolved.
--   3. Syncs mbg_users.user_roles with 'chairperson' and (if a rider
--      record exists/was created) 'rider', so the frontend role
--      selector picks up both roles immediately.
--   4. Backfills existing active chairpersons who fell through the gap.
-- ==============================================

BEGIN;

DROP FUNCTION IF EXISTS public.mbg_assign_chairperson(UUID, TEXT, TEXT, UUID, DECIMAL) CASCADE;

CREATE FUNCTION public.mbg_assign_chairperson(
  target_user_id UUID,
  target_role TEXT,
  target_region_type TEXT,
  target_region_id UUID,
  commission_rate DECIMAL DEFAULT 5.00
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_committee_member_id UUID;
  assigner_committee_id UUID;
  typed_role mbg_chairperson_role;
  typed_region mbg_region_type;
  user_stage_id UUID;
  rider_exists BOOLEAN;
BEGIN
  typed_role := target_role::mbg_chairperson_role;
  typed_region := target_region_type::mbg_region_type;

  -- Get assigner's committee_member id
  SELECT id INTO assigner_committee_id
  FROM public.mbg_committee_members
  WHERE user_id = auth.uid() AND is_active = true
  LIMIT 1;

  -- Update user to chairperson
  UPDATE public.mbg_users
  SET role_type = 'chairperson', updated_at = NOW()
  WHERE id = target_user_id;

  -- Insert PRIMARY role
  INSERT INTO public.mbg_committee_members (
    user_id, role, region_type, region_id, assigned_by,
    parent_chairperson_id, commission_rate, is_active, appointed_at
  )
  VALUES (
    target_user_id, typed_role, typed_region, target_region_id,
    auth.uid(), assigner_committee_id, commission_rate, true, NOW()
  )
  ON CONFLICT (user_id, region_type, region_id)
  DO UPDATE SET
    role = EXCLUDED.role,
    assigned_by = EXCLUDED.assigned_by,
    parent_chairperson_id = EXCLUDED.parent_chairperson_id,
    commission_rate = EXCLUDED.commission_rate,
    is_active = true,
    updated_at = NOW()
  RETURNING id INTO new_committee_member_id;

  -- Resolve a stage for this chairperson (needed for both the stage
  -- chairperson role and the required rider record).
  IF typed_region = 'stage'::mbg_region_type THEN
    -- region_id isn't FK-enforced against mbg_stages, so verify it
    -- actually exists rather than trusting it blindly.
    SELECT id INTO user_stage_id FROM public.mbg_stages WHERE id = target_region_id;
  ELSIF typed_region = 'parish'::mbg_region_type THEN
    SELECT id INTO user_stage_id
    FROM public.mbg_stages
    WHERE parish_id = target_region_id
    LIMIT 1;
  ELSIF typed_region = 'subcounty'::mbg_region_type THEN
    SELECT s.id INTO user_stage_id
    FROM public.mbg_stages s
    JOIN public.mbg_parishes p ON s.parish_id = p.id
    WHERE p.subcounty_id = target_region_id
    LIMIT 1;
  ELSIF typed_region = 'division'::mbg_region_type THEN
    SELECT s.id INTO user_stage_id
    FROM public.mbg_stages s
    JOIN public.mbg_parishes p ON s.parish_id = p.id
    JOIN public.mbg_subcounties sc ON p.subcounty_id = sc.id
    WHERE sc.division_id = target_region_id
    LIMIT 1;
  ELSIF typed_region = 'district'::mbg_region_type THEN
    SELECT s.id INTO user_stage_id
    FROM public.mbg_stages s
    JOIN public.mbg_parishes p ON s.parish_id = p.id
    JOIN public.mbg_subcounties sc ON p.subcounty_id = sc.id
    JOIN public.mbg_divisions d ON sc.division_id = d.id
    WHERE d.district_id = target_region_id
    LIMIT 1;
  END IF;

  -- Fall back to their existing rider's stage if the assigned region
  -- doesn't resolve to one yet (e.g. no stages created there).
  IF user_stage_id IS NULL THEN
    SELECT stage_id INTO user_stage_id
    FROM public.mbg_riders
    WHERE user_id = target_user_id AND status = 'active'
    LIMIT 1;
  END IF;

  -- Add STAGE chairperson role (if not already stage chairperson and a stage was resolved)
  IF typed_role != 'stage_chairperson'::mbg_chairperson_role AND user_stage_id IS NOT NULL THEN
    INSERT INTO public.mbg_committee_members (
      user_id, role, region_type, region_id, assigned_by,
      parent_chairperson_id, commission_rate, is_active, appointed_at
    )
    VALUES (
      target_user_id, 'stage_chairperson'::mbg_chairperson_role,
      'stage'::mbg_region_type, user_stage_id, auth.uid(),
      assigner_committee_id, commission_rate, true, NOW()
    )
    ON CONFLICT (user_id, region_type, region_id)
    DO UPDATE SET is_active = true, updated_at = NOW();
  END IF;

  -- Every chairperson must also be a rider: auto-create the rider
  -- record if they don't already have one and a stage was resolved.
  SELECT EXISTS(
    SELECT 1 FROM public.mbg_riders WHERE user_id = target_user_id
  ) INTO rider_exists;

  IF NOT rider_exists THEN
    IF user_stage_id IS NOT NULL THEN
      INSERT INTO public.mbg_riders (
        user_id, stage_id, vehicle_type, plate_number, license_number, status
      )
      VALUES (
        target_user_id, user_stage_id, 'motorcycle',
        'PENDING-' || replace(target_user_id::text, '-', ''),
        'PENDING-' || replace(target_user_id::text, '-', ''),
        'active'
      );
      rider_exists := true;
    ELSE
      RAISE NOTICE 'mbg_assign_chairperson: could not auto-create rider record for % - no stage resolvable for region % / %',
        target_user_id, target_region_type, target_region_id;
    END IF;
  END IF;

  -- Sync mbg_users.user_roles so the frontend role selector
  -- (UnifiedDashboard.tsx -> get_user_roles) picks up the new roles.
  PERFORM public.add_user_role(target_user_id, 'chairperson');
  IF rider_exists THEN
    PERFORM public.add_user_role(target_user_id, 'rider');
  END IF;

  RETURN new_committee_member_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mbg_assign_chairperson(UUID, TEXT, TEXT, UUID, DECIMAL) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_assign_chairperson(UUID, TEXT, TEXT, UUID, DECIMAL) TO service_role;

-- Backfill: anyone with an active committee assignment who fell through
-- the gap (assigned after the last manual backfill, before this fix),
-- including giving them a rider record if they don't already have one.
DO $$
DECLARE
  chairperson RECORD;
  backfill_stage_id UUID;
  has_rider BOOLEAN;
BEGIN
  FOR chairperson IN
    SELECT DISTINCT cm.user_id, cm.region_type, cm.region_id
    FROM public.mbg_committee_members cm
    WHERE cm.is_active = true
  LOOP
    backfill_stage_id := NULL;

    SELECT EXISTS(
      SELECT 1 FROM public.mbg_riders WHERE user_id = chairperson.user_id
    ) INTO has_rider;

    IF NOT has_rider THEN
      IF chairperson.region_type = 'stage' THEN
        -- region_id isn't FK-enforced against mbg_stages, so verify it
        -- actually exists rather than trusting it blindly.
        SELECT id INTO backfill_stage_id FROM public.mbg_stages WHERE id = chairperson.region_id;
      ELSIF chairperson.region_type = 'parish' THEN
        SELECT id INTO backfill_stage_id
        FROM public.mbg_stages WHERE parish_id = chairperson.region_id LIMIT 1;
      ELSIF chairperson.region_type = 'subcounty' THEN
        SELECT s.id INTO backfill_stage_id
        FROM public.mbg_stages s
        JOIN public.mbg_parishes p ON s.parish_id = p.id
        WHERE p.subcounty_id = chairperson.region_id LIMIT 1;
      ELSIF chairperson.region_type = 'division' THEN
        SELECT s.id INTO backfill_stage_id
        FROM public.mbg_stages s
        JOIN public.mbg_parishes p ON s.parish_id = p.id
        JOIN public.mbg_subcounties sc ON p.subcounty_id = sc.id
        WHERE sc.division_id = chairperson.region_id LIMIT 1;
      ELSIF chairperson.region_type = 'district' THEN
        SELECT s.id INTO backfill_stage_id
        FROM public.mbg_stages s
        JOIN public.mbg_parishes p ON s.parish_id = p.id
        JOIN public.mbg_subcounties sc ON p.subcounty_id = sc.id
        JOIN public.mbg_divisions d ON sc.division_id = d.id
        WHERE d.district_id = chairperson.region_id LIMIT 1;
      END IF;

      IF backfill_stage_id IS NOT NULL THEN
        INSERT INTO public.mbg_riders (
          user_id, stage_id, vehicle_type, plate_number, license_number, status
        )
        VALUES (
          chairperson.user_id, backfill_stage_id, 'motorcycle',
          'PENDING-' || replace(chairperson.user_id::text, '-', ''),
          'PENDING-' || replace(chairperson.user_id::text, '-', ''),
          'active'
        );
        has_rider := true;
      END IF;
    END IF;

    PERFORM public.add_user_role(chairperson.user_id, 'chairperson');
    IF has_rider THEN
      PERFORM public.add_user_role(chairperson.user_id, 'rider');
    END IF;
  END LOOP;
END $$;

COMMIT;

-- Show result
SELECT
  u.id,
  u.role_type,
  u.user_roles,
  EXISTS(SELECT 1 FROM public.mbg_riders r WHERE r.user_id = u.id) AS has_rider_record
FROM public.mbg_users u
JOIN public.mbg_committee_members cm ON cm.user_id = u.id AND cm.is_active = true
GROUP BY u.id, u.role_type, u.user_roles;
