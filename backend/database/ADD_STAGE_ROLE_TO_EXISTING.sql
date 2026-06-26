-- ==============================================
-- ADD STAGE ROLE TO EXISTING CHAIRPERSONS
-- ==============================================
-- Retroactively add stage chairperson role to all existing chairpersons
-- who don't already have one

BEGIN;

-- For each non-stage chairperson, add a stage role
DO $$
DECLARE
  chairperson_record RECORD;
  stage_id UUID;
BEGIN
  -- Loop through all active chairpersons who are NOT stage chairpersons
  FOR chairperson_record IN
    SELECT DISTINCT 
      cm.user_id,
      cm.region_type,
      cm.region_id,
      cm.assigned_by,
      cm.parent_chairperson_id,
      cm.commission_rate
    FROM mbg_committee_members cm
    WHERE cm.role != 'stage_chairperson'::mbg_chairperson_role
      AND cm.is_active = true
      -- Only if they don't already have a stage role
      AND NOT EXISTS (
        SELECT 1 FROM mbg_committee_members cm2
        WHERE cm2.user_id = cm.user_id
          AND cm2.role = 'stage_chairperson'::mbg_chairperson_role
          AND cm2.is_active = true
      )
  LOOP
    stage_id := NULL;
    
    -- Find a stage in their region
    CASE chairperson_record.region_type
      WHEN 'district'::mbg_region_type THEN
        SELECT s.id INTO stage_id
        FROM mbg_stages s
        INNER JOIN mbg_parishes p ON p.id = s.parish_id
        INNER JOIN mbg_subcounties sc ON sc.id = p.subcounty_id
        INNER JOIN mbg_divisions d ON d.id = sc.division_id
        WHERE d.district_id = chairperson_record.region_id
          AND s.is_active = true
        LIMIT 1;
        
      WHEN 'division'::mbg_region_type THEN
        SELECT s.id INTO stage_id
        FROM mbg_stages s
        INNER JOIN mbg_parishes p ON p.id = s.parish_id
        INNER JOIN mbg_subcounties sc ON sc.id = p.subcounty_id
        WHERE sc.division_id = chairperson_record.region_id
          AND s.is_active = true
        LIMIT 1;
        
      WHEN 'subcounty'::mbg_region_type THEN
        SELECT s.id INTO stage_id
        FROM mbg_stages s
        INNER JOIN mbg_parishes p ON p.id = s.parish_id
        WHERE p.subcounty_id = chairperson_record.region_id
          AND s.is_active = true
        LIMIT 1;
        
      WHEN 'parish'::mbg_region_type THEN
        SELECT id INTO stage_id
        FROM mbg_stages
        WHERE parish_id = chairperson_record.region_id
          AND is_active = true
        LIMIT 1;
        
      ELSE
        CONTINUE; -- Skip if not a higher-level chairperson
    END CASE;

    -- If we found a stage, add the stage role
    IF stage_id IS NOT NULL THEN
      INSERT INTO mbg_committee_members (
        user_id,
        role,
        region_type,
        region_id,
        assigned_by,
        parent_chairperson_id,
        commission_rate,
        is_active,
        appointed_at
      )
      VALUES (
        chairperson_record.user_id,
        'stage_chairperson'::mbg_chairperson_role,
        'stage'::mbg_region_type,
        stage_id,
        chairperson_record.assigned_by,
        chairperson_record.parent_chairperson_id,
        chairperson_record.commission_rate,
        true,
        NOW()
      )
      ON CONFLICT (user_id, region_type, region_id) DO NOTHING;
      
      RAISE NOTICE 'Added stage role for user %', chairperson_record.user_id;
    ELSE
      RAISE NOTICE 'No stage found for user % in region %', chairperson_record.user_id, chairperson_record.region_id;
    END IF;
  END LOOP;
END $$;

COMMIT;

-- Show results
SELECT 
  'Existing chairpersons updated!' as status,
  COUNT(*) as total_chairpersons,
  COUNT(CASE WHEN role = 'stage_chairperson' THEN 1 END) as stage_chairpersons
FROM mbg_committee_members
WHERE is_active = true;
