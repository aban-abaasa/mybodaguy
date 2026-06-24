# Auto-Add Stage Chairperson Role to All Chairpersons

## Business Rule
**Every chairperson must also have a stage chairperson role.**

This ensures that:
- ✅ District chairpersons can manage riders at stage level
- ✅ Division chairpersons can manage riders at stage level
- ✅ Subcounty chairpersons can manage riders at stage level
- ✅ Parish chairpersons can manage riders at stage level
- ✅ Stage chairpersons already have the role

## How It Works

### For New Assignments
When you assign someone as a chairperson:
1. They get their PRIMARY role (e.g., "District Chairperson")
2. **AUTOMATICALLY** they also get a "Stage Chairperson" role
3. The system finds an appropriate stage in their region

Example:
```
Assign John as Division Chairperson of "Central Division"
↓
Records Created:
1. John → Division Chairperson → Central Division
2. John → Stage Chairperson → [First stage in Central Division] (automatic!)
```

### For Existing Chairpersons
Run the migration script to retroactively add stage roles to existing chairpersons who don't have one yet.

## Implementation Files

### 1. AUTO_ADD_STAGE_ROLE.sql
**Purpose:** Updates the assignment function to automatically add stage role
**When to run:** Run this FIRST to enable automatic stage role assignment

**What it does:**
- Updates `mbg_assign_chairperson` function
- When assigning a non-stage chairperson, it:
  1. Creates the primary assignment record
  2. Finds an appropriate stage in their region
  3. Automatically creates a stage chairperson assignment

**Stage Selection Logic:**
- **District Chairperson** → Gets first stage in any division in their district
- **Division Chairperson** → Gets first stage in any subcounty in their division
- **Subcounty Chairperson** → Gets first stage in any parish in their subcounty
- **Parish Chairperson** → Gets first stage in their parish
- **Stage Chairperson** → No additional assignment needed

### 2. ADD_STAGE_ROLE_TO_EXISTING.sql
**Purpose:** Retroactively add stage roles to existing chairpersons
**When to run:** Run this AFTER running AUTO_ADD_STAGE_ROLE.sql

**What it does:**
- Finds all active chairpersons without a stage role
- Adds a stage chairperson assignment to each
- Uses the same stage selection logic as above

### 3. FIX_INFINITE_RECURSION_RLS.sql
**Purpose:** Fix the RLS policy infinite recursion error
**When to run:** Run this if you see "infinite recursion detected" errors

## Installation Steps

### Step 1: Fix RLS (if needed)
If you're seeing "infinite recursion" errors:
```sql
-- Run in Supabase SQL Editor
FIX_INFINITE_RECURSION_RLS.sql
```

### Step 2: Enable Auto Stage Role
```sql
-- Run in Supabase SQL Editor
AUTO_ADD_STAGE_ROLE.sql
```

### Step 3: Update Existing Chairpersons
```sql
-- Run in Supabase SQL Editor
ADD_STAGE_ROLE_TO_EXISTING.sql
```

### Step 4: Test
1. Refresh your app
2. Log in as a chairperson
3. Check "Your Roles" - you should see both your primary role AND a stage role
4. Assign a new subordinate - they should automatically get both roles too

## Database Changes

### Before
```sql
-- User assigned as Division Chairperson
INSERT INTO mbg_committee_members (user_id, role, region_type, region_id)
VALUES ('user-id', 'division_chairperson', 'division', 'division-id');

-- Result: 1 record
```

### After
```sql
-- User assigned as Division Chairperson
SELECT mbg_assign_chairperson('user-id', 'division_chairperson', 'division', 'division-id', 5.0);

-- Result: 2 records automatically created!
-- 1. division_chairperson → division-id
-- 2. stage_chairperson → [stage-in-division-id]
```

## Multi-Role Support

The system now supports true multi-role assignments:
- One user can have multiple committee_member records
- Each record represents a different role/region assignment
- The UNIQUE constraint allows this: `UNIQUE(user_id, region_type, region_id)`

### Example User Roles
```
User: John Doe
├─ District Chairperson → "Kampala District"
└─ Stage Chairperson → "Central Stage" (auto-assigned)

User: Jane Smith  
├─ Parish Chairperson → "Nakawa Parish"
└─ Stage Chairperson → "Nakawa Stage" (auto-assigned)
```

## Benefits

1. **Simplified Management**: All chairpersons can manage riders directly
2. **Consistent Experience**: Every chairperson sees the rider management interface
3. **No Manual Steps**: Stage role is added automatically
4. **Hierarchical Structure Maintained**: Primary role still defines their level
5. **Commission Tracking**: Both roles use the same commission rate

## Verification Queries

### Check Your Roles
```sql
SELECT 
  role,
  region_type,
  region_id
FROM mbg_committee_members
WHERE user_id = auth.uid()
  AND is_active = true;
```

### Check All Chairpersons with Stage Roles
```sql
SELECT 
  u.email,
  cm.role as primary_role,
  cm.region_type,
  COUNT(*) OVER (PARTITION BY cm.user_id) as total_roles
FROM mbg_committee_members cm
INNER JOIN mbg_users u ON u.id = cm.user_id
WHERE cm.is_active = true
ORDER BY u.email, cm.role;
```

### Find Chairpersons Missing Stage Role
```sql
SELECT 
  u.email,
  cm.role,
  cm.region_type
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
```

## Troubleshooting

### Issue: "No stage found for user"
**Cause:** The region doesn't have any active stages yet
**Solution:** Create at least one active stage in each region before assigning chairpersons

### Issue: Chairperson only has one role
**Cause:** AUTO_ADD_STAGE_ROLE.sql wasn't run before assignment
**Solution:** 
1. Run AUTO_ADD_STAGE_ROLE.sql
2. Run ADD_STAGE_ROLE_TO_EXISTING.sql

### Issue: "duplicate key value violates unique constraint"
**Cause:** User already has that exact role/region combination
**Solution:** This is expected behavior - the system uses ON CONFLICT DO UPDATE

## Notes

- The stage assignment is deterministic (always picks first active stage)
- If no stage exists in the region, only the primary role is created
- The parent_chairperson_id is the same for both role assignments
- Both roles have the same commission_rate
- Deactivating a user deactivates all their roles
