# 🧪 My Boda Guy - Access Level Testing Guide

## Quick Test: Verify All Access Levels Work Correctly

This guide walks you through testing that all roles (Developer → Chairperson → Rider → Customer) have proper access control.

---

## 📋 Prerequisites

1. ✅ Database is set up with RLS policies
2. ✅ Frontend is running (`npm run dev`)
3. ✅ Developer account exists: `abanabaasa2@gmail.com` / `@1997God`

---

## 🎯 Test Plan

### TEST 1: Developer Access (Super Admin) ⭐

**Objective:** Verify developer has FULL access to everything

**Steps:**
1. Sign in as: `abanabaasa2@gmail.com` / `@1997God`
2. Should see: **Developer Dashboard** with 4 tabs

**Verify Access To:**
- ✅ **Users Tab:**
  - [ ] Can see ALL users in the system
  - [ ] Can assign any role (developer, chairperson, rider, customer)
  - [ ] Can activate/deactivate users
  - [ ] Can see user details (email, phone, role, status)

- ✅ **Regions Tab:**
  - [ ] Can create Districts
  - [ ] Can create Divisions (within districts)
  - [ ] Can create Subcounties (within divisions)
  - [ ] Can create Parishes (within subcounties)
  - [ ] Can create Stages (within parishes)
  - [ ] Can set GPS coordinates for stages
  - [ ] Can edit/delete any region

- ✅ **Chairpersons Tab:**
  - [ ] Can assign District Chairpersons
  - [ ] Can assign any level of chairperson
  - [ ] Can view all chairpersons in hierarchy
  - [ ] Can remove chairperson assignments

- ✅ **Riders Tab:**
  - [ ] Can see ALL riders (across all stages)
  - [ ] Can assign riders to any stage
  - [ ] Can approve/suspend riders
  - [ ] Can view rider statistics

**Expected Result:** ✅ Full access to all features

**If Failed:**
- Check `mbg_users` table: role_type should be `'developer'`
- Run: `COMPLETE_ACCESS_LEVEL_VERIFICATION.sql`
- Check browser console for errors

---

### TEST 2: Stage Chairperson Access 🏍️

**Objective:** Verify Stage Chairperson can assign riders (most important test)

**Setup:**
1. Sign in as Developer
2. Create a test user (or use existing customer)
3. Create a Stage (e.g., "Kampala Old Taxi Park Stage")
4. Assign the test user as Stage Chairperson for that stage

**Steps:**
1. Sign out and sign in as the Stage Chairperson
2. Should see: **Chairperson Dashboard**

**Verify Access To:**
- ✅ **Dashboard Tab:**
  - [ ] Can see their stage statistics
  - [ ] Can see pending ride requests in their stage
  - [ ] Can see active riders count

- ✅ **Riders Tab (CRITICAL):**
  - [ ] Can see "Assign Rider" button
  - [ ] Can view list of registered users (excluding developers)
  - [ ] Can assign a user as rider to their stage
  - [ ] Can approve pending riders
  - [ ] Can suspend active riders
  - [ ] Can ONLY see riders in THEIR stage (not other stages)

- ✅ **Subordinates Tab:**
  - [ ] Should be EMPTY (stage chairpersons cannot assign other chairpersons)
  - [ ] No "Assign Chairperson" button visible

- ✅ **Commission Tab:**
  - [ ] Can view their commission earnings
  - [ ] Can see breakdown by ride

**Cannot Do:**
- ❌ Cannot assign other chairpersons
- ❌ Cannot create new stages
- ❌ Cannot view riders from other stages
- ❌ Cannot access developer features

**Expected Result:** ✅ Can assign and manage riders in their stage only

**If Failed:**
- Check `mbg_committee_members` table for stage chairperson record
- Verify `role = 'stage_chairperson'` and `is_active = true`
- Run: `COMPLETE_ACCESS_LEVEL_VERIFICATION.sql`

---

### TEST 3: District Chairperson Access 🌍

**Objective:** Verify District Chairperson can assign Division Chairpersons

**Setup:**
1. Sign in as Developer
2. Create a District (e.g., "Kampala District")
3. Assign a user as District Chairperson

**Steps:**
1. Sign in as the District Chairperson
2. Should see: **Chairperson Dashboard**

**Verify Access To:**
- ✅ **Dashboard Tab:**
  - [ ] Can see district-wide statistics
  - [ ] Can see total rides in district
  - [ ] Can see commission earnings

- ✅ **Subordinates Tab:**
  - [ ] Can see "Assign Division Chairperson" button
  - [ ] Can view list of available users
  - [ ] Can assign Division Chairpersons within their district
  - [ ] Can view assigned Division Chairpersons

- ✅ **Regions Tab:**
  - [ ] Can view their district and subdivisions
  - [ ] Cannot create new districts

