-- A region can have any number of chairpersons (their power has no limit).
-- Removes the one-active-chair-per-region index and makes the tree relink keep a
-- seat's current parent while that parent is still an active chair of the parent
-- region (so several chairs per region don't flip each other's children).
-- NOTE: the DROP INDEX is a destructive statement; the Supabase MCP tool holds it
-- for confirmation, so run it from the SQL editor if the tool times out.

DROP INDEX IF EXISTS public.mbg_one_active_chair_per_region;

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
             ORDER BY (p.id = cm.parent_chairperson_id) DESC, p.appointed_at DESC
             LIMIT 1) AS tree_parent
      FROM public.mbg_committee_members cm
     WHERE cm.region_type::text <> 'district'
  )
  UPDATE public.mbg_committee_members cm
     SET parent_chairperson_id = d.tree_parent, updated_at = now()
    FROM derived d
   WHERE d.id = cm.id
     AND cm.parent_chairperson_id IS DISTINCT FROM d.tree_parent
     AND EXISTS (SELECT 1 FROM public.mbg_region_parent(cm.region_type::text, cm.region_id));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Restore the Kawempe Subcounty chairperson that was deactivated while the
-- one-chair rule was in force.
UPDATE public.mbg_committee_members SET is_active = true, updated_at = now()
 WHERE id = '7ae37e51-3597-448c-8fd9-10210762fa16' AND role = 'subcounty_chairperson';
