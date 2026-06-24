# ✅ Testing Checklist - Role Switching System

## Pre-Testing Setup

### 1. Ensure Database Migrations Are Run
Before testing, verify these SQL files have been executed:

```bash
# Check if multi-role system is enabled
SELECT column_name 
FROM information_schema.columns 
WHERE table_name = 'mbg_users' 
AND column_name = 'user_roles';
# Should return: user_roles

# Check if functions exist
SELECT routine_name 
FROM information_schema.routines 
WHERE routine_name IN (
  'get_user_roles', 
  'add_user_role', 
  'user_has_role',
  'mbg_assign_chairperson',
  'mbg_assign_rider'
);
# Should return all 5 functions
```

If missing, run:
1. `ENABLE_MULTI_ROLE_SYSTEM.sql`
2. `CHAIRPERSON_AUTO_RIDER_ASSIGNMENT.sql`

### 2. Verify Your Test User Has Roles
```sql
-- Check your user's roles
SELECT 
  email, 
  user_roles,
  role_type
FROM mbg_users 
WHERE email = 'your-test-email@example.com';

-- Expected results for a chairperson:
-- user_roles: ["chairperson", "rider"]
-- role_type: chairperson
```

If your test user has no roles, assign them:
```sql
-- Assign as chairperson (auto-creates rider role too)
SELECT mbg_assign_chairperson(
  'your-test-email@example.com',    -- target_user_email
  'parish_chairperson',              -- target_role
  'parish',                          -- target_region_type
  'some-parish-id',                  -- target_region_id
  5.00                               -- commission_rate
);
```

---

## Testing the Application

### Step 1: Start Development Server
```bash
cd frontend
npm run dev
```

Wait for: `Local: http://localhost:5173/`

### Step 2: Open in Browser
- Navigate to: `http://localhost:5173/`
- Open Browser DevTools (F12) → Console tab
- Look for: `[UnifiedDashboard] User roles: ["chairperson", "rider"]`

---

## Test Case 1: Multi-Role User (Chairperson + Rider)

### Initial Load
- [ ] Page loads without errors
- [ ] Console shows: `[UnifiedDashboard] User roles: ["chairperson", "rider"]`
- [ ] **Background is orange-yellow gradient**
- [ ] Header shows "My Boda Guy" logo (🏍️)
- [ ] Header shows "Chairperson Dashboard" subtitle
- [ ] Header shows your email (desktop only)
- [ ] Header shows "Sign Out" button
- [ ] **Role tabs visible**: `Chairperson | Rider` (or more)
- [ ] **"Chairperson" tab is active** (white underline)
- [ ] Dashboard content shows: Welcome, Chairperson!
- [ ] Stats grid visible (My Roles, Total Chairpersons, etc.)
- [ ] **NO second header** (should only see one "My Boda Guy" logo)

### Switch to Rider Role
- [ ] Click "Rider" tab at top
- [ ] **Background changes to green-emerald gradient** (instant)
- [ ] Header subtitle changes to "Rider Dashboard"
- [ ] **"Rider" tab now has white underline**
- [ ] "Chairperson" tab becomes semi-transparent
- [ ] Dashboard content changes to rider view
- [ ] See: Today's Earnings, Rides Done, Rating, Mode cards
- [ ] See: Quick Start section with 3 cards
- [ ] See: Rider navigation tabs (Overview, Work Mode, Areas, Markets) - Desktop only
- [ ] **NO second header** (still only one logo)

### Switch Back to Chairperson
- [ ] Click "Chairperson" tab at top
- [ ] **Background changes back to orange-yellow**
- [ ] Header subtitle changes to "Chairperson Dashboard"
- [ ] **"Chairperson" tab has white underline again**
- [ ] Dashboard content returns to chairperson view
- [ ] All previous chairperson data still there (not reloaded)

### Test Functionality While Switching
- [ ] **On Chairperson dashboard**: Click "Assign New" button
- [ ] Modal opens successfully
- [ ] Close modal
- [ ] Switch to "Rider" tab
- [ ] **On Rider dashboard**: Click "Work Mode" tab (desktop) or menu item (mobile)
- [ ] RiderModeSelector component loads
- [ ] See 4 mode badges (VIP, Normal, Discount, Return)
- [ ] Switch back to "Chairperson" tab
- [ ] Chairperson dashboard still works

### Sign Out
- [ ] Click "Sign Out" button in unified header
- [ ] Application logs you out
- [ ] Redirected to login page

---

## Test Case 2: Single Role User (Rider Only)

### Setup
Create a test user with only rider role:
```sql
-- Add rider role only
SELECT add_user_role('test-rider@example.com', 'rider');
```

### Test
- [ ] Login as rider-only user
- [ ] **No role tabs visible** (single role = direct dashboard)
- [ ] See RiderDashboard immediately
- [ ] Background is green-emerald gradient
- [ ] Header shows "Rider Dashboard"
- [ ] All rider features work
- [ ] Rider navigation tabs visible (Overview, Mode, Areas, Markets)

---

## Test Case 3: Mobile Testing

### On Mobile Device or Browser DevTools (Toggle Device Toolbar)

#### Initial View (Chairperson)
- [ ] Header fits in mobile viewport
- [ ] Logo and "My Boda Guy" text visible
- [ ] Sign out button shows as ⚡ icon only (mobile)
- [ ] Role tabs scroll horizontally if needed
- [ ] **"Chairperson" tab has white underline**
- [ ] Background is orange-yellow
- [ ] Dashboard content is responsive