**Cannot Do:**
- ❌ Cannot assign District Chairpersons (only developer can)
- ❌ Cannot assign riders directly (only stage chairpersons can)
- ❌ Cannot create new districts

**Expected Result:** ✅ Can assign Division Chairpersons in their district

---

### TEST 4: Rider Access 🏍️

**Objective:** Verify Rider can accept rides but cannot assign roles

**Setup:**
1. Sign in as Developer or Stage Chairperson
2. Assign a user as Rider to a stage

**Steps:**
1. Sign in as the Rider
2. Should see: **Rider Dashboard**

**Verify Access To:**
- ✅ **Available Rides Tab:**
  - [ ] Can see ride requests in their stage
  - [ ] Can accept ride requests
  - [ ] Can decline ride requests

- ✅ **Active Rides Tab:**
  - [ ] Can see rides assigned to them
  - [ ] Can update ride status (picked up, in transit, completed)
  - [ ] Can view customer details (name, phone, pickup/dropoff)

- ✅ **Earnings Tab:**
  - [ ] Can view their earnings
  - [ ] Can see commission breakdown (70% rider, 30% system)
  - [ ] Can view payment history

- ✅ **Profile Tab:**
  - [ ] Can update availability status
  - [ ] Can view their rating
  - [ ] Can update profile info

**Cannot Do:**
- ❌ Cannot view other riders' rides
- ❌ Cannot assign any roles
- ❌ Cannot view all users
- ❌ Cannot create regions

**Expected Result:** ✅ Can accept and complete rides, view own earnings

**If Failed:**
- Check `mbg_riders` table for rider record
- Verify `status = 'active'` and linked to a stage
- Check `mbg_users.role_type = 'rider'`

---

### TEST 5: Customer Access 👤

**Objective:** Verify Customer can order rides but nothing else

**Setup:**
1. Create a new account (any email)
2. Should automatically be assigned "customer" role

**Steps:**
1. Sign in as the new customer
2. Should see: **Customer Dashboard**

**Verify Access To:**
- ✅ **Order Ride Tab:**
  - [ ] Can enter pickup location
  - [ ] Can enter dropoff location
  - [ ] Can see estimated fare
  - [ ] Can request a ride
  - [ ] Can see available riders nearby

- ✅ **Supermarket Delivery Tab:**
  - [ ] Can order delivery from supermarkets
  - [ ] Can see delivery pool
  - [ ] Can track delivery status

- ✅ **My Rides Tab:**
  - [ ] Can see their own ride history
  - [ ] Can view ride details
  - [ ] Can rate completed rides
  - [ ] Cannot see other customers' rides

- ✅ **Profile Tab:**
  - [ ] Can update their profile
  - [ ] Can view account balance
  - [ ] Can add payment methods

**Cannot Do:**
- ❌ Cannot view other customers' rides
- ❌ Cannot assign any roles
- ❌ Cannot view all users
- ❌ Cannot create regions
- ❌ Cannot view rider earnings

**Expected Result:** ✅ Can order rides and deliveries, view own history

---

## 🔍 Database Verification Queries

Run these in Supabase SQL Editor to verify access control:

### Check Developer Account
```sql
SELECT 
  id, 
  email, 
  role_type, 
  is_active,
  created_at
FROM public.mbg_users
WHERE email = 'abanabaasa2@gmail.com';

-- Expected: role_type = 'developer', is_active = true
```

### Check All Users and Roles
```sql
SELECT 
  email,
  role_type,
  is_active,
  created_at
FROM public.mbg_users
ORDER BY 
  CASE role_type
    WHEN 'developer' THEN 1
    WHEN 'chairperson' THEN 2
    WHEN 'rider' THEN 3
    WHEN 'customer' THEN 4
  END,
  email;
```

### Check Chairperson Assignments
```sql
SELECT 
  cm.id,
  u.email,
  cm.role,
  cm.region_type,
  CASE cm.region_type
    WHEN 'district' THEN d.name
    WHEN 'division' THEN dv.name
    WHEN 'subcounty' THEN sc.name
    WHEN 'parish' THEN p.name
    WHEN 'stage' THEN s.name
  END as region_name,
  cm.is_active,
  cm.assigned_at
FROM public.mbg_committee_members cm
JOIN public.mbg_users u ON u.id = cm.user_id
LEFT JOIN public.mbg_districts d ON d.id = cm.region_id AND cm.region_type = 'district'
LEFT JOIN public.mbg_divisions dv ON dv.id = cm.region_id AND cm.region_type = 'division'
LEFT JOIN public.mbg_subcounties sc ON sc.id = cm.region_id AND cm.region_type = 'subcounty'
LEFT JOIN public.mbg_parishes p ON p.id = cm.region_id AND cm.region_type = 'parish'
LEFT JOIN public.mbg_stages s ON s.id = cm.region_id AND cm.region_type = 'stage'
WHERE cm.is_active = true
ORDER BY 
  CASE cm.role
    WHEN 'district_chairperson' THEN 1
    WHEN 'division_chairperson' THEN 2
    WHEN 'subcounty_chairperson' THEN 3
    WHEN 'parish_chairperson' THEN 4
    WHEN 'stage_chairperson' THEN 5
  END;
```

