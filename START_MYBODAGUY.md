# 🚀 Start My Boda Guy - Complete Guide

## ✅ Step 1: Initialize Database (2 minutes)

Open terminal in the `backend` folder:

```bash
cd backend
npm install
npm run init:mybodaguy
```

This creates all My Boda Guy tables with `mbg_` prefix in your Supabase database.

## ✅ Step 2: Start Frontend (30 seconds)

Open terminal in the `frontend` folder:

```bash
cd frontend
npm install
npm run dev
```

The app will start at: **http://localhost:5173**

## ✅ Step 3: Sign In as Developer (30 seconds)

1. Open http://localhost:5173
2. Click "Get Started"
3. Sign in with:
   - **Email:** abanabaasa2@gmail.com
   - **Password:** @1997God
4. You're automatically logged in as Developer! 🎉

## 🎯 What You'll See

### Developer Dashboard Includes:
- ✅ **Overview** - Platform statistics
- ✅ **Users** - View all registered users
- ✅ **Regions** - Manage geographic hierarchy
- ✅ **Commissions** - Configure percentages
- ✅ **Settings** - Platform configuration

## 📊 Database Tables Created

All tables use `mbg_` prefix (to avoid conflicts):

```
✅ mbg_users
✅ mbg_user_profiles  
✅ mbg_districts
✅ mbg_divisions
✅ mbg_subcounties
✅ mbg_parishes
✅ mbg_stages
✅ mbg_committee_members
✅ mbg_riders
✅ mbg_customers
✅ mbg_rides
✅ mbg_payments
✅ mbg_commissions
✅ mbg_platform_settings
```

## 🎨 UI Features

- **Orange/Yellow Theme** - Professional boda boda branding
- **Responsive Design** - Works on mobile and desktop
- **Role-Based Dashboards** - Different views for each role
- **Clean Interface** - Modern, intuitive design

## 👥 User Roles

### 1. Developer (You)
- Full system control
- Hardcoded: abanabaasa2@gmail.com

### 2. Chairperson
- Manage their region
- Assign lower-level chairpersons
- Track commissions

### 3. Rider
- Accept ride requests
- Complete rides
- Track earnings

### 4. Customer
- Request rides
- Track location
- Rate riders

## 🔥 Quick Commands

### Backend
```bash
npm run init:mybodaguy     # Initialize My Boda Guy DB
npm run init               # Initialize old Cyberlearn DB
```

### Frontend
```bash
npm run dev                # Start development server
npm run build              # Build for production
```

## 🆘 Troubleshooting

### "Can't find tables"
- Run `npm run init:mybodaguy` in backend folder
- Check Supabase dashboard for mbg_* tables

### "Can't sign in"
- Verify email: abanabaasa2@gmail.com
- Password: @1997God
- Check Supabase Auth settings

### "Wrong role showing"
- Check mbg_users table
- role_type should be 'developer' for your email
- Trigger should auto-assign on first signin

## 📞 Need Help?

Check these files:
- `MYBODAGUY_README.md` - Full documentation
- `MY_BODA_GUY_TRANSFORMATION_PLAN.md` - Complete plan
- `QUICK_START_MYBODAGUY.md` - Detailed guide

## 🎉 You're Ready!

Start building the best boda boda platform! 🏍️🇺🇬

---

**Current Status:** Frontend replaced with My Boda Guy
**Your Role:** Developer (full access)
**Platform:** My Boda Guy Transport & Delivery
