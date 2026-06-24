# Complete Fix for Chairperson Assignment Issues

## Problems Found
1. ❌ Table naming mismatch: schema creates `committee_members` but code expects `mbg_committee_members`
2. ❌ Missing `parent_chairperson_id` column for tracking hierarchy
3. ❌ Missing `commission_rate` column
4. ❌ Function had unused `notes` parameter
5. ❌ RLS policies might be blocking inserts

## Solution: Run These Files in Order

### Step 1: Fix Everything at Once
**Run this file in Supabase SQL Editor:**
```
FIX_TABLE_NAME_AND_ASSIGNMENT.sql
```

This single file will:
- ✅ Create both enum types (with and without mbg_ prefix)
- ✅ Rename `committee_members` → `mbg_committee_members`
- ✅ Add missing columns (`parent_chairperson_id`, `commission_rate`)
- ✅ Create all necessary indexes
- ✅ Set up proper RLS policies
- ✅ Create `mbg_assign_chairperson` function
- ✅ Create `get_subordinate_chairpersons` function
- ✅ Grant proper permissions

### Step 2: Verify the Fix
**Run this file to check everything worked:**
```
DIAGNOSE_ASSIGNMENT_ISSUE.sql
```

Look for:
- ✅ Table `mbg_committee_members` exists
- ✅ Column `parent_chairperson_id` exists
- ✅ Column `commission_rate` exists
- ✅ Function `mbg_assign_chairperson` exists with 5 parameters
- ✅ Function `get_subordinate_chairpersons` exists

### Step 3: Test Assignment
1. Refresh your web app
2. Log in as a chairperson
3. Go to "Your Chairpersons" section
4. Click "Assign New"
5. Fill in the form and submit
6. **Expected Result**: Assignment succeeds and the new chairperson appears in the list immediately

## What Was Fixed

### Before
```
Schema creates: public.committee_members
Frontend queries: public.mbg_committee_members
Result: Table not found ❌
```

### After
```
Schema creates: public.committee_members
Script renames to: public.mbg_committee_members
Frontend queries: public.mbg_committee_members
Result: Everything works ✅
```

## Database Changes Made

### Table Renamed
```sql
committee_members → mbg_committee_members
```

### Columns Added
```sql
parent_chairperson_id UUID  -- Tracks who assigned whom
commission_rate DECIMAL(5,2) -- Commission percentage (default 5.00)
```

### Functions Created
1. **mbg_assign_chairperson(target_user_id, target_role, target_region_type, target_region_id, commission_rate)**
   - Assigns a user as chairperson
   - Sets parent relationship
   - Updates user role_type to 'chairperson'

2. **get_subordinate_chairpersons(chairperson_user_id)**
   - Returns all subordinates assigned by the chairperson
   - Includes full user details and region names

### RLS Policies Added
- `mbg_committee_members_read_own` - Users can read their own records
- `mbg_committee_members_read_subordinates` - Users can read their subordinates
- `mbg_committee_members_service_role` - Service role has full access
- `mbg_committee_members_insert_authenticated` - Authenticated users can insert
- `mbg_committee_members_update_own` - Users can update records they assigned

## Troubleshooting

### If assignment still fails:

1. **Check browser console for errors**
   - Look for specific error messages
   - Note the exact error code

2. **Run diagnostic query:**
```sql
SELECT 
  'User ID: ' || auth.uid() as info
UNION ALL
SELECT 
  'User exists in mbg_users: ' || EXISTS(SELECT 1 FROM mbg_users WHERE id = auth.uid())::text
UNION ALL
SELECT 
  'Function exists: ' || EXISTS(SELECT 1 FROM pg_proc WHERE proname = 'mbg_assign_chairperson')::text
UNION ALL
SELECT
  'Table exists: ' || EXISTS(SELECT 1 FROM pg_tables WHERE tablename = 'mbg_committee_members')::text;
```

3. **Check if the user being assigned exists:**
```sql
SELECT id, email, role_type 
FROM mbg_users 
WHERE email = 'target-email@example.com';
```

4. **Try manual assignment:**
```sql
SELECT mbg_assign_chairperson(
  'target-user-id'::uuid,
  'stage_chairperson',
  'stage',
  'stage-id'::uuid,
  5.0
);
```

### If you see "permission denied" errors:
The RLS policies might need adjustment. Run this to temporarily allow inserts:
```sql
ALTER TABLE mbg_committee_members DISABLE ROW LEVEL SECURITY;
-- Try assignment
-- Then re-enable:
ALTER TABLE mbg_committee_members ENABLE ROW LEVEL SECURITY;
```

## Frontend Changes Already Applied
The frontend service (`chairpersonService.ts`) has already been updated to:
- ✅ Remove `target_notes` parameter
- ✅ Use `target_user_id` instead of `target_user_email`
- ✅ Use `commission_rate` instead of `target_commission_rate`

## Success Indicators
After applying the fix, you should see:
- ✅ Assignment form submits without errors
- ✅ Success message appears
- ✅ New chairperson appears in "Your Chairpersons" list
- ✅ You can view and manage the assigned chairperson
- ✅ The subordinate can log in and see their chairperson role

## Need More Help?
If the issue persists:
1. Run `DIAGNOSE_ASSIGNMENT_ISSUE.sql`
2. Copy all output
3. Share the diagnostic results along with any browser console errors
