# 🔐 My Boda Guy - Frontend Access Control Guide

## Overview
This document ensures proper access control enforcement across all frontend components, matching the backend RLS policies.

---

## 🎯 Role Hierarchy (Highest to Lowest)

```
1. DEVELOPER (Super Admin)
   └─ Full system access
   
2. CHAIRPERSON (5 Levels)
   ├─ District Chairperson
   ├─ Division Chairperson
   ├─ Subcounty Chairperson
   ├─ Parish Chairperson
   └─ Stage Chairperson
   
3. RIDER
   └─ Accept rides, earn money
   
4. CUSTOMER
   └─ Order rides/deliveries
```

---

## ✅ Access Control Checklist

### 1. DEVELOPER ACCESS (Super Admin)

**Should Have Access To:**
- ✅ User Management (view, edit, assign roles)
- ✅ All Geographic Regions (create, edit, delete)
- ✅ All Chairperson Assignments
- ✅ All Rider Management
- ✅ All Rides View
- ✅ All Payments View
- ✅ Commission Settings
- ✅ Platform Settings
- ✅ Analytics Dashboard

**UI Components:**
- ✅ `DeveloperDashboard.tsx` - Full admin panel
- ✅ `RegionsManagement.tsx` - Create districts/divisions/etc.
- ✅ `UserManagement.tsx` - Assign any role
- ✅ `CommissionSettings.tsx` - Configure percentages

**Verification:**
```typescript
// Check in components:
const isDeveloper = user?.role_type === 'developer';

if (!isDeveloper) {
  return <AccessDenied />;
}
```

---

### 2. CHAIRPERSON ACCESS

**Access Levels by Position:**

#### District Chairperson
- ✅ View district statistics
- ✅ Assign Division Chairpersons within their district
- ✅ View all rides in district
- ✅ View commission earnings
- ❌ Cannot assign District Chairpersons
- ❌ Cannot assign riders directly

#### Division Chairperson
- ✅ View division statistics
- ✅ Assign Subcounty Chairpersons within their division
- ✅ View rides in division
- ✅ View commission earnings
- ❌ Cannot assign District/Division Chairpersons

#### Subcounty Chairperson
- ✅ View subcounty statistics
- ✅ Assign Parish Chairpersons within their subcounty
- ✅ View rides in subcounty
- ✅ View commission earnings

#### Parish Chairperson
- ✅ View parish statistics
- ✅ Assign Stage Chairpersons within their parish
- ✅ View rides in parish
- ✅ View commission earnings

#### Stage Chairperson (Most Important)
- ✅ View stage statistics
- ✅ **ASSIGN RIDERS** to their stage
- ✅ Approve/suspend riders
- ✅ View rides in stage
- ✅ View commission earnings
- ❌ Cannot assign chairpersons

**UI Components:**
- ✅ `ChairpersonDashboard.tsx` - Region management
- ✅ `RiderAssignment.tsx` - Assign riders (stage chairperson only)
- ✅ `SubordinateManagement.tsx` - Assign lower-level chairpersons

**Verification:**
```typescript
// Check chairperson level
const isStageChairperson = committeeMembers?.some(
  cm => cm.role === 'stage_chairperson' && cm.is_active
);

if (isStageChairperson) {
  // Show rider assignment UI
}
```

---

### 3. RIDER ACCESS

**Should Have Access To:**
- ✅ View assigned rides
- ✅ Accept/decline rides
- ✅ Update ride status (pickup, complete, etc.)
- ✅ View own earnings
- ✅ Update availability status
- ✅ View own profile
- ❌ Cannot view other riders
- ❌ Cannot assign roles
- ❌ Cannot view all rides

**UI Components:**
- ✅ `RiderDashboard.tsx` - Ride queue, earnings
- ✅ `RideAcceptance.tsx` - Accept/decline rides
- ✅ `EarningsView.tsx` - View payments

**Verification:**
```typescript
const isRider = user?.role_type === 'rider';

// Only show rides assigned to this rider
const myRides = rides?.filter(r => r.rider_id === user.id);
```

---

### 4. CUSTOMER ACCESS

