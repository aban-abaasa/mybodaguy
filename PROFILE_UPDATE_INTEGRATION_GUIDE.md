# Profile Update Integration Guide

## What Was Created

### 1. Universal Profile Modal Component
**File**: `frontend/src/mybodaguy/components/ProfileModal.tsx`

**Features**:
- ✅ Works for ALL roles (Developer, Chairperson, Rider, Customer)
- ✅ Full profile editing (name, phone, DOB, gender, ID, address)
- ✅ Auto-saves to `mbg_user_profiles` table
- ✅ Beautiful, responsive UI
- ✅ Loading and saving states
- ✅ Toast notifications for success/errors

### 2. Database Setup Script
**File**: `ENSURE_USER_PROFILES_COMPLETE.sql`

**Actions**:
- Adds all necessary columns to `mbg_user_profiles`
- Sets up RLS policies (users can read/update own profile)
- Creates indexes for performance

## How to Integrate Into Each Dashboard

### Step 1: Run SQL Setup
```sql
-- Run this in Supabase SQL Editor
-- File: ENSURE_USER_PROFILES_COMPLETE.sql
```

### Step 2: Import ProfileModal in Each Dashboard

#### For ChairpersonDashboard.tsx
```typescript
import ProfileModal from '../components/ProfileModal';

// Add state
const [showProfileModal, setShowProfileModal] = useState(false);

// Add button in header
<button
  onClick={() => setShowProfileModal(true)}
  className="flex items-center gap-2 px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg transition-colors"
>
  <Edit size={18} />
  <span className="hidden sm:inline">Edit Profile</span>
</button>

// Add modal at end of component
<ProfileModal
  user={user}
  userRole="chairperson"
  isOpen={showProfileModal}
  onClose={() => setShowProfileModal(false)}
  onSaved={() => {
    // Optional: reload dashboard data
  }}
/>
```

#### For DeveloperDashboard.tsx
```typescript
import ProfileModal from '../components/ProfileModal';
import { Edit } from 'lucide-react';

const [showProfileModal, setShowProfileModal] = useState(false);

// In header, add Edit Profile button
<button
  onClick={() => setShowProfileModal(true)}
  className="flex items-center gap-2 px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg transition-colors"
>
  <Edit size={18} />
  <span>Profile</span>
</button>

// Add modal
<ProfileModal
  user={user}
  userRole="developer"
  isOpen={showProfileModal}
  onClose={() => setShowProfileModal(false)}
/>
```

#### For RiderDashboard.tsx
```typescript
import ProfileModal from '../components/ProfileModal';

const [showProfileModal, setShowProfileModal] = useState(false);

// Add Edit Profile button
<button onClick={() => setShowProfileModal(true)}>
  <Edit size={18} />
  Profile
</button>

// Add modal
<ProfileModal
  user={user}
  userRole="rider"
  isOpen={showProfileModal}
  onClose={() => setShowProfileModal(false)}
/>
```

#### For CustomerDashboard.tsx
```typescript
import ProfileModal from '../components/ProfileModal';

const [showProfileModal, setShowProfileModal] = useState(false);

// Add Edit Profile button
<button onClick={() => setShowProfileModal(true)}>
  <Edit size={18} />
  Profile
</button>

// Add modal
<ProfileModal
  user={user}
  userRole="customer"
  isOpen={showProfileModal}
  onClose={() => setShowProfileModal(false)}
/>
```

## Profile Fields

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| full_name | Yes | Text | User's full name |
| phone | No | Text | Phone number (+256...) |
| date_of_birth | No | Date | Birth date |
| gender | No | Select | male/female/other |
| national_id | No | Text | National ID number |
| address | No | Textarea | Physical address |
| city | No | Text | City/Town |
| country | Read-only | Text | Default: Uganda |
| email | Read-only | Text | From auth.users |

## Database Structure

### Table: mbg_user_profiles
```sql
- id: UUID (PK)
- user_id: UUID (FK to mbg_users) UNIQUE
- full_name: TEXT
- phone: TEXT
- date_of_birth: DATE
- gender: TEXT
- national_id: TEXT
- address: TEXT
- city: TEXT
- country: TEXT (default 'Uganda')
- avatar_url: TEXT
- created_at: TIMESTAMPTZ
- updated_at: TIMESTAMPTZ
```

### RLS Policies
- Users can read their own profile
- Users can insert their own profile
- Users can update their own profile
- Developers can read all profiles
- Service role has full access

## Testing Checklist

### For Each Role:
- [ ] Click "Edit Profile" button
- [ ] Modal opens with current profile data
- [ ] Edit fields and save
- [ ] Success toast appears
- [ ] Modal closes
- [ ] Reopen modal - changes persist
- [ ] Cancel button works
- [ ] X button closes modal
- [ ] Click outside doesn't close (optional enhancement)

## UI/UX Features

✅ **Role-specific header** - Shows user's role in modal title
✅ **Loading state** - Spinner while loading profile
✅ **Saving state** - Button shows "Saving..." with spinner
✅ **Form validation** - Required fields enforced
✅ **Responsive design** - Works on mobile, tablet, desktop
✅ **Toast notifications** - Success and error messages
✅ **Disabled fields** - Email cannot be changed
✅ **Help text** - Explanatory text for certain fields

## Next Enhancements (Future)

1. **Avatar Upload**
   - Add file upload for profile photo
   - Store in Supabase Storage
   - Display avatar in dashboard

2. **Profile Completion Progress**
   - Show percentage of completed fields
   - Encourage users to complete profile

3. **Email Change Request**
   - Allow users to request email change
   - Admin approval flow

4. **2FA Setup**
   - Add two-factor authentication setup
   - Phone verification

5. **Profile Visibility Settings**
   - Control what other users can see
   - Privacy settings

## Support

If users encounter issues:
1. Check browser console for errors
2. Verify `mbg_user_profiles` table exists
3. Confirm RLS policies are set correctly
4. Ensure user is authenticated
5. Check Supabase project is online

## Files Modified/Created

### Created:
- `frontend/src/mybodaguy/components/ProfileModal.tsx`
- `ENSURE_USER_PROFILES_COMPLETE.sql`
- `PROFILE_UPDATE_INTEGRATION_GUIDE.md` (this file)

### To Modify:
- `frontend/src/mybodaguy/pages/ChairpersonDashboard.tsx`
- `frontend/src/mybodaguy/pages/DeveloperDashboard.tsx`
- `frontend/src/mybodaguy/pages/RiderDashboard.tsx`
- `frontend/src/mybodaguy/pages/CustomerDashboard.tsx`
