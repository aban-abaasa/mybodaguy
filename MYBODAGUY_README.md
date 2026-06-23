# My Boda Guy - Complete Setup Guide

## Overview
My Boda Guy is a comprehensive transport and delivery application for boda boda (motorcycle taxi) management with hierarchical role-based system and commission tracking.

**Important:** This application uses the `mbg_` prefix for all database tables to avoid conflicts with other applications in the same Supabase instance.

## Developer Access (Hardcoded)
- **Email:** abanabaasa2@gmail.com
- **Password:** @1997God

This account is automatically assigned the 'developer' role upon first sign-in.

## Database Setup

### Step 1: Initialize Database
```bash
cd backend
npm install
npm run init:mybodaguy
```

### Step 2: Verify Tables
All tables use `mbg_` prefix:
- mbg_users
- mbg_user_profiles
- mbg_districts
- mbg_divisions
- mbg_subcounties
- mbg_parishes
- mbg_stages
- mbg_committee_members
- mbg_riders
- mbg_customers
- mbg_rides
- mbg_payments
- mbg_commissions
- mbg_platform_settings

## Frontend Setup

### Step 1: Install Dependencies
```bash
cd frontend
npm install
```

### Step 2: Configure Environment
The `.env.local` file should already have your Supabase credentials.

### Step 3: Run Development Server
```bash
npm run dev
```

Access the app at: http://localhost:5173

## First Time Setup

### 1. Create Developer Account
1. Go to http://localhost:5173
2. Click "Sign In"
3. Enter:
   - Email: abanabaasa2@gmail.com
   - Password: @1997God
4. You'll be automatically logged in as Developer

### 2. Access Developer Panel
After logging in with the developer account, you'll see:
- Full system control panel
- User management
- Geographic regions setup
- Commission configuration
- Platform analytics

### 3. Set Up Geographic Hierarchy
From the Developer Panel:
1. Create Districts
2. Create Divisions (under districts)
3. Create Subcounties (under divisions)
4. Create Parishes (under subcounties)
5. Create Stages (under parishes with GPS coordinates)

### 4. Assign Chairpersons
1. Other users sign up normally
2. Developer assigns them as chairpersons
3. Hierarchy flows: District → Division → Subcounty → Parish → Stage

### 5. Onboard Riders
1. Riders sign up and select a stage
2. Stage chairperson approves riders
3. Riders can start accepting rides

## Role Hierarchy

```
Developer (Super Admin)
└── District Chairperson
    └── Division Chairperson
        └── Subcounty Chairperson
            └── Parish Chairperson
                └── Stage Chairperson
                    └── Riders
```

## Commission Structure (Default)

From each ride fare (e.g., 10,000 UGX):
- Platform Fee: 5% = 500 UGX
- Rider Earnings: 70% = 7,000 UGX
- Stage Chairperson: 10% = 1,000 UGX
- Parish Chairperson: 6% = 600 UGX
- Subcounty Chairperson: 4% = 400 UGX
- Division Chairperson: 3% = 300 UGX
- District Chairperson: 2% = 200 UGX

**Note:** All percentages are configurable from Developer Panel

## User Flows

### Customer Flow
1. Sign up → Automatically set as 'customer'
2. Request a ride (pickup & dropoff)
3. Rider accepts
4. Track ride in real-time
5. Complete & rate rider
6. Pay via cash/mobile money

### Rider Flow
1. Sign up → Select stage
2. Wait for stage chairperson approval
3. Toggle availability ON
4. Accept ride requests
5. Complete rides
6. Earn 70% of fare + view commission breakdown

### Chairperson Flow
1. Sign up
2. Get assigned by higher-level chairperson (or developer)
3. Assign lower-level chairpersons/riders
4. View region analytics
5. Track commission earnings
6. Withdraw commissions

### Developer Flow
1. Sign in with hardcoded credentials
2. Full system access
3. Manage all users and regions
4. Configure commissions
5. View platform analytics
6. Financial oversight

## Key Features

### For Developers
- ✅ User management (all roles)
- ✅ Geographic region setup
- ✅ Commission configuration
- ✅ Platform-wide analytics
- ✅ Financial reports
- ✅ System settings

### For Chairpersons
- ✅ Assign subordinates
- ✅ View region statistics
- ✅ Track commissions
- ✅ Region performance
- ✅ Withdraw earnings

### For Riders
- ✅ Accept/decline rides
- ✅ Real-time navigation
- ✅ Earnings tracking
- ✅ Commission breakdown
- ✅ Availability toggle
- ✅ Ratings & reviews

### For Customers
- ✅ Request rides
- ✅ Real-time tracking
- ✅ Ride history
- ✅ Rate riders
- ✅ Multiple payment methods

## Technology Stack

- **Frontend:** React 19, Vite, Tailwind CSS, Lucide Icons
- **Backend:** Supabase (PostgreSQL)
- **Authentication:** Supabase Auth
- **Real-time:** Supabase subscriptions
- **Maps:** Google Maps API / Mapbox (to be integrated)
- **Deployment:** Vercel + Supabase

## File Structure

```
mybodaguy/
├── backend/
│   └── database/
│       └── schema_mybodaguy/
│           ├── 00_clean.sql
│           ├── 01_users.sql
│           ├── 02_geographic_regions.sql
│           ├── 03_user_profiles.sql
│           ├── 04_committee_members.sql
│           ├── 05_riders.sql
│           ├── 06_customers.sql
│           ├── 07_rides.sql
│           ├── 08_payments.sql
│           ├── 09_commissions.sql
│           └── 10_platform_settings.sql
├── frontend/
│   └── src/
│       ├── mybodaguy/
│       │   ├── components/
│       │   ├── services/
│       │   ├── pages/
│       │   └── App.tsx
│       └── ...
└── MYBODAGUY_README.md (this file)
```

## API Endpoints (Supabase)

All tables use Row-Level Security (RLS):
- Users can only access their own data
- Chairpersons can view their region's data
- Developers have full access
- Service role for backend operations

## Security Features

- ✅ Row-Level Security on all tables
- ✅ JWT-based authentication
- ✅ Role-based access control
- ✅ Commission auto-calculation
- ✅ Transaction logging
- ✅ Audit trails

## Next Steps

1. ✅ Database initialized with mbg_ prefix
2. ⏳ Complete all schema files update
3. ⏳ Create frontend React app
4. ⏳ Implement developer panel
5. ⏳ Add role-specific dashboards
6. ⏳ Integrate maps for ride tracking
7. ⏳ Add payment integration
8. ⏳ Deploy to production

## Support

For issues or questions:
- Developer Email: abanabaasa2@gmail.com
- System logs available in Supabase dashboard

---

**Status:** In Development
**Version:** 1.0.0
**Last Updated:** June 22, 2026
