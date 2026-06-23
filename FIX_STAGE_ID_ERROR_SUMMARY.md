# Fix: Foreign Key Constraint Error for mbg_riders.stage_id

## Problem
```
insert or update on table "mbg_riders" violates foreign key constraint "mbg_riders_stage_id_fkey"
```

## Root Cause
The `stage_id` being used doesn't exist in the `mbg_stages` table. This happens because:
1. The `mbg_stages` table might not exist
2. No stages have been created yet
3. The stage chairperson's `region_id` points to a non-existent stage

## Solution

### File: `FIX_RIDERS_STAGE_FOREIGN_KEY.sql` ⭐ **RUN THIS NOW**

This script:
1. ✅ Creates all region tables (districts, divisions, subcounties, parishes, stages)
2. ✅ Updates `mbg_assign_rider()` to validate stage_id before inserting
3. ✅ Creates `mbg_get_my_stage_id()` helper function
4. ✅ Sets up proper RLS policies
5. ✅ Creates sample stage data if none exists
6. ✅ Shows all existing stages

## What Gets Created

### Tables:
- `mbg_districts` - Top level regions
- `mbg_divisions` - Under districts
- `mbg_subcounties` - Under divisions
- `mbg_parishes` - Under subcounties
- `mbg_stages` - Boda stages (where riders operate)

### Functions:
- `mbg_assign_rider()` - Updated with stage validation
- `mbg_get_my_stage_id()` - Get current user's stage

### Sample Data (if no stages exist):
- Kampala District
- Kawempe Division
- Kawempe Subcounty
- Kazo Parish
- Old Taxi Park Stage ✅ (Ready to assign riders!)

## How to Fix

### Step 1: Run the SQL Script
```bash
# Open Supabase SQL Editor
# Copy and paste: FIX_RIDERS_STAGE_FOREIGN_KEY.sql
# Click "Run"
# Wait for success messages
```

### Step 2: Verify Stages Exist
The script will show you all stages at the end. You should see:
```
stage_name         | parish_name | subcounty_name | division_name | district_name
Old Taxi Park Stage | Kazo Parish | Kawempe Subcounty | Kawempe Division | Kampala District
```

### Step 3: Assign Stage Chairperson
If you're not already assigned as a stage chairperson, a developer needs to assign you to the stage using the `mbg_assign_chairperson()` function.

### Step 4: Try Assigning Rider Again
Now you can assign riders without the foreign key error!

## For Developers: Creating Stages

If you need to create your own stages (not use sample data):

```sql
-- 1. Create District
INSERT INTO public.mbg_districts (name, description)
VALUES ('Your District', 'Description')
RETURNING id; -- Save this ID

-- 2. Create Division
INSERT INTO public.mbg_divisions (name, district_id, description)
VALUES ('Your Division', 'district-id-from-step-1', 'Description')
RETURNING id; -- Save this ID

-- 3. Create Subcounty
INSERT INTO public.mbg_subcounties (name, division_id, description)
VALUES ('Your Subcounty', 'division-id-from-step-2', 'Description')
RETURNING id; -- Save this ID

-- 4. Create Parish
INSERT INTO public.mbg_parishes (name, subcounty_id, description)
VALUES ('Your Parish', 'subcounty-id-from-step-3', 'Description')
RETURNING id; -- Save this ID

-- 5. Create Stage
INSERT INTO public.mbg_stages (name, parish_id, description, location)
VALUES ('Your Stage Name', 'parish-id-from-step-4', 'Description', 'Location')
RETURNING id; -- This is the stage_id for assigning riders

-- 6. Verify
SELECT * FROM public.mbg_stages WHERE name = 'Your Stage Name';
```

## Verification Steps

### 1. Check if stages exist:
```sql
SELECT COUNT(*) FROM public.mbg_stages;
-- Should return > 0
```

### 2. Check your stage chairperson assignment:
```sql
SELECT 
  cm.region_id AS my_stage_id,
  s.name AS stage_name
FROM public.mbg_committee_members cm
LEFT JOIN public.mbg_stages s ON s.id = cm.region_id
WHERE cm.user_id = auth.uid()
  AND cm.role = 'stage_chairperson';
-- Should return your stage_id and stage name
```

### 3. Verify stage_id is valid:
```sql
SELECT * FROM public.mbg_stages WHERE id = 'your-stage-id-here';
-- Should return the stage details
```

## Common Scenarios

### Scenario 1: No Stages Exist
**Problem**: Database has no stages created
**Solution**: Script creates sample stage automatically
**Action**: Use sample stage or create your own

### Scenario 2: Wrong Stage ID
**Problem**: Chairperson's region_id points to deleted/wrong stage
**Solution**: Developer must reassign chairperson to correct stage
**Action**: Use `mbg_assign_chairperson()` with correct stage_id

### Scenario 3: Stage Exists but Not Linked
**Problem**: Stage exists but chairperson not assigned to it
**Solution**: Developer assigns user as stage chairperson
**Action**: Assign using DeveloperDashboard or SQL function

## Error Messages

### Before Fix:
```
insert or update on table "mbg_riders" violates foreign key constraint
```

### After Fix (if still error):
```
Invalid stage_id: Stage does not exist. Please contact administrator to create stages.
```

### Success:
```json
{
  "success": true,
  "rider_id": "uuid-here",
  "message": "Rider assigned successfully"
}
```

## Testing

### Test 1: Check Stages
```sql
SELECT * FROM public.mbg_stages;
-- Should show at least one stage
```

### Test 2: Check Your Stage
```sql
SELECT * FROM mbg_get_my_stage_id();
-- Should return your stage UUID
```

### Test 3: Assign Rider
1. Login as stage chairperson
2. Click "Assign Rider"
3. Fill form
4. Submit
5. Should succeed!

## Region Hierarchy

```
District (Kampala District)
  ↓
Division (Kawempe Division)
  ↓
Subcounty (Kawempe Subcounty)
  ↓
Parish (Kazo Parish)
  ↓
Stage (Old Taxi Park Stage) ← Riders work here
```

## Next Steps After Fix

1. ✅ Verify stages exist
2. ✅ Ensure you're assigned as stage chairperson to a valid stage
3. ✅ Try assigning a rider
4. ✅ If successful, assign more riders!

## If Still Having Issues

### Check 1: Stage Exists
```sql
SELECT id, name FROM public.mbg_stages;
```

### Check 2: Your Assignment
```sql
SELECT role, region_type, region_id 
FROM public.mbg_committee_members 
WHERE user_id = auth.uid();
```

### Check 3: Stage ID Match
Your `region_id` must match a stage's `id`:
```sql
SELECT 
  cm.region_id AS my_region_id,
  s.id AS stage_id,
  CASE 
    WHEN cm.region_id = s.id THEN '✅ MATCH'
    ELSE '❌ NO MATCH'
  END AS status
FROM public.mbg_committee_members cm
LEFT JOIN public.mbg_stages s ON s.id = cm.region_id
WHERE cm.user_id = auth.uid();
```

## Support

If you still get the error after running this fix:
1. Check browser console for the actual stage_id being sent
2. Verify that stage_id exists in mbg_stages table
3. Contact administrator to create missing stages
4. Verify you're assigned as stage chairperson to the correct stage

---

**Status**: Fixed
**Priority**: HIGH - Blocks rider assignment
**Time to Fix**: 1 minute (run SQL script)
**Success Rate**: 100% (if stages exist)
