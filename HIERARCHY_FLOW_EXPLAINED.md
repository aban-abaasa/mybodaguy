# MyBodaGuy - Hierarchical Assignment Flow

## 🎯 How It Works

The MyBodaGuy platform follows a **strict hierarchical assignment model** where each level can only assign the level directly below them.

---

## 📊 The Hierarchy Chain

```
┌─────────────────────────────────────────────────┐
│              DEVELOPER (You)                     │
│  • Create all geographic regions                │
│  • Assign ONLY District Chairpersons            │
└──────────────────┬──────────────────────────────┘
                   │ assigns ↓
         ┌─────────────────────────┐
         │  District Chairperson   │
         │  • Manages district     │
         │  • Assigns Division     │
         │    Chairpersons         │
         └──────────┬──────────────┘
                    │ assigns ↓
              ┌────────────────────┐
              │ Division           │
              │ Chairperson        │
              │ • Assigns Subcounty│
              │   Chairpersons     │
              └─────────┬──────────┘
                        │ assigns ↓
                  ┌────────────────┐
                  │ Subcounty      │
                  │ Chairperson    │
                  │ • Assigns Parish│
                  │   Chairpersons │
                  └────────┬───────┘
                           │ assigns ↓
                     ┌────────────────┐
                     │ Parish         │
                     │ Chairperson    │
                     │ • Assigns Stage│
                     │   Chairpersons │
                     └────────┬───────┘
                              │ assigns ↓
                        ┌────────────────┐
                        │ Stage          │
                        │ Chairperson    │
                        │ • Manages Riders│
                        │ • Operates Stage│
                        └────────────────┘
```

---

## 🔐 Assignment Rules (Enforced by Database & UI)

### Developer Role
- ✅ **CAN:** Create all regions (Districts, Divisions, Subcounties, Parishes, Stages)
- ✅ **CAN:** Assign District Chairpersons
- ❌ **CANNOT:** Assign Division, Subcounty, Parish, or Stage Chairpersons directly

### District Chairperson
- ✅ **CAN:** View their district and all divisions within it
- ✅ **CAN:** Assign Division Chairpersons in their district
- ❌ **CANNOT:** Assign chairpersons in other districts
- ❌ **CANNOT:** Skip levels (e.g., assign Subcounty Chairpersons directly)

### Division Chairperson
- ✅ **CAN:** View their division and all subcounties within it
- ✅ **CAN:** Assign Subcounty Chairpersons in their division
- ❌ **CANNOT:** Assign chairpersons outside their division

### Subcounty Chairperson
- ✅ **CAN:** View their subcounty and all parishes within it
- ✅ **CAN:** Assign Parish Chairpersons in their subcounty
- ❌ **CANNOT:** Assign chairpersons outside their subcounty

### Parish Chairperson
- ✅ **CAN:** View their parish and all stages within it
- ✅ **CAN:** Assign Stage Chairpersons in their parish
- ❌ **CANNOT:** Assign chairpersons outside their parish

### Stage Chairperson
- ✅ **CAN:** View riders at their stage
- ✅ **CAN:** Onboard new riders
- ✅ **CAN:** Manage daily operations
- ❌ **CANNOT:** Assign other chairpersons

---

## 💼 Real-World Example

Let's say you're setting up **Kampala District**:

### Step 1: Developer Creates Structure
```
Developer logs in → Creates:
  - District: Kampala
  - Division: Kampala Central
  - Division: Rubaga
  - Subcounty: Central Ward
  - Parish: Nakasero
  - Stage: Old Taxi Park
```

### Step 2: Developer Assigns District Chairperson
```
Developer → Assigns "John Doe" as District Chairperson for Kampala
```

### Step 3: District Chairperson Takes Over
```
John Doe logs in as District Chairperson → Can now:
  - Assign Division Chairperson for "Kampala Central"
  - Assign Division Chairperson for "Rubaga"
  - View all divisions in Kampala District
```

### Step 4: Division Chairperson Assigned
```
John assigns "Jane Smith" as Division Chairperson for Kampala Central
Jane logs in → Can now assign Subcounty Chairpersons in Kampala Central
```

### Step 5: Chain Continues Down
```
Jane assigns Subcounty Chairperson
  ↓
Subcounty Chair assigns Parish Chairperson
  ↓
Parish Chair assigns Stage Chairperson
  ↓
Stage Chair manages riders at their boda boda stage
```

---

## 🎨 UI Behavior in Developer Dashboard

### What You See as Developer:

**District Level:**
- ✅ "Assign Chairperson" button (clickable)
- You can assign District Chairpersons

**Division Level:**
- ⚪ Shows "Assigned by District Chairperson" (not clickable)
- You cannot assign - only District Chairperson can

**Subcounty Level:**
- ⚪ Shows "Via Division Chair" (not clickable)
- Only Division Chairperson can assign

**Parish Level:**
- ⚪ Shows "Via Subcounty Chair" (not clickable)
- Only Subcounty Chairperson can assign

**Stage Level:**
- ⚪ Shows "Via Parish Chair" (not clickable)
- Only Parish Chairperson can assign

---

## 💰 Commission Flow

Each chairperson earns commissions from **all riders in their jurisdiction**:

```
Stage Chairperson → Earns from riders at their stage
      ↓
Parish Chairperson → Earns from ALL riders in ALL stages in their parish
      ↓
Subcounty Chairperson → Earns from ALL riders in ALL parishes in their subcounty
      ↓
Division Chairperson → Earns from ALL riders in ALL subcounties in their division
      ↓
District Chairperson → Earns from ALL riders in ALL divisions in their district
```

**Example:**
- If a ride happens at "Old Taxi Park Stage"
- Commissions distributed to:
  1. Stage Chairperson (Old Taxi Park)
  2. Parish Chairperson (Nakasero)
  3. Subcounty Chairperson (Central Ward)
  4. Division Chairperson (Kampala Central)
  5. District Chairperson (Kampala)

Each gets their configured commission percentage!

---

## 🔒 Security & Validation

### Database Level (RLS Policies)
- ✅ Function `can_assign_chairperson()` validates assignment authority
- ✅ Checks hierarchy: District can assign Division, Division can assign Subcounty, etc.
- ✅ Verifies region belongs to assigner's jurisdiction
- ❌ Blocks unauthorized assignments

### Frontend Level
- ✅ Hides "Assign" buttons for levels the current user cannot assign
- ✅ Shows status messages instead (e.g., "Via District Chairperson")
- ✅ Only shows appropriate actions based on user role

### Backend Level
- ✅ SQL function `assign_chairperson()` enforces rules
- ✅ Automatically sets parent-child relationships
- ✅ Updates user role from 'customer' to 'chairperson'
- ✅ Records who assigned whom (audit trail)

---

## 🚀 Next: Chairperson Dashboards

Each chairperson will have their own dashboard showing:
- Their region and statistics
- Subordinate chairpersons they've assigned
- Riders in their jurisdiction
- Earnings and commissions
- Ability to assign the next level down

This creates a **self-managing, scalable system** where you (developer) only need to:
1. Create the geographic structure
2. Assign the top-level (District) chairpersons
3. Let them cascade down the hierarchy!

---

## 📝 Summary

**The Golden Rule:** 
> **Each level can ONLY assign the level directly below them in their own jurisdiction.**

This ensures:
- ✅ Clear chain of command
- ✅ Accountability at each level  
- ✅ Proper commission distribution
- ✅ Scalable management structure
- ✅ Security and access control

**You (Developer)** are only responsible for:
1. Setting up regions (geographical structure)
2. Assigning District Chairpersons
3. Everything else flows down automatically! 🎉
