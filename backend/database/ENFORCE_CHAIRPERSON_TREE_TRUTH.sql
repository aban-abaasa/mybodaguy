-- ============================================================================
-- ENFORCE CHAIRPERSON TREE TRUTH
-- ----------------------------------------------------------------------------
-- The geography tables are the single source of truth for the hierarchy:
--   district -> division -> subcounty -> parish -> stage
-- A chairperson's parent is the active chairperson of the PARENT REGION, one
-- level up. This migration:
--   1. adds mbg_region_parent() (tree lookup used everywhere below)
--   2. adds mbg_relink_chairperson_tree() (derives parent_chairperson_id from
--      the tree instead of trusting whoever clicked "assign")
--   3. replaces mbg_assign_chairperson(uuid,...) with a validated version
--   4. replaces get_subordinate_chairpersons() so it covers every assignment
--      the user holds and excludes their own auto-created stage row
--   5. adds mbg_committee_tree_audit view listing every row off the tree
-- Existing rows are NOT deleted or rewritten except for parent links that can
-- be derived from the tree.
-- ============================================================================

-- 1. Tree lookup: parent region of (region_type, region_id) -------------------
CREATE OR REPLACE FUNCTION public.mbg_region_parent(p_type text, p_id uuid)
RETURNS TABLE(parent_type text, parent_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT 'district', d.district_id FROM public.mbg_divisions d    WHERE p_type = 'division'  AND d.id = p_id
  UNION ALL
  SELECT 'division', s.division_id  FROM public.mbg_subcounties s WHERE p_type = 'subcounty' AND s.id = p_id
  UNION ALL
  SELECT 'subcounty', p.subcounty_id FROM public.mbg_parishes p    WHERE p_type = 'parish'    AND p.id = p_id
  UNION ALL
  SELECT 'parish', st.parish_id     FROM public.mbg_stages st      WHERE p_type = 'stage'     AND st.id = p_id;
$$;

-- 2. Derive parent_chairperson_id from the tree --------------------------------
CREATE OR REPLACE FUNCTION public.mbg_relink_chairperson_tree()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH derived AS (
    SELECT cm.id,
           (SELECT p.id
              FROM public.mbg_region_parent(cm.region_type::text, cm.region_id) rp
              JOIN public.mbg_committee_members p
                ON p.region_type::text = rp.parent_type
               AND p.region_id = rp.parent_id
               AND p.is_active = true
               AND p.user_id <> cm.user_id
             ORDER BY p.appointed_at DESC
             LIMIT 1) AS tree_parent
      FROM public.mbg_committee_members cm
     WHERE cm.region_type::text <> 'district'
  )
  UPDATE public.mbg_committee_members cm
     SET parent_chairperson_id = d.tree_parent, updated_at = now()
    FROM derived d
   WHERE d.id = cm.id
     AND cm.parent_chairperson_id IS DISTINCT FROM d.tree_parent
     -- only touch rows whose region really exists in the tree
     AND EXISTS (SELECT 1 FROM public.mbg_region_parent(cm.region_type::text, cm.region_id));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- 3. Validated assignment -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mbg_assign_chairperson(
  target_user_id uuid,
  target_role text,
  target_region_type text,
  target_region_id uuid,
  commission_rate numeric DEFAULT 5.00
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_levels constant text[] := ARRAY['district','division','subcounty','parish','stage'];
  new_committee_member_id UUID;
  typed_role mbg_chairperson_role;
  typed_region mbg_region_type;
  v_is_dev boolean;
  v_parent_type text;
  v_parent_id uuid;
  v_parent_member uuid;
  v_exists boolean;
  user_stage_id UUID;
  rider_exists BOOLEAN;
BEGIN
  typed_role   := target_role::mbg_chairperson_role;
  typed_region := target_region_type::mbg_region_type;

  -- Role must match the level it is assigned at
  IF target_role <> target_region_type || '_chairperson' THEN
    RAISE EXCEPTION 'Role % does not match region type %', target_role, target_region_type;
  END IF;

  -- The region must really exist in the geography tree
  EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I WHERE id = $1)',
    CASE target_region_type
      WHEN 'district'  THEN 'mbg_districts'
      WHEN 'division'  THEN 'mbg_divisions'
      WHEN 'subcounty' THEN 'mbg_subcounties'
      WHEN 'parish'    THEN 'mbg_parishes'
      WHEN 'stage'     THEN 'mbg_stages' END)
    INTO v_exists USING target_region_id;
  IF NOT v_exists THEN
    RAISE EXCEPTION 'Region % (%) does not exist', target_region_id, target_region_type;
  END IF;

  v_is_dev := public.is_mbg_developer();

  -- Resolve parent region and the chairperson sitting on it
  SELECT rp.parent_type, rp.parent_id INTO v_parent_type, v_parent_id
    FROM public.mbg_region_parent(target_region_type, target_region_id) rp;

  IF v_parent_id IS NOT NULL THEN
    SELECT id INTO v_parent_member
      FROM public.mbg_committee_members
     WHERE region_type::text = v_parent_type AND region_id = v_parent_id
       AND is_active = true AND user_id <> target_user_id
     ORDER BY appointed_at DESC LIMIT 1;
  END IF;

  IF NOT v_is_dev THEN
    -- Non-developers may only assign the level directly below a seat they hold
    -- on the PARENT region of the target (no skipping levels, no other branch).
    IF v_parent_id IS NULL THEN
      RAISE EXCEPTION 'Only a developer can assign district chairpersons';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.mbg_committee_members
       WHERE user_id = auth.uid() AND is_active = true
         AND region_type::text = v_parent_type AND region_id = v_parent_id
    ) THEN
      RAISE EXCEPTION 'You can only assign a % chairperson inside a % you chair', target_region_type, v_parent_type;
    END IF;
  END IF;

  UPDATE public.mbg_users SET role_type = 'chairperson', updated_at = NOW() WHERE id = target_user_id;

  INSERT INTO public.mbg_committee_members (
    user_id, role, region_type, region_id, assigned_by,
    parent_chairperson_id, commission_rate, is_active, appointed_at
  ) VALUES (
    target_user_id, typed_role, typed_region, target_region_id,
    auth.uid(), v_parent_member, commission_rate, true, NOW()
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

  -- Seats already waiting below this region now get their true parent
  PERFORM public.mbg_relink_chairperson_tree();

  -- Resolve a stage for the required rider record / stage seat
  IF typed_region = 'stage' THEN
    SELECT id INTO user_stage_id FROM public.mbg_stages WHERE id = target_region_id;
  ELSIF typed_region = 'parish' THEN
    SELECT id INTO user_stage_id FROM public.mbg_stages WHERE parish_id = target_region_id LIMIT 1;
  ELSIF typed_region = 'subcounty' THEN
    SELECT s.id INTO user_stage_id FROM public.mbg_stages s
      JOIN public.mbg_parishes p ON s.parish_id = p.id
     WHERE p.subcounty_id = target_region_id LIMIT 1;
  ELSIF typed_region = 'division' THEN
    SELECT s.id INTO user_stage_id FROM public.mbg_stages s
      JOIN public.mbg_parishes p ON s.parish_id = p.id
      JOIN public.mbg_subcounties sc ON p.subcounty_id = sc.id
     WHERE sc.division_id = target_region_id LIMIT 1;
  ELSIF typed_region = 'district' THEN
    SELECT s.id INTO user_stage_id FROM public.mbg_stages s
      JOIN public.mbg_parishes p ON s.parish_id = p.id
      JOIN public.mbg_subcounties sc ON p.subcounty_id = sc.id
      JOIN public.mbg_divisions d ON sc.division_id = d.id
     WHERE d.district_id = target_region_id LIMIT 1;
  END IF;

  IF user_stage_id IS NULL THEN
    SELECT stage_id INTO user_stage_id FROM public.mbg_riders
     WHERE user_id = target_user_id AND status = 'active' LIMIT 1;
  END IF;

  -- Every chairperson also holds a stage seat; its parent is whoever chairs
  -- that stage's PARISH (set by the relink below), never the assigner.
  IF typed_role <> 'stage_chairperson'::mbg_chairperson_role AND user_stage_id IS NOT NULL THEN
    INSERT INTO public.mbg_committee_members (
      user_id, role, region_type, region_id, assigned_by,
      commission_rate, is_active, appointed_at
    ) VALUES (
      target_user_id, 'stage_chairperson'::mbg_chairperson_role,
      'stage'::mbg_region_type, user_stage_id, auth.uid(),
      commission_rate, true, NOW()
    )
    ON CONFLICT (user_id, region_type, region_id)
    DO UPDATE SET is_active = true, updated_at = NOW();
    PERFORM public.mbg_relink_chairperson_tree();
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.mbg_riders WHERE user_id = target_user_id) INTO rider_exists;
  IF NOT rider_exists THEN
    IF user_stage_id IS NOT NULL THEN
      INSERT INTO public.mbg_riders (user_id, stage_id, vehicle_type, plate_number, license_number, status)
      VALUES (target_user_id, user_stage_id, 'motorcycle',
        'PENDING-' || replace(target_user_id::text, '-', ''),
        'PENDING-' || replace(target_user_id::text, '-', ''), 'active');
      rider_exists := true;
    ELSE
      RAISE NOTICE 'mbg_assign_chairperson: could not auto-create rider record for % - no stage resolvable for region % / %',
        target_user_id, target_region_type, target_region_id;
    END IF;
  END IF;

  PERFORM public.add_user_role(target_user_id, 'chairperson');
  IF rider_exists THEN
    PERFORM public.add_user_role(target_user_id, 'rider');
  END IF;

  RETURN new_committee_member_id;
