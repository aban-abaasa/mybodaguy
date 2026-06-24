# Fix for Subordinate Chairperson Loading Issue

## Problem
After assigning a new chairperson, the dashboard shows:
```
"No chairpersons assigned yet"
```

Instead of displaying the newly assigned chairperson in the list for management.

## Root Cause
The system was missing the hierarchical relationship tracking:

1. **Missing Column**: The `mbg_committee_members` table didn't have `parent_chairperson_id` column to track who assigned whom
2. **Function Not Setting Parent**: The `mbg_assign_chairperson` function wasn't recording the parent-child relationship
3. **Query Can't Find Subordinates**: The `get_subordinate_chairpersons` function looks for records with matching `parent_chairperson_id`, but this was never being set
4. **RLS Policy Gap**: There was no policy explicitly allowing chairpersons to read their subordinates

## Solution Applied

### Database Changes
**File:** `FIX_SUBORDINATE_CHAIRPERSON_LOADING.sql`

The fix includes 6 steps:

#### 1. Add Parent Column
```sql
ALTER TABLE mbg_committee_members 
ADD COLUMN parent_chairperson_id UUID REFERENCES mbg_committee_members(id);
```

#### 2. Create Index
Creates an index on `parent_chairperson_id` for efficient hierarchical queries.

#### 3. Update Assignment Function
Modified `mbg_assign_chairperson` to:
- Get the assigner's committee_member ID
- Store it as `parent_chairperson_id` when creating new assignments
- Include `commission_rate` in the INSERT statement

#### 4. Update Get Subordinates Function
Ensures `get_subordinate_chairpersons`:
- Finds the calling user's committee_member ID
- Returns all committee members where `parent_chairperson_id` matches
- Includes full user details (name, email, phone, region)

#### 5. Add RLS Policy
New policy `committee_members_read_subordinates` allows users to read committee member records where they are the parent chairperson.

#### 6. Grant Permissions
Ensures authenticated users and service role can execute the functions.

## How to Apply

### 1. Run the SQL Fix
```bash
# In Supabase SQL Editor, run:
FIX_SUBORDINATE_CHAIRPERSON_LOADING.sql
```

### 2. Test the Fix
1. Log in as a chairperson
2. Go to "Your Chairpersons" section
3. Click "Assign New"
4. Assign a subordinate chairperson
5. **Result**: The newly assigned chairperson should immediately appear in your list

## What This Fixes

✅ **Hierarchical Tracking**: System now tracks who assigned whom
✅ **Subordinate List Loading**: Assigned chairpersons now appear in the list
✅ **Management Capability**: Chairpersons can manage their subordinates
✅ **Database Integrity**: Proper foreign key relationships established
✅ **Query Performance**: Index added for efficient hierarchy queries
✅ **Security**: RLS policies ensure users only see their subordinates

## Technical Details

### Before Fix
```
User A assigns User B as chairperson
↓
mbg_committee_members record created with:
- user_id: User B
- assigned_by: User A
- parent_chairperson_id: NULL ❌
↓
Query looks for: WHERE parent_chairperson_id = (User A's committee_id)
↓
Result: No records found (because parent_chairperson_id was NULL)
```

### After Fix
```
User A assigns User B as chairperson
↓
mbg_committee_members record created with:
- user_id: User B
- assigned_by: User A
- parent_chairperson_id: (User A's committee_id) ✅
↓
Query looks for: WHERE parent_chairperson_id = (User A's committee_id)
↓
Result: User B's record is found and displayed
```

## Database Schema Change

### mbg_committee_members Table (Updated)
```sql
CREATE TABLE mbg_committee_members (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES mbg_users(id),
  role mbg_chairperson_role,
  region_type mbg_region_type,
  region_id UUID,
  assigned_by UUID,
  parent_chairperson_id UUID REFERENCES mbg_committee_members(id),  -- NEW!
  commission_rate DECIMAL(5,2) DEFAULT 5.00,
  is_active BOOLEAN DEFAULT true,
  appointed_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Verification Steps

After running the fix:

1. **Check Column Exists**:
```sql
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'mbg_committee_members' 
AND column_name = 'parent_chairperson_id';
```

2. **Test Assignment**:
```sql
-- Should return the committee_id of newly assigned chairperson
SELECT mbg_assign_chairperson(
  'target-user-id',
  'stage_chairperson',
  'stage',
  'stage-id',
  5.0
);
```

3. **Test Subordinate Query**:
```sql
-- Should return list of subordinates
SELECT * FROM get_subordinate_chairpersons('your-user-id');
```

## Notes

- Existing committee members will have `parent_chairperson_id = NULL` (assigned before this fix)
- New assignments from now on will have proper parent tracking
- The fallback logic in the frontend still works for edge cases
- Commission rate is now properly stored during assignment
