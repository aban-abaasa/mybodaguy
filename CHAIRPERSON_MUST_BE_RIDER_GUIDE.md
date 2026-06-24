# Chairperson = Rider Requirement 🏍️

## Policy
**EVERY CHAIRPERSON MUST ALSO BE A RIDER**

This ensures all chairpersons understand the rider experience and can actively participate in the platform.

---

## Implementation

### ✅ Automatic Assignment
When you assign someone as a chairperson, they are **automatically** assigned as a rider too:

```sql
-- Assign as District Chairperson
SELECT public.mbg_assign_chairperson(
  'john@example.com',
  'district_chairperson',
  'district',
  'DISTRICT_ID',
  10.00
);

-- Result:
-- ✅ John is now District Chairperson
-- ✅ John is ALSO automatically assigned as a rider
-- ✅ Both roles added: ['chairperson', 'rider']
```

### 📍 Stage Selection Logic
The system automatically finds the appropriate stage for the chairperson to ride in:

- **Stage Chairperson** → Rides in their own stage
- **Parish Chairperson** → Rides in first stage of their parish
- **Subcounty Chairperson** → Rides in first stage of their subcounty
- **Division Chairperson** → Rides in first stage of their division
- **District Chairperson** → Rides in first stage of their district

### 🔧 Default Rider Settings
When auto-assigned as rider:
- **Vehicle Type**: `motorcycle` (default)
- **Plate Number**: `PENDING` (chairperson should update)
- **Status**: `active`
- **Stage**: Automatically selected based on chairperson level

---

## Setup Instructions

### Step 1: Run SQL Migration
```bash
# In Supabase SQL Editor:
Run: CHAIRPERSON_AUTO_RIDER_ASSIGNMENT.sql
```

This will:
1. Update `mbg_assign_chairperson()` function
2. Create `auto_assign_all_chairpersons_as_riders()` function
3. **Automatically assign ALL existing chairpersons as riders**

### Step 2: Verify Assignment
```sql
-- Check that all chairpersons are also riders
SELECT 
  u.email,
  u.user_roles,
  cm.role as chairperson_role,
  r.vehicle_type,
  r.plate_number,
  r.status
FROM mbg_users u
JOIN mbg_committee_members cm ON u.id = cm.user_id
LEFT JOIN mbg_riders r ON u.id = r.user_id
WHERE cm.is_active = true
ORDER BY u.email;

-- All should have rider records!
```

### Step 3: Check for Missing Riders
```sql
-- This should return 0 rows (no chairpersons without rider records)
SELECT 
  u.email,
  cm.role,
  cm.region_type
FROM mbg_users u
JOIN mbg_committee_members cm ON u.id = cm.user_id
LEFT JOIN mbg_riders r ON u.id = r.user_id
WHERE cm.is_active = true
  AND r.id IS NULL;
```

---

## User Experience

### Scenario 1: New Chairperson Assignment
```
1. Admin assigns John as District Chairperson
   → System creates committee member record
   → System finds first stage in district
   → System creates rider record with "PENDING" plate
   → Adds both 'chairperson' and 'rider' roles

2. John logs in
   → Sees role switcher with: Chairperson | Rider
   → Default view: Chairperson Dashboard
   
3. John clicks "My Profile" or "Rider" dashboard
   → Updates vehicle details (plate number, license, etc.)
   → Now fully functional as both chairperson AND rider
```

### Scenario 2: Existing Chairperson
```
1. Run migration SQL
   → System scans all existing chairpersons
   → Creates rider records for those without one
   → Adds 'rider' role to user_roles

2. Existing chairperson logs in
   → Now sees role switcher
   → Can switch to Rider dashboard
   → Should update vehicle details from "PENDING"
```

---

## Benefits

### For Chairpersons:
✅ **Earn Extra Income** - Make money from rides in addition to commissions  
✅ **Understand Riders** - Experience the platform from rider perspective  
✅ **Stay Active** - Participate directly in the ecosystem  
✅ **Lead by Example** - Show subordinates how it's done

### For Platform:
✅ **Higher Engagement** - Chairpersons actively use the platform  
✅ **Better Leadership** - Leaders who understand rider challenges  
✅ **More Riders** - Every chairperson adds to rider supply  
✅ **Unified Experience** - Everyone rides, everyone understands

---

## Dashboard Views

### Chairperson Dashboard
Shows:
- All committee assignments (District, Stage, etc.)
- Subordinate chairpersons
- Riders in managed stages
- Commission earnings

