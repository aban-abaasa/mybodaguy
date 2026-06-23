# My Boda Guy - Quick Start Guide

## 🚀 Get Started in 5 Minutes

### Step 1: Database Setup (2 minutes)

```bash
# Navigate to backend
cd backend

# Install dependencies (if not already installed)
npm install

# Initialize My Boda Guy database
node initialize_mybodaguy.js
```

**Note:** This creates all tables with `mbg_` prefix to avoid conflicts with other apps in your Supabase.

### Step 2: Frontend Setup (1 minute)

```bash
# Navigate to frontend
cd frontend

# Install dependencies (if not already installed)
npm install

# Start development server
npm run dev
```

### Step 3: Access the App (30 seconds)

1. Open browser to: http://localhost:5173
2. You'll see two apps:
   - **Cyberlearn** (original app) - still available
   - **My Boda Guy** (new app) - access via mybodaguy.html

### Step 4: Developer Login (30 seconds)

1. Click "Get Started" or "Sign In"
2. Enter credentials:
   - **Email:** abanabaasa2@gmail.com
   - **Password:** @1997God
3. You're automatically logged in as Developer!

### Step 5: Start Building (1 minute)

From the Developer Dashboard you can:
- ✅ View all users
- ✅ Manage geographic regions
- ✅ Configure commissions
- ✅ Assign chairpersons
- ✅ Monitor platform analytics

## 🎯 Key Features Ready

### ✅ Completed
- User authentication with role detection
- Developer panel with hardcoded access
- Landing page with features
- Role-based dashboards (Developer, Chairperson, Rider, Customer)
- Database schema with mbg_ prefix
- User management interface

### 🔄 Coming Next
- Region management (Districts → Stages)
- Chairperson assignment flow
- Rider registration & approval
- Ride booking system
- Real-time tracking
- Commission calculation
- Payment integration

## 📋 Database Tables Created

All tables use `mbg_` prefix:

```
✅ mbg_users - User authentication and roles
✅ mbg_user_profiles - Extended user information
✅ mbg_districts - District level regions
✅ mbg_divisions - Division level regions
✅ mbg_subcounties - Subcounty level regions
✅ mbg_parishes - Parish level regions
✅ mbg_stages - Stage level (physical boda stations)
✅ mbg_committee_members - Chairpersons at all levels
✅ mbg_riders - Rider profiles
✅ mbg_customers - Customer profiles
✅ mbg_rides - Ride bookings and tracking
✅ mbg_payments - Payment transactions
✅ mbg_commissions - Commission distribution
✅ mbg_platform_settings - Platform configuration
```

## 🔐 Access Levels

### Developer (You)
- Email: abanabaasa2@gmail.com
- Full system access
- Automatically assigned on first sign-in

### Other Users
- Sign up normally
- Assigned as 'customer' by default
- Developer can promote to chairperson/rider

## 🎨 Color Scheme

- Primary: Orange (#f97316)
- Secondary: Yellow (#eab308)
- Background: Slate/White
- Accent: Gradient orange to yellow

## 🚦 Running Both Apps

### Cyberlearn (Original)
- Access: http://localhost:5173
- Tables: Without prefix (companies, departments, etc.)

### My Boda Guy (New)
- Access: http://localhost:5173/mybodaguy.html
- Tables: With mbg_ prefix (mbg_users, mbg_rides, etc.)

**Both apps share the same Supabase instance without conflicts!**

## 📱 Next Development Steps

1. **Region Setup UI** - Add/edit districts, divisions, etc.
2. **Chairperson Assignment** - Assign users to hierarchical roles
3. **Rider Onboarding** - Registration and approval workflow
4. **Ride Booking** - Customer request ride interface
5. **Real-time Tracking** - GPS and live updates
6. **Commission Engine** - Automatic calculation and distribution
7. **Payment Integration** - Mobile money and cash
8. **Analytics Dashboard** - Charts and statistics

## 🆘 Troubleshooting

### Database Issues
- Check Supabase credentials in `.env.local`
- Verify tables created with `mbg_` prefix
- Check Supabase SQL Editor for errors

### Login Issues
- Verify email: abanabaasa2@gmail.com
- Password: @1997God
- Check Supabase Auth users table

### Role Issues
- Check `mbg_users` table for role_type
- Should be 'developer' for your email
- Trigger should auto-assign on signup

## 📞 Support

Developer: abanabaasa2@gmail.com

## 🎉 You're Ready!

Start building the best boda boda platform in Uganda! 🇺🇬

---

**Status:** Development Ready
**Version:** 1.0.0
**Date:** June 22, 2026