END;
$function$;

-- 4. Subordinates = direct children of ANY seat the user holds ------------------
CREATE OR REPLACE FUNCTION public.get_subordinate_chairpersons(chairperson_user_id uuid)
RETURNS TABLE(id uuid, user_id uuid, full_name text, email text, phone text,
  role mbg_chairperson_role, region_type mbg_region_type, region_id uuid,
  region_name text, commission_rate numeric, is_active boolean, appointed_at timestamp with time zone)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    cm.id, cm.user_id,
    COALESCE(up.full_name, u.email), u.email, COALESCE(up.phone, ''),
    cm.role, cm.region_type, cm.region_id,
    CASE cm.region_type
      WHEN 'district'::mbg_region_type  THEN (SELECT d.name  FROM public.mbg_districts  d  WHERE d.id  = cm.region_id)
      WHEN 'division'::mbg_region_type  THEN (SELECT dv.name FROM public.mbg_divisions  dv WHERE dv.id = cm.region_id)
      WHEN 'subcounty'::mbg_region_type THEN (SELECT sc.name FROM public.mbg_subcounties sc WHERE sc.id = cm.region_id)
      WHEN 'parish'::mbg_region_type    THEN (SELECT p.name  FROM public.mbg_parishes   p  WHERE p.id  = cm.region_id)
      WHEN 'stage'::mbg_region_type     THEN (SELECT s.name  FROM public.mbg_stages     s  WHERE s.id  = cm.region_id)
    END,
    COALESCE(cm.commission_rate, 5.00), cm.is_active, cm.appointed_at
  FROM public.mbg_committee_members cm
  JOIN public.mbg_committee_members parent
    ON parent.id = cm.parent_chairperson_id
   AND parent.user_id = chairperson_user_id
   AND parent.is_active = true
  JOIN public.mbg_users u ON u.id = cm.user_id
  LEFT JOIN public.mbg_user_profiles up ON up.user_id = cm.user_id
  WHERE cm.is_active = true
    AND cm.user_id <> chairperson_user_id
  ORDER BY cm.appointed_at DESC;
