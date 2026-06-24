# Final Complete Multi-Role System 🎯

## Core Business Rules

### 1. **Every Chairperson MUST be:**
✅ **Stage Chairperson** (in addition to their primary role)  
✅ **Rider** (active participant in the platform)

### 2. **Role Hierarchy:**
- **District Chairperson** → Also Stage Chairperson + Rider
- **Division Chairperson** → Also Stage Chairperson + Rider
- **Subcounty Chairperson** → Also Stage Chairperson + Rider
- **Parish Chairperson** → Also Stage Chairperson + Rider
- **Stage Chairperson** → Also Rider

### 3. **What This Means:**
- Every leader directly manages riders at the stage level
- Every leader understands the rider experience firsthand
- No chairperson is disconnected from ground operations
- Everyone participates actively in the platform

---

## System Implementation

### Automatic Assignments

When you assign someone as **ANY level** chairperson:

```sql
SELECT public.mbg_assign_chairperson(
  'john@example.com',
  'district_chairperson',
  'district',
  'KAMPALA_DISTRICT_ID',
  10.00
);
```

**System automatically:**
1. ✅ Creates District Chairperson record
2. ✅ Finds first stage in Kampala District
3. ✅ Creates Stage Chairperson record for that stage
4. ✅ Creates Rider record for that same stage
5. ✅ Adds roles: `['chairperson', 'rider']`

**Result:**
- John is District Chairperson (manages divisions)
- John is ALSO Stage Chairperson (manages riders directly)
- John is ALSO a Rider (accepts ride requests)

---

## Database Schema

### mbg_users
```sql
user_roles text[] 
-- Example: ['chairperson', 'rider']
```

### mbg_committee_members
```sql
-- Multiple rows per user (one per assignment)
-- Example for District Chairperson:
Row 1: District Chairperson assignment
Row 2: Stage Chairperson assignment (auto-created)
```

### mbg_riders
```sql
-- One row per user
-- Auto-created when assigning as chairperson
vehicle_type: 'motorcycle' (default)
plate_number: 'PENDING' (to be updated by user)
stage_id: Auto-selected based on chairperson region
```

---

## User Experience

### Example: District Chairperson

**Assignment:**
```sql
SELECT public.mbg_assign_chairperson(
  'mary@example.com',
  'district_chairperson',
  'district',
  'KAMPALA_DISTRICT_ID',
  10.00
);
```

**Mary's Profile:**
- **Primary Role**: District Chairperson
- **Additional Role**: Stage Chairperson (Old Taxi Park Stage)
- **Rider Status**: Active rider in Old Taxi Park Stage

**Mary logs in and sees:**

#### Chairperson Dashboard:
- 📍 **2 Assignment Badges**:
  - District Chairperson (Kampala) - 10% commission
  - Stage Chairperson (Old Taxi Park) - 5% commission
- 👥 **All Subordinates**: Division chairpersons under her
- 🏍️ **All Riders**: Riders in Old Taxi Park Stage
- 💰 **Combined Commissions**: From both levels

#### Role Switcher Header:
```
🏢 Chairperson | 🏍️ Rider
```

**Clicking "Rider":**
- Shows Rider Dashboard
- Work mode selector (VIP, Discount, Return)
- Accept ride requests
- Earn ride fees directly

---

## Benefits

### For Chairpersons:
✅ **Multiple Income Streams**
   - District commissions (10%)
   - Stage commissions (5%)
   - Ride fees (variable)

✅ **Direct Rider Management**
   - Every chairperson manages a stage
   - Assign and monitor riders
   - Understand operations firsthand

✅ **Platform Engagement**
   - Active rider = better understanding
   - Lead by example
   - Stay connected to ground reality

### For Platform:
✅ **Higher Engagement** - All leaders are active users  
✅ **Better Leadership** - Leaders who understand challenges  
✅ **More Riders** - Every chairperson adds supply  
✅ **Quality Control** - Leaders experience service quality  
✅ **Aligned Incentives** - Success = more commissions + more rides