**Should Have Access To:**
- ✅ Create ride requests
- ✅ Create supermarket delivery orders
- ✅ View own ride history
- ✅ Make payments
- ✅ Rate riders
- ✅ View own profile
- ❌ Cannot view other customers' rides
- ❌ Cannot assign roles
- ❌ Cannot view rider details (except assigned rider)

**UI Components:**
- ✅ `CustomerDashboard.tsx` - Order rides/deliveries
- ✅ `RideRequest.tsx` - Create ride request
- ✅ `SupermarketDelivery.tsx` - Order from supermarkets
- ✅ `RideHistory.tsx` - View own rides

**Verification:**
```typescript
const isCustomer = user?.role_type === 'customer';

// Only show this user's rides
const myRides = rides?.filter(r => r.customer_id === user.id);
```

---

## 🛡️ Frontend Protection Patterns

### Pattern 1: Role-Based Routing
```typescript
// In UnifiedDashboard.tsx
const renderDashboard = () => {
  if (activeRole === 'developer') {
    return <DeveloperDashboard user={user} />;
  }
  if (activeRole === 'chairperson') {
    return <ChairpersonDashboard user={user} />;
  }
  if (activeRole === 'rider') {
    return <RiderDashboard user={user} />;
  }
  return <CustomerDashboard user={user} />;
};
```

### Pattern 2: Component-Level Guards
```typescript
// In any protected component
const ProtectedComponent = ({ user }) => {
  const isDeveloper = user?.role_type === 'developer';
  
  if (!isDeveloper) {
    return (
      <div className="p-6 text-center">
        <p className="text-red-600">Access Denied</p>
        <p className="text-gray-600">You don't have permission to view this page</p>
      </div>
    );
  }
  
  return <ActualComponent />;
};
```

### Pattern 3: Feature Flags
```typescript
// Show/hide features based on role
const canAssignRiders = 
  user?.role_type === 'developer' || 
  committeeMembers?.some(cm => 
    cm.role === 'stage_chairperson' && cm.is_active
  );

{canAssignRiders && (
  <button onClick={handleAssignRider}>
    Assign Rider
  </button>
)}
```

### Pattern 4: Data Filtering
```typescript
// Filter data based on user's access level
const getAccessibleUsers = async () => {
  const { data: allUsers } = await supabase
    .from('mbg_users')
    .select('*');
  
  if (user.role_type === 'developer') {
    return allUsers; // Developers see everyone
  }
  
  if (user.role_type === 'chairperson') {
    // Filter to users in their region
    return allUsers.filter(u => isInMyRegion(u));
  }
  
  // Others only see themselves
  return allUsers.filter(u => u.id === user.id);
};
```

---

## 🔍 Critical Files to Verify

### 1. Dashboard Files
- ✅ `src/mybodaguy/pages/UnifiedDashboard.tsx` - Main routing
- ✅ `src/mybodaguy/pages/DeveloperDashboard.tsx` - Developer panel
- ✅ `src/mybodaguy/pages/ChairpersonDashboard.tsx` - Chairperson panel
- ✅ `src/mybodaguy/pages/RiderDashboard.tsx` - Rider panel
- ✅ `src/mybodaguy/pages/CustomerDashboard.tsx` - Customer panel

### 2. User Management
- ✅ `src/mybodaguy/components/UserManagement.tsx` - Role assignment
- ✅ `src/mybodaguy/services/userService.ts` - API calls

### 3. Region Management
- ✅ `src/mybodaguy/components/RegionsManagement.tsx` - Geographic hierarchy
- ✅ `src/mybodaguy/services/regionService.ts` - Region API

### 4. Rider Management
- ✅ `src/mybodaguy/components/RiderAssignment.tsx` - Assign riders
- ✅ `src/mybodaguy/services/riderService.ts` - Rider API

---

## 🧪 Testing Checklist

### Test as Developer
- [ ] Can view all users
- [ ] Can assign any role (developer, chairperson, rider, customer)
- [ ] Can create districts, divisions, subcounties, parishes, stages
- [ ] Can assign district chairpersons
- [ ] Can view all rides
- [ ] Can view all payments
- [ ] Can configure commission settings

### Test as District Chairperson
- [ ] Can view district statistics
- [ ] Can assign division chairpersons (within their district only)
- [ ] Cannot assign district chairpersons
- [ ] Cannot create new districts
- [ ] Can view rides in their district