### Rider Dashboard  
Shows:
- Work mode selector (VIP, Discount, Return)
- Ride history
- Earnings from rides
- Customer ratings

### Combined View
Role switcher allows instant toggle between:
- **Chairperson Mode**: Manage team and operations
- **Rider Mode**: Accept rides and earn money

---

## Maintenance Functions

### Re-assign All Chairpersons as Riders
If something goes wrong or you need to retry:
```sql
SELECT public.auto_assign_all_chairpersons_as_riders();

-- Returns:
-- {
--   "success": true,
--   "assigned_count": 15,
--   "skipped_count": 3,
--   "error_count": 0,
--   "message": "Auto-assigned 15 chairpersons as riders..."
-- }
```

### Manually Assign Specific Chairperson
```sql
-- If auto-assignment failed for specific user
INSERT INTO public.mbg_riders (
  user_id,
  stage_id,
  vehicle_type,
  plate_number,
  status
) VALUES (
  'USER_ID_HERE',
  (SELECT id FROM mbg_stages LIMIT 1),
  'motorcycle',
  'PENDING',
  'active'
);

-- Add rider role
SELECT public.add_user_role('USER_ID_HERE', 'rider');
```

---

## Updating Vehicle Details

### From Profile Modal:
1. Click profile icon or "My Profile"
2. Switch to "Rider" tab
3. Update vehicle information:
   - Vehicle type (motorcycle/car/van)
   - Plate number
   - License number & expiry
   - Insurance details

### From Rider Dashboard:
1. Switch to "Rider" role
2. Go to profile settings
3. Update vehicle details

---

## Troubleshooting

### Issue: Chairperson doesn't have rider role
**Solution:**
```sql
-- Check current roles
SELECT public.get_user_roles('USER_ID');

-- Add rider role if missing
SELECT public.add_user_role('USER_ID', 'rider');

-- Create rider record if missing
-- (Use auto-assignment function above)
```

### Issue: No stages available for assignment
**Solution:**
```sql
-- Check if stages exist in the region
SELECT * FROM mbg_stages 
WHERE parish_id IN (
  SELECT id FROM mbg_parishes 
  WHERE subcounty_id IN (
    SELECT id FROM mbg_subcounties 
    WHERE division_id = 'DIVISION_ID'
  )
);

-- If no stages, create one first
INSERT INTO mbg_stages (name, parish_id) 
VALUES ('Main Stage', 'PARISH_ID');
```

### Issue: Plate number shows "PENDING"
**Solution:**
This is expected for auto-assigned riders. Chairperson should:
1. Go to Rider Dashboard
2. Click profile/settings
3. Update plate number and vehicle details

---

## Migration Checklist

### Before Migration:
- [ ] Backup database
- [ ] Note count of current chairpersons
- [ ] Note count of current riders

### Run Migration:
- [ ] Execute `CHAIRPERSON_AUTO_RIDER_ASSIGNMENT.sql`
- [ ] Check success message
- [ ] Verify assignment counts

### After Migration:
- [ ] All chairpersons have rider records
- [ ] All chairpersons have 'rider' role
- [ ] Role switcher appears for chairpersons
- [ ] Both dashboards accessible
- [ ] No errors in console

---

## Database Schema Changes

### mbg_committee_members
No changes - remains the same

### mbg_riders
New records created for chairpersons with:
- `user_id` → Chairperson's user ID
- `stage_id` → Auto-selected stage
- `vehicle_type` → 'motorcycle' (default)
- `plate_number` → 'PENDING' (to be updated)
- `status` → 'active'

### mbg_users
- `user_roles` → Now includes both ['chairperson', 'rider']

---

## API Changes

### mbg_assign_chairperson()
**New behavior:**
- Creates committee member record (as before)
- **NEW**: Also creates rider record
- **NEW**: Adds both 'chairperson' and 'rider' roles
- Returns JSON with `auto_rider_assigned: true/false`

### New Function: auto_assign_all_chairpersons_as_riders()
- Scans all active chairpersons
- Creates rider records for those without one
- Returns count of assigned/skipped/errors

---

## Summary

✅ **Policy**: Every chairperson MUST be a rider  
✅ **Automatic**: Rider record created when assigning chairperson  
✅ **Smart**: Stage auto-selected based on chairperson level  
✅ **Flexible**: Chairperson updates vehicle details later  
✅ **Unified**: Single user, multiple roles, seamless switching  

**Result**: All chairpersons are active participants in the platform, earning money both as managers (commissions) and as riders (ride fees)! 🎉