---

## Setup Instructions

### Step 1: Run SQL Migrations
```bash
# In Supabase SQL Editor, run these IN ORDER:

1. ENABLE_MULTI_ROLE_SYSTEM.sql
   → Adds multi-role support
   → Creates role management functions

2. CHAIRPERSON_AUTO_RIDER_ASSIGNMENT.sql
   → Auto-assigns chairpersons as stage chairpersons
   → Auto-assigns chairpersons as riders
   → Processes existing chairpersons
```

### Step 2: Verify Assignments
```sql
-- Check that all chairpersons have stage + rider assignments
SELECT 
  u.email,
  u.user_roles,
  COUNT(DISTINCT cm.id) as total_assignments,
  COUNT(DISTINCT CASE WHEN cm.region_type = 'stage' THEN cm.id END) as stage_assignments,
  r.plate_number,
  r.status as rider_status
FROM mbg_users u
JOIN mbg_committee_members cm ON u.id = cm.user_id
LEFT JOIN mbg_riders r ON u.id = r.user_id
WHERE cm.is_active = true
GROUP BY u.id, u.email, u.user_roles, r.plate_number, r.status
ORDER BY u.email;

-- Expected:
-- All chairpersons have:
-- - user_roles: ['chairperson', 'rider']
-- - total_assignments: 2+ (primary + stage)
-- - stage_assignments: 1+
-- - rider_status: 'active'
```

### Step 3: Test Frontend
1. Log in as chairperson
2. See multiple assignment badges (primary + stage)
3. See role switcher (Chairperson | Rider)
4. Switch to Rider dashboard
5. Both work perfectly

---

## Real-World Examples

### Example 1: District Boss
```
Name: John Kamau
Primary: District Chairperson (Kampala)
Auto-Added: Stage Chairperson (Old Taxi Park)
Auto-Added: Rider (Old Taxi Park)

Earnings:
- District commissions: UGX 500K/month
- Stage commissions: UGX 100K/month
- Ride fees: UGX 150K/month
Total: UGX 750K/month

Activities:
- Manages 5 division chairpersons
- Manages 20 riders at Old Taxi Park
- Accepts 50 rides/month himself
```

### Example 2: Division Leader
```
Name: Sarah Nakato
Primary: Division Chairperson (Kawempe)
Auto-Added: Stage Chairperson (Kalerwe Stage)
Auto-Added: Rider (Kalerwe Stage)

Earnings:
- Division commissions: UGX 200K/month
- Stage commissions: UGX 80K/month
- Ride fees: UGX 120K/month
Total: UGX 400K/month

Activities:
- Manages 3 subcounty chairpersons
- Manages 15 riders at Kalerwe
- Accepts 40 rides/month himself
```

### Example 3: Stage-Only Chairperson
```
Name: Peter Okello
Primary: Stage Chairperson (Wandegeya)
Auto-Added: Rider (Wandegeya)

Earnings:
- Stage commissions: UGX 150K/month
- Ride fees: UGX 200K/month
Total: UGX 350K/month

Activities:
- Manages 25 riders at Wandegeya
- Accepts 60 rides/month himself
```

---

## Dashboard Features

### Chairperson Dashboard Shows:

#### Assignment Badges
```
[District Chairperson - Kampala • 10%]  [Stage Chairperson - Old Taxi Park • 5%]
                    ↑ Active                                    ↑ Clickable
```

#### Stats Grid
- **My Roles**: 2 (District + Stage)
- **Total Chairpersons**: 5 (subordinates)
- **Active Chairpersons**: 4
- **Avg Commission**: 7.5%
- **Monthly Rides**: 1,250 (from managed stage)

#### Subordinates Section
- Shows ALL subordinate chairpersons
- From ALL assignments (district-level + stage-level)

#### Riders Section
- Shows ALL riders from stage assignments
- Can assign new riders
- Monitor performance

### Rider Dashboard Shows:
- Work mode selector (VIP, Discount, Return)
- Today's earnings
- Ride history
- Customer ratings
- Available ride requests