END;
$function$;

-- 5. Audit: every active row that is off the tree --------------------------------
CREATE OR REPLACE VIEW public.mbg_committee_tree_audit AS
SELECT cm.id, cm.user_id, cm.role, cm.region_type, cm.region_id, cm.parent_chairperson_id,
  CASE
    WHEN cm.role::text <> cm.region_type::text || '_chairperson' THEN 'role does not match region type'
    WHEN NOT EXISTS (
      SELECT 1 FROM (
        SELECT id, 'district' t FROM public.mbg_districts UNION ALL
        SELECT id, 'division'  FROM public.mbg_divisions  UNION ALL
        SELECT id, 'subcounty' FROM public.mbg_subcounties UNION ALL
        SELECT id, 'parish'    FROM public.mbg_parishes   UNION ALL
        SELECT id, 'stage'     FROM public.mbg_stages) r
      WHERE r.id = cm.region_id AND r.t = cm.region_type::text) THEN 'region does not exist at that level'
    WHEN cm.region_type::text <> 'district' AND cm.parent_chairperson_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.mbg_committee_members p
        JOIN public.mbg_region_parent(cm.region_type::text, cm.region_id) rp
          ON rp.parent_type = p.region_type::text AND rp.parent_id = p.region_id
       WHERE p.id = cm.parent_chairperson_id) THEN 'parent is not the chair of the parent region'
    ELSE NULL
  END AS violation
FROM public.mbg_committee_members cm
WHERE cm.is_active = true;

ALTER VIEW public.mbg_committee_tree_audit SET (security_invoker = true);

GRANT EXECUTE ON FUNCTION public.mbg_region_parent(text, uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.mbg_relink_chairperson_tree() FROM PUBLIC, anon, authenticated;

-- 6. One active chairperson per region above stage level ---------------------
-- (stages may legitimately have several chairpersons, so they are excluded)
CREATE UNIQUE INDEX IF NOT EXISTS mbg_one_active_chair_per_region
  ON public.mbg_committee_members (region_type, region_id)
  WHERE is_active AND region_type <> 'stage';
