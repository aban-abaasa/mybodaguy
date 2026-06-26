-- =====================================================================
-- AUTO-CASCADE CHAIRPERSON ROLES
-- When a chairperson is assigned at any level, they automatically
-- receive committee_member records for every level below them.
--
-- Hierarchy (top → bottom):
--   district_chairperson
--   division_chairperson
--   subcounty_chairperson
--   parish_chairperson
--   stage_chairperson
--
-- Run this ONCE in Supabase SQL Editor.
-- =====================================================================

BEGIN;

-- ── Trigger function ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.cascade_chairperson_roles()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  lvls TEXT[] := ARRAY[
    'district_chairperson',
    'division_chairperson',
    'subcounty_chairperson',
    'parish_chairperson',
    'stage_chairperson'
  ];
  rts TEXT[] := ARRAY[
    'district',
    'division',
    'subcounty',
    'parish',
    'stage'
  ];
  idx INT := 0;
  i   INT;
BEGIN
  -- Guard: skip if we are already inside a cascade (prevents recursion)
  IF current_setting('mbg.cascading_chairs', true) = '1' THEN
    RETURN NEW;
  END IF;

  -- Locate the inserted role in the hierarchy
  FOR i IN 1..5 LOOP
    IF lvls[i] = NEW.role::TEXT THEN
      idx := i;
      EXIT;
    END IF;
  END LOOP;

  -- Nothing to do if role not found or already the lowest level
  IF idx = 0 OR idx = 5 THEN
    RETURN NEW;
  END IF;

  -- Set guard so recursive trigger calls return early
  PERFORM set_config('mbg.cascading_chairs', '1', true);

  -- Insert a record for every level below the assigned one
  FOR i IN (idx + 1)..5 LOOP
    INSERT INTO public.mbg_committee_members (
      user_id,
      role,
      region_type,
      region_id,
      assigned_by,
      parent_chairperson_id,
      is_active
    ) VALUES (
      NEW.user_id,
      lvls[i]::chairperson_role,
      rts[i]::region_type,
      NEW.region_id,      -- inherit the same region_id from the top assignment
      NEW.assigned_by,
      NEW.id,             -- parent is the record that triggered this cascade
      true
    )
    ON CONFLICT (user_id, region_type, region_id) DO UPDATE SET
      role                  = EXCLUDED.role,
      parent_chairperson_id = EXCLUDED.parent_chairperson_id,
      is_active             = true,
      updated_at            = NOW();
  END LOOP;

  RETURN NEW;
END;
$$;

-- ── Attach trigger ────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS auto_cascade_chairperson_roles ON public.mbg_committee_members;

CREATE TRIGGER auto_cascade_chairperson_roles
  AFTER INSERT ON public.mbg_committee_members
  FOR EACH ROW EXECUTE FUNCTION public.cascade_chairperson_roles();

-- ── Backfill existing chairpersons ────────────────────────────────────
-- Gives all currently-assigned chairpersons their lower-level records.

DO $$
DECLARE
  r    RECORD;
  lvls TEXT[] := ARRAY['district_chairperson','division_chairperson','subcounty_chairperson','parish_chairperson','stage_chairperson'];
  rts  TEXT[] := ARRAY['district','division','subcounty','parish','stage'];
  idx  INT;
  i    INT;
BEGIN
  FOR r IN
    SELECT id, user_id, role, region_id, assigned_by
    FROM   public.mbg_committee_members
    WHERE  is_active = true
    ORDER  BY appointed_at ASC   -- process parents before children
  LOOP
    idx := 0;
    FOR i IN 1..5 LOOP
      IF lvls[i] = r.role::TEXT THEN idx := i; EXIT; END IF;
    END LOOP;

    IF idx > 0 AND idx < 5 THEN
      FOR i IN (idx + 1)..5 LOOP
        INSERT INTO public.mbg_committee_members (
          user_id, role, region_type, region_id,
          assigned_by, parent_chairperson_id, is_active
        ) VALUES (
          r.user_id,
          lvls[i]::chairperson_role,
          rts[i]::region_type,
          r.region_id,
          r.assigned_by,
          r.id,
          true
        )
        ON CONFLICT (user_id, region_type, region_id) DO UPDATE SET
          role      = EXCLUDED.role,
          is_active = true,
          updated_at = NOW();
      END LOOP;
    END IF;
  END LOOP;
END;
$$;

COMMIT;