---

## API Functions

### Role Management
```sql
-- Get all roles
SELECT public.get_user_roles('USER_ID');
-- Returns: ['chairperson', 'rider']

-- Check if has role
SELECT public.user_has_role('USER_ID', 'rider');
-- Returns: true

-- Add role manually (usually automatic)
SELECT public.add_user_role('USER_ID', 'rider');
```

### Assignment Functions
```sql
-- Assign chairperson (auto-creates stage + rider)
SELECT public.mbg_assign_chairperson(
  email, role, region_type, region_id, commission
);

-- Returns:
{
  "success": true,
  "user_id": "...",
  "message": "Chairperson assigned...",
  "auto_stage_chairperson_assigned": true,
  "auto_rider_assigned": true
}

-- Bulk process existing chairpersons
SELECT public.auto_assign_all_chairpersons_as_riders();

-- Returns:
{
  "success": true,
  "assigned_count": 15,
  "skipped_count": 3,
  "error_count": 0
}
```

---

## Maintenance

### Check System Health
```sql
-- Chairpersons without stage assignment
SELECT u.email, cm.role, cm.region_type
FROM mbg_users u
JOIN mbg_committee_members cm ON u.id = cm.user_id
WHERE cm.is_active = true
  AND cm.region_type != 'stage'
  AND NOT EXISTS (
    SELECT 1 FROM mbg_committee_members cm2
    WHERE cm2.user_id = u.id
      AND cm2.region_type = 'stage'
      AND cm2.is_active = true
  );
-- Should return: 0 rows

-- Chairpersons without rider record
SELECT u.email, cm.role
FROM mbg_users u
JOIN mbg_committee_members cm ON u.id = cm.user_id
LEFT JOIN mbg_riders r ON u.id = r.user_id
WHERE cm.is_active = true
  AND r.id IS NULL;
-- Should return: 0 rows
```

### Fix Missing Assignments
```sql
-- Re-run auto-assignment for all
SELECT public.auto_assign_all_chairpersons_as_riders();
```

---

## Troubleshooting

### Issue: Chairperson doesn't have stage assignment
**Check:**
```sql
SELECT * FROM mbg_committee_members 
WHERE user_id = 'USER_ID' AND region_type = 'stage';
```

**Fix:**
Re-run assignment function or manually assign:
```sql
INSERT INTO mbg_committee_members (
  user_id, role, region_type, region_id, commission_rate, is_active
) VALUES (
  'USER_ID', 'stage_chairperson', 'stage', 'STAGE_ID', 5.00, true
);
```

### Issue: Chairperson doesn't have rider record
**Check:**
```sql
SELECT * FROM mbg_riders WHERE user_id = 'USER_ID';
```

**Fix:**
```sql
INSERT INTO mbg_riders (
  user_id, stage_id, vehicle_type, plate_number, status
) VALUES (
  'USER_ID', 'STAGE_ID', 'motorcycle', 'PENDING', 'active'
);

SELECT public.add_user_role('USER_ID', 'rider');
```

---

## Summary

### ✅ System Complete

**Every chairperson automatically gets:**
1. Primary assignment (District/Division/Subcounty/Parish/Stage)
2. Stage Chairperson assignment
3. Rider record

**Result:**
- All leaders manage riders directly
- All leaders experience the platform as riders
- Multiple income streams for chairpersons
- Higher platform engagement
- Better aligned incentives

### 🚀 Quick Start

```bash
# 1. Run SQL migrations
ENABLE_MULTI_ROLE_SYSTEM.sql
CHAIRPERSON_AUTO_RIDER_ASSIGNMENT.sql

# 2. Verify
Check all chairpersons have 2+ committee assignments
Check all chairpersons have rider records
Check user_roles includes ['chairperson', 'rider']

# 3. Test
Log in as chairperson
See multiple assignment badges
Switch to Rider dashboard
Both work perfectly
```

**Status**: ✅ Complete and Production-Ready!
