# Quick Start: Stage Chairperson Assigns Riders

## Setup (One-Time)

### 1. Run SQL Script
```bash
# Open Supabase SQL Editor
# Copy and paste: CREATE_ASSIGN_RIDER_FUNCTION.sql
# Click "Run"
# Wait for: ✅ Rider Assignment Setup Complete!
```

## How to Assign a Rider

### Step 1: Login as Stage Chairperson
Your dashboard shows "Your Riders" section

### Step 2: Click "Assign Rider"
Green button in the riders section

### Step 3: Select User
- Type name or email in search box
- Click on user from list
- Checkmark appears when selected

### Step 4: Enter Vehicle Information

**Required Fields:**
- Vehicle Type: Choose motorcycle, bicycle, or tuktuk
- Plate Number: e.g., "UBD 123A" (auto-uppercase)
- License Number: Driver's license number

**Optional Fields:**
- License Expiry: When license expires
- Vehicle Model: e.g., "Bajaj Boxer"
- Vehicle Year: e.g., "2023"
- Vehicle Color: e.g., "Red"

### Step 5: Click "Assign Rider"
Wait for success message

### Step 6: Done!
Rider appears in your list with:
- ✅ Active status
- 🏍️ Vehicle type
- 🚗 Plate number
- ⭐ 0.0 rating (will improve with rides)
- 🚴 0 rides (will increase)

## Example

**Scenario:** Assign John as a motorcycle rider

1. Click "Assign Rider"
2. Search: "john@example.com"
3. Select: John Doe
4. Vehicle Type: Motorcycle
5. Plate Number: UBD 123A
6. License: DL123456
7. License Expiry: 2026-12-31
8. Model: Bajaj Boxer
9. Year: 2023
10. Color: Red
11. Click "Assign Rider"
12. ✅ Success! John is now a rider

## What You See

### Rider Card Shows:
- 👤 **Name**: John Doe
- 📧 **Email**: john@example.com
- 🏍️ **Type**: Motorcycle (blue badge)
- 🚗 **Plate**: UBD 123A
- ✅ **Status**: Active (green badge)
- ⭐ **Rating**: 0.0 (starts at zero)
- 🚴 **Rides**: 0 (will increase)

## Tips

💡 **Plate Number**: Automatically converts to uppercase
💡 **Search**: Works with partial names/emails
💡 **Status**: Auto-approved when assigned by chairperson
💡 **Rating**: Builds up as rider completes rides
💡 **Commission**: You earn from their rides

## Troubleshooting

❌ **"No users available"**
→ Users must exist in Supabase auth first

❌ **"Plate number already registered"**
→ Each plate must be unique, try different number

❌ **Modal doesn't open**
→ You must be a stage chairperson

❌ **Can't see riders section**
→ Only stage chairpersons see this section

## Next Actions

After assigning riders:
1. 📊 Monitor their performance (rating, rides)
2. 💰 Track commission earnings
3. 🔄 Assign more riders to your stage
4. 📈 Watch your stage grow

## Quick Reference

| Field | Required | Example |
|-------|----------|---------|
| User | Yes | Select from list |
| Vehicle Type | Yes | Motorcycle |
| Plate Number | Yes | UBD 123A |
| License | Yes | DL123456 |
| Expiry | No | 2026-12-31 |
| Model | No | Bajaj Boxer |
| Year | No | 2023 |
| Color | No | Red |

---

Need help? Check the full documentation in `STAGE_CHAIRPERSON_ASSIGN_RIDERS.md`
