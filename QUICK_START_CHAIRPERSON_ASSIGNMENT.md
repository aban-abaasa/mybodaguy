# Quick Start: Chairperson Assigns Subordinates

## What You Can Do Now

✅ **Chairpersons can assign subordinate chairpersons** (just like developers)
✅ **Select users from Supabase auth** (search by name/email)
✅ **Hierarchical structure** (district → division → subcounty → parish → stage)
✅ **Set commission rates** for each chairperson
✅ **Add notes** for context

## Step-by-Step Guide

### 1. Login as Chairperson
Navigate to your chairperson dashboard

### 2. Click "Assign New"
Located in the "Your Chairpersons" section

### 3. Select Region
Choose which region to assign (dropdown shows only your subordinate regions)

### 4. Search for User
Type name or email in search box

### 5. Select User
Click on user from the list (checkmark appears)

### 6. Set Commission Rate
Enter percentage (default is 5%)

### 7. Add Notes (Optional)
Any additional instructions or context

### 8. Click "Assign Chairperson"
Wait for success message

### 9. Done!
New chairperson appears in your subordinates list

## Hierarchy Rules

```
Developer
  ↓ can assign
District Chairperson
  ↓ can assign
Division Chairperson
  ↓ can assign
Subcounty Chairperson
  ↓ can assign
Parish Chairperson
  ↓ can assign
Stage Chairperson
  ↓ (cannot assign further)
```

## Quick Tips

💡 **Search is powerful** - Type any part of name or email
💡 **Commission rates** - Between 0-100%
💡 **Only your regions** - You only see regions under your area
💡 **User must exist** - Users must be in Supabase auth first
💡 **Auto-reload** - Dashboard refreshes after assignment

## What Happens After Assignment?

1. ✅ User's role changed to "chairperson"
2. ✅ Committee member record created
3. ✅ Hierarchical relationship established
4. ✅ Commission rate set
5. ✅ Appears in your subordinates list
6. ✅ They can login and see their dashboard
7. ✅ They can assign their own subordinates (if not at stage level)

## Example Scenario

**You are:** District Chairperson for Kampala
**You want to:** Assign someone to manage Kawempe Division

**Steps:**
1. Click "Assign New"
2. Select region: "Kawempe Division"
3. Search: "maria@example.com"
4. Select: Maria Johnson
5. Commission: 5%
6. Notes: "Manages Kawempe operations"
7. Click "Assign Chairperson"
8. ✅ Maria is now Division Chairperson for Kawempe!

## Troubleshooting

❌ **No users showing?**
- Check Supabase auth has users
- Contact developer to sync users

❌ **No regions showing?**
- Regions must be created first
- Contact developer to add regions

❌ **Assignment failed?**
- Check browser console
- User might already be assigned
- Contact support with error message

❌ **Stage chairperson trying to assign?**
- Stage is lowest level
- Cannot assign subordinates

## Need Help?

📧 Contact platform administrator
📱 Check browser console for errors
📚 Read full documentation: `CHAIRPERSON_ASSIGN_SUBORDINATES_FEATURE.md`
