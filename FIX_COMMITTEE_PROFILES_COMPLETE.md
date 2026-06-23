# Committee Member Profile System - Complete Setup

## Problem Fixed
1. ❌ `get_subordinate_chairpersons` function was missing (404 error)
2. ❌ `committee_member_details` table was missing (404 error)
3. ❌ ProfileModal didn't have committee-specific fields

## Solution

### Step 1: Run SQL Script
**File**: `ADD_COMMITTEE_MEMBER_DETAILS.sql`

This creates:
- ✅ `committee_member_details` table for extended chairperson profiles
- ✅ `get_subordinate_chairpersons()` function for hierarchical management
- ✅ `mbg_committee_hierarchy` view for easy querying
- ✅ RLS policies (chairpersons can manage their own details)
- ✅ `parent_chairperson_id` column in `mbg_committee_members`

**Run this now in Supabase SQL Editor!**

### Step 2: ProfileModal Updated
**File**: `frontend/src/mybodaguy/components/ProfileModal.tsx`

Added committee-specific fields (only shown for chairperson role):
- ✅ Alternate Phone
- ✅ Emergency Contact Name
- ✅ Emergency Contact Phone
- ✅ Bio / Description

These fields help chairpersons build detailed profiles so committee members "have strong faith in the benefits" of the platform.

## Committee Member Profile Fields

### Basic Profile (All Roles)
- Full Name
- Phone
- Date of Birth
- Gender
- National ID
- Address
- City
- Email (read-only)

### Committee-Specific (Chairperson Only)
- **Alternate Phone**: Secondary contact for committee members
- **Emergency Contact Name**: Person to contact in emergencies
- **Emergency Contact Phone**: Emergency contact number
- **Bio/Description**: Personal message about vision and commitment

## Database Schema

### committee_member_details Table
```sql
- id: UUID (PK)
- committee_member_id: UUID (FK to mbg_committee_members) UNIQUE
- full_name: TEXT
- national_id: TEXT
- profile_photo_url: TEXT
- address: TEXT
- alternate_phone: TEXT
- emergency_contact_name: TEXT
- emergency_contact_phone: TEXT
- appointment_letter_url: TEXT
- bio: TEXT
- created_at: TIMESTAMPTZ
- updated_at: TIMESTAMPTZ
```

### RLS Policies
- ✅ Chairpersons can read/insert/update their own details
- ✅ Developers can read all details
- ✅ Service role has full access

## How It Works

### When Chairperson Opens Profile Modal:
1. Loads data from `mbg_user_profiles` (basic info)
2. Gets their `committee_member_id` from `mbg_committee_members`
3. Loads extended data from `committee_member_details`
4. Shows all fields including committee-specific ones

### When Chairperson Saves Profile:
1. Saves basic info to `mbg_user_profiles`
2. Saves committee-specific info to `committee_member_details`
3. Auto-creates record if doesn't exist (upsert)
4. Shows success toast

### When Chairperson Views Dashboard:
1. Calls `get_subordinate_chairpersons()` function
2. Gets list of all subordinates they've assigned
3. Shows their commission rates and regions
4. Can view subordinate profiles

## Testing Steps

### 1. Run SQL Script
```bash
# In Supabase SQL Editor
# Paste content from ADD_COMMITTEE_MEMBER_DETAILS.sql
# Click "Run"
# Should see: ✅ Setup Complete!
```

### 2. Test Profile Modal
1. Login as chairperson
2. Click profile icon (User icon in header)
3. Should see all fields including committee section
4. Fill in alternate phone, emergency contacts, bio
5. Click "Save Changes"
6. Should see success toast
7. Reopen modal - data should persist

### 3. Test Subordinates List
1. As chairperson, go to dashboard
2. Should see list of subordinates (if any assigned)
3. No more 404 errors in console
4. Commission rates should display

## Future Enhancements

### Phase 1 (Completed)
- ✅ Committee member details table
- ✅ Extended profile fields
- ✅ Role-based form sections
- ✅ Auto-save to both tables

### Phase 2 (Next)
- 📸 Photo upload (profile_photo_url field)
- 📄 Appointment letter upload
- 🔍 Public profile view for subordinates
- 📊 Profile completion percentage

### Phase 3 (Future)
- 💬 Internal messaging between chairpersons
- 📈 Performance tracking per chairperson
- 🏆 Achievements and badges
- 📱 Push notifications for profile updates

## Files Created/Modified

### Created:
- `ADD_COMMITTEE_MEMBER_DETAILS.sql` ⭐ **RUN THIS FIRST**
- `FIX_COMMITTEE_PROFILES_COMPLETE.md` (this file)

### Modified:
- `frontend/src/mybodaguy/components/ProfileModal.tsx`

## Support

If issues persist after running SQL:
1. Check Supabase SQL Editor for errors
2. Verify `committee_member_details` table exists
3. Test function: `SELECT * FROM get_subordinate_chairpersons('user-id-here');`
4. Check browser console for detailed errors
5. Verify RLS policies are enabled

## Success Criteria

✅ No 404 errors for `get_subordinate_chairpersons`
✅ No 404 errors for `committee_member_details`
✅ Profile modal shows committee fields for chairpersons
✅ Profile saves successfully with all data
✅ Dashboard loads subordinates list
✅ Chairpersons can view and edit their detailed profiles

---

**Status**: Ready to deploy
**Priority**: HIGH - Blocks chairperson functionality
**Estimated Time**: 5 minutes to run SQL + test