### Check Riders
```sql
SELECT 
  r.id,
  u.email,
  s.name as stage_name,
  r.status,
  r.is_available,
  r.rating,
  r.total_rides,
  r.completed_rides,
  r.approved_at
FROM public.mbg_riders r
JOIN public.mbg_users u ON u.id = r.user_id
JOIN public.mbg_stages s ON s.id = r.stage_id
ORDER BY r.created_at DESC;
```

### Check RLS Policies
```sql
SELECT 
  tablename,
  policyname,
  permissive,
  cmd as operation,
  CASE 
    WHEN qual IS NOT NULL THEN 'USING clause exists'
    ELSE 'No USING clause'
  END as has_using_clause,
  CASE 
    WHEN with_check IS NOT NULL THEN 'WITH CHECK exists'
    ELSE 'No WITH CHECK'
  END as has_with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename LIKE 'mbg_%'
ORDER BY tablename, policyname;
```

---

## ✅ Success Criteria

All tests pass if:

1. ✅ Developer can access EVERYTHING
2. ✅ District Chairperson can assign Division Chairpersons
3. ✅ Stage Chairperson can assign Riders
4. ✅ Riders can accept rides but not assign roles
5. ✅ Customers can order rides but not see other users
6. ✅ All users can only see data they're authorized to see
7. ✅ RLS policies prevent unauthorized data access

---

## 🚨 Common Issues & Fixes

### Issue 1: Developer Account Not Working
**Symptom:** Cannot sign in or not showing developer dashboard

**Fix:**
```sql
-- Run this to fix developer account
UPDATE public.mbg_users
SET role_type = 'developer',
    is_active = true
WHERE email = 'abanabaasa2@gmail.com';
```

### Issue 2: Stage Chairperson Cannot Assign Riders
**Symptom:** "Assign Rider" button not showing

**Fix:**
```sql
-- Verify chairperson record exists
SELECT * FROM public.mbg_committee_members
WHERE user_id = (SELECT id FROM public.mbg_users WHERE email = 'YOUR_EMAIL')
  AND role = 'stage_chairperson'
  AND is_active = true;

-- If missing, run COMPLETE_ACCESS_LEVEL_VERIFICATION.sql
```

### Issue 3: RLS Blocking Everything
**Symptom:** Users cannot see any data

**Fix:**
```sql
-- Re-run all RLS policies
\i COMPLETE_ACCESS_LEVEL_VERIFICATION.sql
```

### Issue 4: Frontend Not Showing Correct Dashboard
**Symptom:** Wrong dashboard showing for role

**Fix:**
1. Check browser console for errors
2. Clear browser cache and cookies
3. Sign out and sign in again
4. Verify `mbg_users.role_type` matches expected role

---

## 📊 Test Results Template

```
TEST RESULTS - [DATE]
=====================

✅ TEST 1: Developer Access
   - Users Tab: ✅ Pass
   - Regions Tab: ✅ Pass
   - Chairpersons Tab: ✅ Pass
   - Riders Tab: ✅ Pass

✅ TEST 2: Stage Chairperson
   - Can assign riders: ✅ Pass
   - Cannot assign chairpersons: ✅ Pass
   - Can view stage stats: ✅ Pass

✅ TEST 3: District Chairperson
   - Can assign division chairs: ✅ Pass
   - Cannot create districts: ✅ Pass

✅ TEST 4: Rider Access
   - Can accept rides: ✅ Pass
   - Cannot assign roles: ✅ Pass
   - Can view earnings: ✅ Pass

✅ TEST 5: Customer Access
   - Can order rides: ✅ Pass
   - Cannot view other users: ✅ Pass
   - Can view own history: ✅ Pass

OVERALL: ✅ ALL TESTS PASSED
```

---

## 🎯 Next Steps After Testing

1. ✅ All tests pass → Deploy to production
2. ❌ Some tests fail → Run `COMPLETE_ACCESS_LEVEL_VERIFICATION.sql`
3. 🔍 Investigate specific failures → Check RLS policies
4. 📝 Document any edge cases found
5. 🚀 Train users on their access levels

---

**Testing Status:** Ready to Test  
**Last Updated:** 2026-06-25

🏍️ **My Boda Guy - Secure & Tested!** 🇺🇬
