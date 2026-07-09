-- Minimal prerequisite for FIX_ASSIGN_RIDER_ADD_ROLE.sql.
-- Creates ONLY the multi-role plumbing (user_roles column + helper
-- functions). Deliberately does NOT touch mbg_assign_chairperson or
-- mbg_assign_rider — those are defined/fixed elsewhere and redefining
-- mbg_assign_chairperson here previously failed because the live DB's
-- version has a differently-named parameter (target_commission_rate vs
-- commission_rate_param), which Postgres won't let CREATE OR REPLACE
-- rename without an explicit DROP first.

ALTER TABLE public.mbg_users
ADD COLUMN IF NOT EXISTS user_roles text[] DEFAULT ARRAY['customer']::text[];

UPDATE public.mbg_users
SET user_roles = ARRAY[role_type]::text[]
WHERE user_roles IS NULL;

CREATE OR REPLACE FUNCTION public.get_user_roles(target_user_id uuid)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN (
    SELECT user_roles
    FROM public.mbg_users
    WHERE id = target_user_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.add_user_role(
  target_user_id uuid,
  new_role text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_roles text[];
BEGIN
  SELECT user_roles INTO current_roles
  FROM public.mbg_users
  WHERE id = target_user_id;

  IF new_role = ANY(current_roles) THEN
    RETURN true;
  END IF;

  UPDATE public.mbg_users
  SET user_roles = array_append(current_roles, new_role),
      updated_at = NOW()
  WHERE id = target_user_id;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_user_role(
  target_user_id uuid,
  role_to_remove text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.mbg_users
  SET user_roles = array_remove(user_roles, role_to_remove),
      updated_at = NOW()
  WHERE id = target_user_id;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.user_has_role(
  target_user_id uuid,
  role_to_check text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN (
    SELECT role_to_check = ANY(user_roles)
    FROM public.mbg_users
    WHERE id = target_user_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_roles(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_user_role(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_user_role(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_role(uuid, text) TO authenticated;

DO $$
BEGIN
  RAISE NOTICE '✅ Multi-role plumbing ready (user_roles column + get/add/remove/user_has_role). mbg_assign_chairperson was NOT touched.';
END $$;
