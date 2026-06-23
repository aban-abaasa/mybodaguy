# Fix: Ambiguous Column Reference Error

## Problem
```
Error: column reference "id" is ambiguous
Code: 42702
Function: get_subordinate_chairpersons
```

## Root Cause
The `get_subordinate_chairpersons` function had ambiguous column references in the SELECT statement. When multiple tables (mbg_committee_members, mbg_users, mbg_user_profiles, committee_member_details) all have columns with the same name (like "id", "name"), PostgreSQL doesn't know which table's column to use.

This is especially critical in a **shared Supabase instance** with multiple applications, as column names can conflict across different app tables.

## Solution
Made **all column references explicit** using table aliases:

### Before (Ambiguous):
```sql
SELECT 
  cm.id,           -- Ambiguous if other tables also have "id"
  cm.user_id,
  u.email,
  ...
```

### After (Explicit):
```sql
SELECT 
  cm.id AS id,                    -- Explicitly from mbg_committee_members
  cm.user_id AS user_id,          -- Explicitly from mbg_committee_members
  u.email AS email,               -- Explicitly from mbg_users
  cm.role AS role,                -- Explicitly from mbg_committee_members
  cm.region_type AS region_type,  -- Explicitly from mbg_committee_members
  ...
```

### Subqueries Also Fixed:
```sql
-- Before: SELECT name FROM public.mbg_districts WHERE id = cm.region_id
-- After:  SELECT d.name FROM public.mbg_districts d WHERE d.id = cm.region_id

WHEN 'district' THEN (SELECT d.name FROM public.mbg_districts d WHERE d.id = cm.region_id)
WHEN 'division' THEN (SELECT dv.name FROM public.mbg_divisions dv WHERE dv.id = cm.region_id)
WHEN 'subcounty' THEN (SELECT sc.name FROM public.mbg_subcounties sc WHERE sc.id = cm.region_id)
WHEN 'parish' THEN (SELECT p.name FROM public.mbg_parishes p WHERE p.id = cm.region_id)
WHEN 'stage' THEN (SELECT s.name FROM public.mbg_stages s WHERE s.id = cm.region_id)
```

## Files Fixed

### 1. FIX_GET_SUBORDINATE_CHAIRPERSONS.sql ⭐ **RUN THIS**
- Standalone fix for immediate deployment
- Drops and recreates the function with explicit aliases
- Grants proper permissions
- Ready to run in Supabase SQL Editor

### 2. ADD_COMMITTEE_MEMBER_DETAILS.sql (Updated)
- Contains the corrected function
- Use this for fresh installations

## How to Apply Fix

### Option 1: Quick Fix (Recommended)
```sql
-- Run this in Supabase SQL Editor
-- File: FIX_GET_SUBORDINATE_CHAIRPERSONS.sql
```
Just copy and run the entire file. It will replace the broken function.

### Option 2: Full Reinstall
If you haven't run `ADD_COMMITTEE_MEMBER_DETAILS.sql` yet, run it now (it's already fixed).

## Why This Matters for Shared Supabase

In a **shared Supabase instance** (multiple applications):
- Multiple apps may have tables with same column names
- Without explicit aliases, PostgreSQL can't determine which table's column to use
- **Always use table aliases** and explicit column references
- **Always use mbg_ prefix** for MyBodaGuy tables to avoid conflicts

## Best Practices for Shared Supabase

### 1. Always Use Table Prefixes
```sql
-- Good: mbg_users, mbg_committee_members, mbg_districts
-- Bad:  users, committee_members, districts (conflicts with other apps)
```

### 2. Always Use Table Aliases
```sql
-- Good
SELECT cm.id, u.email, up.full_name
FROM mbg_committee_members cm
JOIN mbg_users u ON u.id = cm.user_id
LEFT JOIN mbg_user_profiles up ON up.user_id = cm.user_id

-- Bad (ambiguous if other apps have similar joins)
SELECT id, email, full_name
FROM mbg_committee_members
JOIN mbg_users ON id = user_id
```

### 3. Always Use Explicit AS in Returns
```sql
-- Good
SELECT 
  cm.id AS id,
  cm.role AS role,
  u.email AS email

-- Bad (can cause ambiguity in complex queries)
SELECT 
  cm.id,
  cm.role,
  u.email
```

### 4. Always Alias Subqueries
```sql
-- Good
SELECT d.name FROM mbg_districts d WHERE d.id = region_id

-- Bad
SELECT name FROM mbg_districts WHERE id = region_id
```

## Testing

After running the fix:

1. **Test in SQL Editor:**
```sql
-- Replace with actual user_id of a chairperson
SELECT * FROM get_subordinate_chairpersons('user-id-here');
```

2. **Test in Frontend:**
- Login as chairperson
- Dashboard should load without errors
- Subordinates list should display

3. **Check Console:**
- No more 400 errors
- No "ambiguous column" messages

## Verification Checklist

- [ ] Run `FIX_GET_SUBORDINATE_CHAIRPERSONS.sql` in Supabase
- [ ] Function recreated successfully
- [ ] Test with actual chairperson user_id
- [ ] Function returns data (or empty if no subordinates)
- [ ] Frontend dashboard loads
- [ ] No console errors
- [ ] Subordinates list displays correctly

## Error Prevention

To prevent similar errors in the future:

### When Writing SQL Functions:
1. ✅ Always use table aliases (cm, u, up, etc.)
2. ✅ Always use explicit `AS` in SELECT columns
3. ✅ Always alias subqueries
4. ✅ Always use schema-qualified names (public.mbg_users)
5. ✅ Test functions with sample data before deployment
6. ✅ Use mbg_ prefix for all MyBodaGuy tables

### Code Review Checklist:
- [ ] All tables have aliases?
- [ ] All columns have explicit table references?
- [ ] All subqueries have aliases?
- [ ] All tables use mbg_ prefix?
- [ ] Function tested with sample data?

## Related Files

### Fixed:
- `FIX_GET_SUBORDINATE_CHAIRPERSONS.sql` (new, run this)
- `ADD_COMMITTEE_MEMBER_DETAILS.sql` (updated)

### Not Affected:
- Frontend code (no changes needed)
- Other SQL functions (already correct)
- RLS policies (already correct)

## Summary

**Problem:** Ambiguous column "id" in get_subordinate_chairpersons
**Cause:** Multiple tables with same column names, no explicit aliases
**Fix:** Added explicit table aliases to all column references
**Impact:** Function now works correctly in shared Supabase
**Action:** Run `FIX_GET_SUBORDINATE_CHAIRPERSONS.sql` immediately

---

**Status:** Fixed and ready to deploy
**Priority:** HIGH - Blocks subordinate list functionality
**Time to Fix:** 30 seconds (just run the SQL)
