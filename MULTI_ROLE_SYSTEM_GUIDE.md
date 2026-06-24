# Multi-Role System Implementation Guide 🎭

## Overview
The MyBodaGuy platform now supports **multiple simultaneous roles** for each user. A single user can be a District Chairperson, Stage Chairperson, AND a Rider at the same time!

---

## Key Features

### ✅ Multi-Role Support
- Users can hold multiple roles: `developer`, `chairperson`, `rider`, `customer`
- Roles are stored in an array (`user_roles`) in `mbg_users` table
- Users can switch between their roles seamlessly

### ✅ Automatic Role Assignment
- When assigning a chairperson → automatically adds 'chairperson' role
- When assigning a rider → automatically adds 'rider' role
- Roles accumulate - they don't replace each other

### ✅ Unified Dashboard
- Smart role switcher in header
- One-click switching between roles
- Shows all available dashboards based on user's roles

---

## Database Changes

### 1. New Column in `mbg_users`
```sql
-- Array of roles instead of single role
user_roles text[] DEFAULT ARRAY['customer']::text[]
```

### 2. New Functions

#### `get_user_roles(user_id)`
Returns array of all roles for a user
```sql
SELECT public.get_user_roles('USER_ID_HERE');
-- Returns: ['chairperson', 'rider', 'customer']
```

