-- Fix: mbg_assign_rider() was only setting mbg_users.role_type = 'rider',
-- but never appending 'rider' to the mbg_users.user_roles[] array.
-- UnifiedDashboard's role switcher reads user_roles via get_user_roles(),
-- so newly-assigned riders never saw a role choice after being assigned.
--
-- This redefines mbg_assign_rider with the SAME signature the frontend
-- actually calls (see frontend/src/mybodaguy/services/riderService.ts)
-- and adds a call to add_user_role() so the rider role is appended to
-- the multi-role array, alongside whatever roles the user already has.
--
-- NOTE: An older, unused overload of mbg_assign_rider (with
-- insurance_number/insurance_expiry params from ENABLE_MULTI_ROLE_SYSTEM.sql)
-- may also exist in the DB. It's never called by the frontend, but its
-- presence makes unqualified GRANT/DROP on the function name ambiguous,
-- so we drop it explicitly below.
DROP FUNCTION IF EXISTS public.mbg_assign_rider(text, uuid, text, text, text, date, text, date);

CREATE OR REPLACE FUNCTION public.mbg_assign_rider(
  target_user_email TEXT,
  target_stage_id UUID,
  vehicle_type mbg_vehicle_type,
  plate_number TEXT,
  license_number TEXT,
  license_expiry DATE DEFAULT NULL,
  vehicle_model TEXT DEFAULT NULL,
  vehicle_year INTEGER DEFAULT NULL,
  vehicle_color TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  target_user_id UUID;
  stage_chairperson_id UUID;
  new_rider_id UUID;
BEGIN
  -- Verify the caller is a stage chairperson for this stage
  SELECT cm.id INTO stage_chairperson_id
  FROM public.mbg_committee_members cm
  WHERE cm.user_id = auth.uid()
    AND cm.role = 'stage_chairperson'
    AND cm.region_type = 'stage'
    AND cm.region_id = target_stage_id
    AND cm.is_active = true
  LIMIT 1;

  IF stage_chairperson_id IS NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.mbg_users
      WHERE id = auth.uid()
        AND role_type = 'developer'
        AND is_active = true
    ) THEN
      RETURN json_build_object(
        'success', false,
        'error', 'You are not authorized to assign riders to this stage'
      );
    END IF;
  END IF;

  -- Get or create user from auth by email
  SELECT u.id INTO target_user_id
  FROM public.mbg_users u
  WHERE u.email = target_user_email
  LIMIT 1;

  IF target_user_id IS NULL THEN
    SELECT au.id INTO target_user_id
    FROM auth.users au
    WHERE au.email = target_user_email
    LIMIT 1;

    IF target_user_id IS NULL THEN
      RETURN json_build_object(
        'success', false,
        'error', 'User not found with email: ' || target_user_email
      );
    END IF;

    INSERT INTO public.mbg_users (id, email, role_type, is_active)
    VALUES (target_user_id, target_user_email, 'rider', true)
    ON CONFLICT (id) DO UPDATE SET
      role_type = 'rider',
      updated_at = NOW();
  ELSE
    UPDATE public.mbg_users
    SET role_type = 'rider',
        updated_at = NOW()
    WHERE id = target_user_id;
  END IF;

  -- Ensure 'rider' is present in the multi-role array so the role
  -- switcher (UnifiedDashboard) picks it up on next login.
  PERFORM public.add_user_role(target_user_id, 'rider');

  IF EXISTS (SELECT 1 FROM public.mbg_riders WHERE mbg_riders.plate_number = mbg_assign_rider.plate_number) THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Plate number already registered: ' || plate_number
    );
  END IF;

  INSERT INTO public.mbg_riders (
    user_id, stage_id, vehicle_type, plate_number, license_number,
    license_expiry, vehicle_model, vehicle_year, vehicle_color,
    status, approved_by, approved_at
  )
  VALUES (
    target_user_id, target_stage_id, vehicle_type, plate_number, license_number,
    license_expiry, vehicle_model, vehicle_year, vehicle_color,
    'active', auth.uid(), NOW()
  )
  ON CONFLICT (user_id)
  DO UPDATE SET
    stage_id = EXCLUDED.stage_id,
    vehicle_type = EXCLUDED.vehicle_type,
    plate_number = EXCLUDED.plate_number,
    license_number = EXCLUDED.license_number,
    license_expiry = EXCLUDED.license_expiry,
    vehicle_model = EXCLUDED.vehicle_model,
    vehicle_year = EXCLUDED.vehicle_year,
    vehicle_color = EXCLUDED.vehicle_color,
    status = 'active',
    approved_by = auth.uid(),
    approved_at = NOW(),
    updated_at = NOW()
  RETURNING id INTO new_rider_id;

  RETURN json_build_object(
    'success', true,
    'rider_id', new_rider_id,
    'message', 'Rider assigned successfully'
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object(
      'success', false,
      'error', SQLERRM
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.mbg_assign_rider(
  TEXT, UUID, mbg_vehicle_type, TEXT, TEXT, DATE, TEXT, INTEGER, TEXT
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_assign_rider(
  TEXT, UUID, mbg_vehicle_type, TEXT, TEXT, DATE, TEXT, INTEGER, TEXT
) TO service_role;

-- Backfill: add 'rider' to user_roles for any existing rider whose array
-- doesn't already contain it (covers riders assigned before this fix).
UPDATE public.mbg_users u
SET user_roles = array_append(COALESCE(u.user_roles, ARRAY['customer']::text[]), 'rider'),
    updated_at = NOW()
FROM public.mbg_riders r
WHERE r.user_id = u.id
  AND NOT ('rider' = ANY(COALESCE(u.user_roles, ARRAY[]::text[])));

DO $$
BEGIN
  RAISE NOTICE '✅ mbg_assign_rider now updates user_roles[] — riders will see the role switcher after assignment.';
END $$;
