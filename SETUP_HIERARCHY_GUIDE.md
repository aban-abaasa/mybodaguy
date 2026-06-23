# MyBodaGuy - Hierarchical Chairperson Setup Guide

## 🎯 What You're Setting Up

A complete hierarchical management system where:
- **Developers** can assign **District Chairpersons**
- **District Chairpersons** can assign **Division Chairpersons**
- **Division Chairpersons** can assign **Subcounty Chairpersons**
- **Subcounty Chairpersons** can assign **Parish Chairpersons**
- **Parish Chairpersons** can assign **Stage Chairpersons**
- **Stage Chairpersons** manage **Riders** at their boda boda stages

Each level earns commissions from riders in their jurisdiction!

---

## 📋 Step-by-Step Setup

### Step 1: Run Database Migrations (in order!)

Open your Supabase Dashboard → SQL Editor and run these files **in this exact order**:

1. ✅ `backend/database/schema_mybodaguy/01_users.sql`
2. ✅ `backend/database/schema_mybodaguy/02_geographic_regions.sql`
3. ✅ `backend/database/schema_mybodaguy/03_user_profiles.sql`
4. ✅ `backend/database/schema_mybodaguy/04_committee_members.sql` (Updated!)
5. ✅ `backend/database/schema_mybodaguy/05_riders.sql`
6. ✅ `backend/database/schema_mybodaguy/06_customers.sql`
7. ✅ `backend/database/schema_mybodaguy/07_rides.sql`
8. ✅ `backend/database/schema_mybodaguy/08_payments.sql`
9. ✅ `backend/database/schema_mybodaguy/09_commissions.sql`
10. ✅ `backend/database/schema_mybodaguy/10_platform_settings.sql`
11. ✅ `backend/database/schema_mybodaguy/11_hierarchical_chairperson_management.sql` (NEW!)

**Note:** If file 04 fails because types already exist, that's OK! Just continue with the rest.

### Step 2: Verify Tables Were Created

Run this query in Supabase SQL Editor:

```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN (
    'mbg_users',
    'districts',
    'divisions',
    'subcounties',
    'parishes',
    'stages',
    'committee_members',
    'committee_member_details'
  )
ORDER BY table_name;
```

You should see all 8 tables listed.

### Step 3: Test the Frontend

1. Start your dev server:
   ```bash
   cd frontend
   npm run dev
   ```

2. Sign in as developer: `abanabaasa2@gmail.com`

3. Go to **Developer Dashboard** → **Regions** tab

4. You should now see the full Region Management interface!

---

## 🎨 What's Available in the Frontend

### Developer Dashboard - Regions Tab

**Features:**
- ✅ Create Districts
- ✅ View hierarchical structure
- ✅ Assign District Chairpersons
- ✅ Set commission rates
- ✅ Track assigned chairpersons

**How to Use:**

1. **Create Your First District:**
   - Click "Add District"
   - Enter name (e.g., "Kampala")
   - Add optional code (e.g., "KLA")
   - Save

2. **Assign a District Chairperson:**
   - Click "Assign Chairperson" next to a district
   - Enter the user's email (they must have an account!)
   - Set commission rate (default: 5%)
   - Add optional notes
   - Click "Assign Chairperson"

3. **User Gets Promoted:**
   - Their role automatically changes from `customer` to `chairperson`
   - They now see the Chairperson Dashboard
   - They can assign lower-level chairpersons in their region

---

## 🔧 Functions Available

### For Developers (SQL)

```sql
-- Assign a chairperson directly via SQL
SELECT assign_chairperson(
  'user-uuid-here',                  -- target user ID
  'district_chairperson',            -- role
  'district',                        -- region type
  'district-uuid-here',              -- region ID
  5.00,                              -- commission rate (%)
  'Initial appointment'              -- notes
);

-- Get all subordinates of a chairperson
SELECT * FROM get_subordinate_chairpersons('chairperson-user-id');

-- View the complete hierarchy
SELECT * FROM committee_hierarchy 
WHERE is_active = true
ORDER BY appointed_at DESC;
```

### For Frontend (TypeScript)

```typescript
import { chairpersonService } from './services/chairpersonService';

// Assign a chairperson
const result = await chairpersonService.assignChairperson({
  targetUserEmail: 'user@example.com',
  targetRole: 'district_chairperson',
  targetRegionType: 'district',
  targetRegionId: 'district-uuid',
  commissionRate: 5.0,
  notes: 'Initial appointment'
});

// Get subordinates
const subordinates = await chairpersonService.getSubordinates(userId);

// Get assignable regions for current user
const regions = await chairpersonService.getAssignableRegions(userId);
```

---

## 🚀 Next Steps

After basic setup is working:

1. **Add More Regions:**
   - Create Divisions under Districts
   - Create Subcounties under Divisions
   - Create Parishes under Subcounties
   - Create Stages under Parishes

2. **Build Chairperson Dashboard:**
   - Let chairpersons see their region
   - Show their subordinates
   - Display earnings/commissions
   - Manage riders in their jurisdiction

3. **Test the Hierarchy:**
   - Create a test user
   - Assign as District Chairperson
   - Log in as that user
   - Try assigning a Division Chairperson
   - Verify permissions work correctly

---

## ❓ Common Issues

### "User not found" when assigning chairperson
**Solution:** The user must create an account first. Have them sign up at your app, then assign them.

### "Permission denied" when assigning
**Solution:** Check the hierarchy rules:
- District → can assign Division
- Division → can assign Subcounty
- Subcounty → can assign Parish
- Parish → can assign Stage

### Table doesn't exist errors
**Solution:** Run the SQL migrations in the exact order listed above.

### Can't see Regions tab
**Solution:** Make sure you're signed in as developer (abanabaasa2@gmail.com) and the component is imported correctly.

---

## 📊 Database Structure

```
mbg_users (base user table)
  ↓
committee_members (chairperson assignments)
  ↓
committee_member_details (extended profiles)

districts (Level 1)
  ↓
divisions (Level 2)
  ↓
subcounties (Level 3)
  ↓
parishes (Level 4)
  ↓
stages (Level 5 - actual boda boda stations)
```

---

## 🎉 You're All Set!

Once you complete these steps, you'll have a fully functional hierarchical management system where chairpersons can manage their regions and earn commissions from riders! 🚀
