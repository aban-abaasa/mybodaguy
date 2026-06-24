# Fix for "notes" Column Error

## Problem
The application was throwing a 400 error when assigning chairpersons:
```
column "notes" of relation "mbg_committee_members" does not exist
```

## Root Cause
The `mbg_assign_chairperson` database function had a `notes` parameter in its signature, but:
1. The `mbg_committee_members` table doesn't have a `notes` column
2. The function wasn't using the `notes` parameter anyway
3. The frontend was passing incorrect parameter names

## Solution Applied

### 1. Database Function Fix
**File:** `FIX_NOTES_PARAMETER.sql`

Changes made:
- Removed the unused `notes TEXT DEFAULT NULL` parameter from function signature
- Fixed function to only use parameters that match actual table columns
- Updated GRANT statements to reflect new signature

### 2. Frontend Service Fix
**File:** `frontend/src/mybodaguy/services/chairpersonService.ts`

Changes made:
- Removed `target_notes: params.notes || null` from RPC call
- Fixed parameter name from `target_user_email` to `target_user_id` (matches function signature)
- Fixed parameter name from `target_commission_rate` to `commission_rate` (matches function signature)

## How to Apply

1. **Run the SQL fix:**
   ```bash
   # Run FIX_NOTES_PARAMETER.sql in your Supabase SQL Editor
   ```

2. **Frontend changes are already applied** - the TypeScript file has been updated

3. **Test the chairperson assignment** - it should now work without the "notes" error

## What This Fixes
✅ Chairperson assignment now works correctly
✅ No more "column notes does not exist" errors
✅ Function parameters match what the table actually has
✅ Frontend passes the correct parameter names to the database function

## Database Function Signature (After Fix)
```sql
mbg_assign_chairperson(
  target_user_id UUID,
  target_role TEXT,
  target_region_type TEXT,
  target_region_id UUID,
  commission_rate DECIMAL DEFAULT 5.00
)
```