#### Switch to Rider (Mobile)
- [ ] Tap "Rider" tab
- [ ] Background changes to green
- [ ] Rider navigation appears below header
- [ ] Current tab indicator shows (e.g., "⚙️ Overview")
- [ ] Menu button (☰) visible on right
- [ ] Tap menu button (☰)
- [ ] Dropdown shows:
  - Overview
  - Work Mode
  - Areas
  - Markets
  - My Profile
- [ ] Tap "Work Mode"
- [ ] Menu closes
- [ ] RiderModeSelector loads
- [ ] 4 mode badges visible in horizontal scroll
- [ ] Badges are 75px on small screens
- [ ] All badges fit and scroll smoothly

---

## Test Case 4: Profile Modal Access

### From Chairperson Dashboard
- [ ] On Chairperson dashboard (multi-role user)
- [ ] Desktop: Look for profile icon (should NOT be visible - removed)
- [ ] Mobile: Tap ☰ menu (if within dashboard content area)
- [ ] Mobile: See "My Profile" option
- [ ] Tap "My Profile"
- [ ] ProfileModal opens
- [ ] Shows chairperson-specific fields
- [ ] Close modal

### From Rider Dashboard
- [ ] Switch to Rider tab
- [ ] Desktop: Rider internal tabs visible
- [ ] Mobile: Tap ☰ menu button (in rider nav area)
- [ ] See: Overview, Work Mode, Areas, Markets, My Profile
- [ ] Tap "My Profile"
- [ ] ProfileModal opens
- [ ] Shows rider-specific fields
- [ ] Close modal

---

## Console Debugging Checklist

### Expected Console Logs
```
[UnifiedDashboard] User roles: ["chairperson", "rider"]
[ChairpersonDashboard] All assignments: [{...}, {...}]
[RiderDashboard] Loading rider data...
```

### Check for Errors
- [ ] **No red errors in console**
- [ ] No "Unterminated JSX" errors
- [ ] No "Cannot read property" errors
- [ ] No "Failed to fetch" errors (if yes, check Supabase connection)

### If You See Warnings
```
⚠️ [UnifiedDashboard] Chairperson without rider role detected!
```
This means the chairperson doesn't have rider role. Run:
```sql
SELECT add_user_role('user@email.com', 'rider');
```

---

## Visual Regression Checklist

### Things That Should NO LONGER Appear:
- [ ] ❌ Duplicate "My Boda Guy" headers
- [ ] ❌ Two sign out buttons
- [ ] ❌ Chairperson dashboard with its own header (when in UnifiedDashboard)
- [ ] ❌ Rider dashboard with its own main header (when in UnifiedDashboard)

### Things That SHOULD Appear:
- [ ] ✅ Single unified header at top
- [ ] ✅ Role tabs below header
- [ ] ✅ Active tab with white underline
- [ ] ✅ Dynamic background gradient per role
- [ ] ✅ Clean, no duplicate elements
- [ ] ✅ Rider internal navigation (Overview, Mode, Areas, Markets) - these are fine, they're internal to rider dashboard

---

## Performance Checklist

### Tab Switching Speed
- [ ] Clicking tabs switches instantly (< 100ms)
- [ ] Background gradient changes smoothly
- [ ] No flickering or loading spinners
- [ ] Dashboard content swaps immediately

### Data Persistence
- [ ] Switch to Rider, set work mode, switch back to Chairperson, switch to Rider again
- [ ] Rider work mode should still be set (data not lost)

---

## Common Issues & Fixes

### Issue 1: "Unterminated JSX" Error
**Symptom**: Page won't load, error in console
**Fix**: You're likely on an old version. Pull latest changes.

### Issue 2: No Role Tabs Visible
**Symptom**: Dashboard loads but no tabs at top
**Cause**: User has only one role
**Expected**: This is correct behavior! Single role = direct dashboard

### Issue 3: Chairperson Without Rider Role
**Symptom**: Warning in console
**Fix**: 
```sql
SELECT add_user_role('user@email.com', 'rider');
```

### Issue 4: Two Headers Visible
**Symptom**: See "My Boda Guy" logo twice
**Cause**: Old cached version
**Fix**: Hard refresh browser (Ctrl+Shift+R or Cmd+Shift+R)

### Issue 5: Background Not Changing
**Symptom**: Tabs switch but background stays same color
**Cause**: CSS not updating
**Fix**: 
1. Check browser console for errors
2. Verify Tailwind classes are correct
3. Hard refresh browser

---

## Success Criteria

### ✅ All Tests Pass When:
1. No console errors (red text)
2. Single unified header visible
3. Role tabs functional and clearly marked
4. Background changes per active role
5. Dashboard content swaps correctly
6. No duplicate headers anywhere
7. Mobile responsive and functional
8. Sign out works from unified header
9. Profile modals accessible
10. All chairperson features work (assign, stats, etc.)
11. All rider features work (modes, locations, partnerships)

---

## If All Tests Pass: ✅ DEPLOYMENT READY

Congratulations! The role switching system is working correctly.

### Next Steps:
1. Test with real data (assign real chairpersons/riders)
2. User acceptance testing with actual users
3. Deploy to staging environment
4. Final verification before production

---

## If Tests Fail: 🔧 Debugging Steps

1. Check browser console for specific errors
2. Verify database migrations ran successfully
3. Verify user has correct roles in database
4. Check Supabase connection
5. Hard refresh browser to clear cache
6. Check Network tab for failed API calls
7. Review `CLEAN_ROLE_SWITCHING_COMPLETE.md` for implementation details

---

**Testing Guide Status**: ✅ Complete
**Last Updated**: 2026-06-24
**System**: MyBodaGuy Multi-Role Platform
