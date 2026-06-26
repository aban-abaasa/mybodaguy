-- ==============================================
-- CHECK STAGE COVERAGE
-- ==============================================
-- See which chairpersons have stage roles and which don't

-- 1. List all chairpersons and their roles
SELECT 
  u.email,
  cm.role,
  cm.region_type,
  CASE cm.region_type
    WHEN 'district' THEN (SELECT name FROM mbg_districts WHERE id = cm.region_id)
    WHEN 'division' THEN (SELECT name FROM mbg_divisions WHERE id = cm.region_id)
    WHEN 'subcounty' THEN (SELECT name FROM mbg_subcounties WHERE id = cm.region_id)
    WHEN 'parish' THEN (SELECT name FROM mbg_parishes WHERE id = cm.region_id)
    WHEN 'stage' THEN (SELECT name FROM mbg_stages WHERE id = cm.region_id)
  END as region_name,
  cm.is_active
FROM mbg_committee_members cm
INNER JOIN mbg_users u ON u.id = cm.user_id
WHERE cm.is_active = true
ORDER BY u.email, cm.role;

-- 2. Chairpersons WITHOUT stage role
SELECT 
  'Missing Stage Role' as status,
  u.email,
  cm.role as current_role,
  cm.region_type,
  CASE cm.region_type
    WHEN 'district' THEN (SELECT name FROM mbg_districts WHERE id = cm.region_id)
    WHEN 'division' THEN (SELECT name FROM mbg_divisions WHERE id = cm.region_id)
    WHEN 'subcounty' THEN (SELECT name FROM mbg_subcounties WHERE id = cm.region_id)
    WHEN 'parish' THEN (SELECT name FROM mbg_parishes WHERE id = cm.region_id)
  END as region_name
FROM mbg_committee_members cm
INNER JOIN mbg_users u ON u.id = cm.user_id
WHERE cm.is_active = true
  AND cm.role != 'stage_chairperson'
  AND NOT EXISTS (
    SELECT 1 FROM mbg_committee_members cm2
    WHERE cm2.user_id = cm.user_id
      AND cm2.role = 'stage_chairperson'
      AND cm2.is_active = true
  );

-- 3. Check if stages exist in each region type
SELECT 
  'Stage Availability' as check_type,
  (SELECT COUNT(*) FROM mbg_districts WHERE is_active = true) as active_districts,
  (SELECT COUNT(*) FROM mbg_divisions WHERE is_active = true) as active_divisions,
  (SELECT COUNT(*) FROM mbg_subcounties WHERE is_active = true) as active_subcounties,
  (SELECT COUNT(*) FROM mbg_parishes WHERE is_active = true) as active_parishes,
  (SELECT COUNT(*) FROM mbg_stages WHERE is_active = true) as active_stages;

-- 4. For each higher-level chairperson, check if stages exist in their region
SELECT 
  'Stage Check' as status,
  u.email,
  cm.role,
  cm.region_type,
  CASE 
    WHEN cm.region_type = 'district' THEN (
      SELECT COUNT(*) 
      FROM mbg_stages s
      INNER JOIN mbg_parishes p ON p.id = s.parish_id
      INNER JOIN mbg_subcounties sc ON sc.id = p.subcounty_id
      INNER JOIN mbg_divisions d ON d.id = sc.division_id
      WHERE d.district_id = cm.region_id AND s.is_active = true
    )
    WHEN cm.region_type = 'division' THEN (
      SELECT COUNT(*) 
      FROM mbg_stages s
      INNER JOIN mbg_parishes p ON p.id = s.parish_id
      INNER JOIN mbg_subcounties sc ON sc.id = p.subcounty_id
      WHERE sc.division_id = cm.region_id AND s.is_active = true
    )
    WHEN cm.region_type = 'subcounty' THEN (
      SELECT COUNT(*) 
      FROM mbg_stages s
      INNER JOIN mbg_parishes p ON p.id = s.parish_id
      WHERE p.subcounty_id = cm.region_id AND s.is_active = true
    )
    WHEN cm.region_type = 'parish' THEN (
      SELECT COUNT(*) 
      FROM mbg_stages s
      WHERE s.parish_id = cm.region_id AND s.is_active = true
    )
    ELSE 0
  END as stages_in_region
FROM mbg_committee_members cm
INNER JOIN mbg_users u ON u.id = cm.user_id
WHERE cm.is_active = true
  AND cm.role != 'stage_chairperson'
ORDER BY u.email;