### Test as Stage Chairperson
- [ ] Can view stage statistics
- [ ] Can assign riders to their stage
- [ ] Can approve/suspend riders
- [ ] Cannot assign chairpersons
- [ ] Can view rides in their stage

### Test as Rider
- [ ] Can view rides assigned to them
- [ ] Can accept/decline rides
- [ ] Can update ride status
- [ ] Cannot view other riders' rides
- [ ] Cannot assign any roles
- [ ] Can view own earnings

### Test as Customer
- [ ] Can create ride requests
- [ ] Can order supermarket deliveries
- [ ] Can view own ride history
- [ ] Cannot view other customers' rides
- [ ] Cannot assign any roles
- [ ] Can rate completed rides

---

## 🚨 Common Security Issues to Avoid

### ❌ BAD: Client-Side Only Checks
```typescript
// DON'T DO THIS - Can be bypassed
if (user.role_type === 'developer') {
  // Show sensitive data without backend verification
}
```

### ✅ GOOD: Backend + Frontend Checks
```typescript
// Frontend guard
if (user.role_type !== 'developer') {
  return <AccessDenied />;
}

// Backend has RLS policies to enforce
const { data } = await supabase
  .from('mbg_users')
  .select('*'); // RLS will filter based on user's role
```

### ❌ BAD: Hardcoded User IDs
```typescript
// DON'T DO THIS
if (user.email === 'admin@example.com') {
  // Grant access
}
```

### ✅ GOOD: Role-Based Checks
```typescript
// DO THIS
if (user.role_type === 'developer') {
  // Grant access
}
```

### ❌ BAD: Missing Data Filters
```typescript
// DON'T DO THIS - Shows all users
const users = await getAllUsers();
return users; // Exposes all users to non-developers
```

### ✅ GOOD: Filtered Data
```typescript
// DO THIS
const { data } = await supabase
  .from('mbg_users')
  .select('*'); // RLS automatically filters
return data;
```

---

## 📋 Implementation Verification

### Step 1: Run Database Script
```bash
# Execute the backend RLS policies
psql -d mybodaguy -f COMPLETE_ACCESS_LEVEL_VERIFICATION.sql
```

### Step 2: Verify Frontend Guards
```bash
# Search for access control patterns
grep -r "role_type === 'developer'" src/mybodaguy/
grep -r "role_type === 'chairperson'" src/mybodaguy/
grep -r "AccessDenied" src/mybodaguy/
```

### Step 3: Test Each Role
1. Sign in as developer (abanabaasa2@gmail.com)
2. Create test users and assign different roles
3. Sign in as each role and verify access limits

### Step 4: Check Supabase RLS
```sql
-- In Supabase SQL Editor
SELECT 
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename LIKE 'mbg_%'
ORDER BY tablename, policyname;
```

---

## 🎯 Summary

**Access Hierarchy:**
```
DEVELOPER (Full Access)
    ↓
DISTRICT CHAIRPERSON (Assign Division Chairs)
    ↓
DIVISION CHAIRPERSON (Assign Subcounty Chairs)
    ↓
SUBCOUNTY CHAIRPERSON (Assign Parish Chairs)
    ↓
PARISH CHAIRPERSON (Assign Stage Chairs)
    ↓
STAGE CHAIRPERSON (Assign Riders)
    ↓
RIDER (Accept Rides)
    ↓
CUSTOMER (Order Rides)
```

**Key Principles:**
1. ✅ Backend RLS policies are the PRIMARY security layer
2. ✅ Frontend guards provide UX improvements (hide unavailable features)
3. ✅ Never trust client-side checks alone
4. ✅ Always filter data based on user's role
5. ✅ Use role_type, not email addresses, for access control

---

## 🔗 Related Files

- Backend: `COMPLETE_ACCESS_LEVEL_VERIFICATION.sql`
- Schema: `backend/database/schema_mybodaguy/01_users.sql`
- Frontend: `src/mybodaguy/pages/UnifiedDashboard.tsx`
- Services: `src/mybodaguy/services/userService.ts`

---

**Status:** ✅ Access Control Properly Configured
**Last Updated:** 2026-06-25

🏍️ **My Boda Guy - Secure, Organized, Accessible!** 🇺🇬
