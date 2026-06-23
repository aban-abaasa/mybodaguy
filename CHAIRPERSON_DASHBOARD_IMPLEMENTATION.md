# Chairperson Dashboard - Full Implementation Guide

## Features Implemented

### 1. **Hierarchical Chairperson Assignment**
- District Chairpersons can assign Division Chairpersons
- Division Chairpersons can assign Subcounty Chairpersons
- Subcounty Chairpersons can assign Parish Chairpersons
- Parish Chairpersons can assign Stage Chairpersons

### 2. **Profile Management**
- Edit Profile button in header
- Update full name, phone, national ID, and address
- Saves to `committee_member_details` table

### 3. **Dashboard Features**
- **Stats Cards**: Total chairpersons, Active count, Commission rate, Monthly rides
- **Subordinates List**: Shows all assigned chairpersons with status
- **Commission Summary**: Track earnings (placeholder for integration)
- **Recent Activity**: Activity feed (placeholder)

### 4. **Assignment Modal**
- Email input for target user
- Region dropdown (loads assignable regions based on hierarchy)
- Commission rate input
- Optional notes field
- Automatically determines role based on assigner's level

### 5. **Profile Update Modal**
- Full name
- Phone number  
- National ID
- Address

## Key Functions Added

```typescript
// Load dashboard data
const loadDashboardData = async () => {
  // Loads committee info, subordinates, assignable regions, and profile details
}

// Handle chairperson assignment
const handleAssignChairperson = async (e: React.FormEvent) => {
  // Determines target role and region type based on current role
  // Calls chairpersonService.assignChairperson()
}

// Update profile
const handleUpdateProfile = async (e: React.FormEvent) => {
  // Saves profile details to committee_member_details
}

// Helper functions
const getNextLevelName = () => {
  // Returns "Division", "Subcounty", "Parish", or "Stage"
}
```

## UI Components

### Assignment Button
- Only shows if not at Stage level (Stage is the lowest)
- Label shows next level: "Assign Division Chairperson", etc.

### Modal Dialogs
- **Assign Modal**: Form to assign new chairperson
- **Profile Modal**: Form to update committee member details

### Subordinates Display
- Avatar with initials
- Name, email, role badge
- Region name
- Active/Inactive status badge
- Commission rate display

## Database Functions Used

1. `get_all_auth_users()` - Get users from auth
2. `sync_user_from_auth()` - Sync user to mbg_users
3. `mbg_assign_chairperson()` - Assign chairperson with hierarchy
4. `getMyCommitteeInfo()` - Get current user's committee info
5. `getSubordinates()` - Get list of subordinate chairpersons
6. `getAssignableRegions()` - Get regions that can be assigned
7. `updateCommitteeMemberDetails()` - Update profile details
8. `getCommitteeMemberDetails()` - Get profile details

## Hierarchy Logic

```
District Chairperson
└── Can assign Division Chairpersons
    └── Can assign Subcounty Chairpersons
        └── Can assign Parish Chairpersons
            └── Can assign Stage Chairpersons
```

## Next Steps

1. Replace the current `ChairpersonDashboard.tsx` with the enhanced version
2. Test the assignment flow end-to-end
3. Add commission tracking integration
4. Add activity feed integration
5. Add ability to deactivate/reactivate subordinates
6. Add pagination for large subordinate lists
7. Add search/filter for subordinates

## Files to Update

- `frontend/src/mybodaguy/pages/ChairpersonDashboard.tsx` - Main dashboard
- Already created: All database functions and services

## Notes

- All hierarchy validation is done in the database
- RLS policies ensure users can only assign at appropriate levels
- Profile updates go to `committee_member_details` table
- Commission tracking requires integration with rides/payments system