#### `add_user_role(user_id, role)`
Adds a new role to user (doesn't duplicate)
```sql
SELECT public.add_user_role('USER_ID_HERE', 'rider');
```

#### `remove_user_role(user_id, role)`
Removes a specific role from user
```sql
SELECT public.remove_user_role('USER_ID_HERE', 'customer');
```

#### `user_has_role(user_id, role)`
Checks if user has a specific role
```sql
SELECT public.user_has_role('USER_ID_HERE', 'chairperson');
-- Returns: true or false
```

---

## Setup Instructions

### Step 1: Run SQL Migration
```bash
# In Supabase SQL Editor, run:
ENABLE_MULTI_ROLE_SYSTEM.sql
```

This will:
- Add `user_roles` column
- Migrate existing `role_type` to array format
- Create helper functions
- Update assignment functions

### Step 2: Verify Migration
```sql
-- Check your user roles
SELECT id, email, role_type, user_roles 
FROM mbg_users 
WHERE email = 'your@email.com';
```

### Step 3: Test Frontend
The frontend will automatically:
- Load all user roles
- Show role switcher if user has multiple roles
- Allow seamless switching

---

## Usage Examples

### Example 1: Make User Both Chairperson AND Rider

```sql
-- 1. Assign as District Chairperson
SELECT public.mbg_assign_chairperson(
  'user@example.com',
  'district_chairperson',
  'district',
  'DISTRICT_ID_HERE',
  5.00
);
-- ✅ User now has: ['customer', 'chairperson']

-- 2. Also assign as Stage Chairperson
SELECT public.mbg_assign_chairperson(
  'user@example.com',
  'stage_chairperson',
  'stage',
  'STAGE_ID_HERE',
  5.00
);
-- ✅ User still has: ['customer', 'chairperson']
-- (chairperson role not duplicated)

-- 3. Also assign as Rider
SELECT public.mbg_assign_rider(
  'user@example.com',
  'STAGE_ID_HERE',
  'motorcycle',
  'UBE123A',
  'DL123456'
);
-- ✅ User now has: ['customer', 'chairperson', 'rider']

-- 4. Check final roles
SELECT public.get_user_roles('USER_ID_HERE');
-- Returns: ['customer', 'chairperson', 'rider']
```

###  Example 2: District Chairperson Who Rides

```sql
-- Step 1: Assign as District Chairperson (top level)
SELECT public.mbg_assign_chairperson(
  'boss@mybodaguy.com',
  'district_chairperson',
  'district',
  (SELECT id FROM mbg_districts WHERE name = 'Kampala District'),
  10.00 -- Higher commission for district level
);

-- Step 2: Also assign as Rider in a specific stage
SELECT public.mbg_assign_rider(
  'boss@mybodaguy.com',
  (SELECT id FROM mbg_stages WHERE name = 'Old Taxi Park Stage'),
  'motorcycle',
  'UBE789X',
  'DL789012',
  '2025-12-31'
);

-- This user can now:
-- ✅ Manage all subordinate chairpersons (District Dashboard)
-- ✅ Accept ride requests and earn money (Rider Dashboard)
-- ✅ Switch between roles with one click
```

---

## Frontend Integration

### UnifiedDashboard Component
The new `UnifiedDashboard.tsx` automatically:

1. **Loads all user roles** on mount
2. **Determines primary role** based on priority:
   - Developer (highest)
   - Chairperson
   - Rider
   - Customer (lowest)
3. **Shows role switcher** if user has multiple roles
4. **Renders active dashboard** based on selected role

### Role Switcher UI
- Located in header (top-right on desktop, accessible on mobile)
- Shows all available roles as clickable cards
- Active role highlighted in orange
- Instant switching with toast notification

### Service Layer
New `userService` methods:
```typescript
// Get all roles for user
const roles = await userService.getUserRoles(userId);
// Returns: ['chairperson', 'rider']

// Check if user has specific role
const isRider = await userService.userHasRole(userId, 'rider');
// Returns: true or false

// Add role to user
await userService.addUserRole(userId, 'rider');

// Remove role from user
await userService.removeUserRole(userId, 'customer');
```

---

## User Experience Flow

### Scenario: User with 3 Roles

1. **User logs in**
   - System loads: `['chairperson', 'rider', 'customer']`
   - Auto-selects 'chairperson' (higher priority)
   - Shows Chairperson Dashboard

2. **User clicks role switcher**
   - Dropdown shows 3 role cards:
     - 🏢 Chairperson (Manage regions) - **Active**
     - 🏍️ Rider (Ride management)
     - 👤 Customer (Book rides)

3. **User clicks "Rider"**
   - Toast: "Switched to Rider"
   - Rider Dashboard instantly loads
   - Header color changes to green gradient
   - Role switcher updates

4. **User switches to "Customer"**
   - Customer Dashboard loads
   - Can now book rides like a regular customer

---

## Role Hierarchy & Permissions

### Developer
- **Can do everything**
- Manage all users
- Assign any roles
- Full system access

### Chairperson (All Levels)
- Manage subordinate chairpersons
- View commission reports
- Assign riders (Stage Chairpersons only)
- Can ALSO be a rider or customer

### Rider
- Accept ride requests
- Manage work modes (VIP, Discount, Return)
- Set preferred locations
- Can ALSO be a chairperson or customer

### Customer
- Book rides
- View ride history
- Rate riders
- Default role for everyone

---

## Business Logic

### Automatic Role Addition
```sql
-- When you assign someone as chairperson:
mbg_assign_chairperson() 
  → Adds 'chairperson' to user_roles[]
  → Creates entry in mbg_committee_members

-- When you assign someone as rider:
mbg_assign_rider()
  → Adds 'rider' to user_roles[]
  → Creates entry in mbg_riders
```

### Role Accumulation
- Roles **ADD UP**, they don't replace
- A District Chairperson can become a Stage Chairperson (has multiple committee assignments)
- A Stage Chairperson can become a Rider
- A Rider can become a Customer (everyone is a customer by default)

### Role Removal (Manual)
```sql
-- Only remove role if no longer needed
SELECT public.remove_user_role('USER_ID', 'rider');

-- Note: This doesn't delete records from mbg_riders or mbg_committee_members
-- It only removes the role from user_roles array
```

---

## Migration from Old System

### Before (Single Role):
```sql
mbg_users:
  id | email          | role_type   
-----|----------------|-------------
  1  | user@test.com  | chairperson
```

### After (Multi-Role):
```sql
mbg_users:
  id | email          | role_type   | user_roles
-----|----------------|-------------|----------------------------
  1  | user@test.com  | chairperson | ['chairperson', 'rider']
```

**Notes:**
- `role_type` still exists for backward compatibility
- `user_roles` is the new source of truth
- Migration script automatically converts existing roles

---

## Testing Checklist

### Database Tests:
- [ ] Run `ENABLE_MULTI_ROLE_SYSTEM.sql`
- [ ] Verify `user_roles` column exists
- [ ] Test `get_user_roles()` function
- [ ] Test `add_user_role()` function
- [ ] Test `mbg_assign_chairperson()` adds role
- [ ] Test `mbg_assign_rider()` adds role

### Frontend Tests:
- [ ] User with 1 role sees single dashboard
- [ ] User with 2+ roles sees role switcher
- [ ] Switching roles changes dashboard instantly
- [ ] Active role highlighted correctly
- [ ] Header color changes with role
- [ ] Sign out works from any role

### Integration Tests:
- [ ] Assign user as chairperson → verify role added
- [ ] Assign same user as rider → verify both roles exist
- [ ] Switch between roles → both dashboards work
- [ ] Chairperson features accessible in chairperson view
- [ ] Rider features accessible in rider view

---

## Troubleshooting

### Issue: Role switcher doesn't appear
**Solution:**
```sql
-- Check if user has multiple roles
SELECT public.get_user_roles('USER_ID_HERE');

-- If only one role, add another:
SELECT public.add_user_role('USER_ID_HERE', 'rider');
```

### Issue: Old single role still used
**Solution:**
```sql
-- Force migration of specific user
UPDATE mbg_users
SET user_roles = ARRAY[role_type]::text[]
WHERE id = 'USER_ID_HERE';
```

### Issue: Functions don't exist
**Solution:**
```bash
# Re-run the SQL migration
Run: ENABLE_MULTI_ROLE_SYSTEM.sql in Supabase SQL Editor
```

---

## API Reference

### Database Functions

```sql
-- Get all roles
get_user_roles(target_user_id uuid) RETURNS text[]

-- Add role (idempotent - won't duplicate)
add_user_role(target_user_id uuid, new_role text) RETURNS boolean

-- Remove role
remove_user_role(target_user_id uuid, role_to_remove text) RETURNS boolean

-- Check if user has role
user_has_role(target_user_id uuid, role_to_check text) RETURNS boolean
```

### Frontend Service Methods

```typescript
// UserService
getUserRoles(userId: string): Promise<string[]>
addUserRole(userId: string, role: string): Promise<boolean>
removeUserRole(userId: string, role: string): Promise<boolean>
userHasRole(userId: string, role: string): Promise<boolean>
```

---

## Future Enhancements

### Potential Features:
1. **Role-specific notifications**
   - Chairperson: subordinate activity alerts
   - Rider: new ride requests
   - Customer: ride status updates

2. **Role permissions granularity**
   - Custom permissions per role
   - Feature flags per role

3. **Role analytics**
   - Track which role users use most
   - Optimize UI based on usage patterns

4. **Role-based commissions**
   - Earn commission as chairperson
   - Earn ride fees as rider
   - Combined earnings dashboard

---

## Summary

✅ **Database**: Multi-role support via `user_roles` array  
✅ **Functions**: Add, remove, check roles programmatically  
✅ **Frontend**: Unified dashboard with role switcher  
✅ **UX**: Seamless role switching, clear visual indicators  
✅ **Business Logic**: Roles accumulate, automatic assignment  

**Result**: Users can now be **District Chairperson + Stage Chairperson + Rider** all at once, with easy switching between each role's dashboard! 🎉
