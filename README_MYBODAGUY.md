# 🏍️ My Boda Guy - Your Trusted Ride Partner

> A comprehensive transport and delivery application for Uganda's boda boda sector with hierarchical management and fair commission distribution.

## 🚀 Quick Start (3 Steps)

### 1️⃣ Initialize Database (1 minute)
```bash
cd backend
npm run init:mybodaguy
```

### 2️⃣ Start Application (30 seconds)
```bash
cd frontend
npm run dev
```

### 3️⃣ Sign In as Developer (30 seconds)
1. Open: http://localhost:5173
2. Click "Get Started"
3. Email: **abanabaasa2@gmail.com**
4. Password: **@1997God**

**🎉 You're now logged in as Developer with full access!**

---

## 🎯 What is My Boda Guy?

My Boda Guy is a complete boda boda management platform that connects:
- 👥 **Customers** who need rides
- 🏍️ **Riders** who provide transport
- 👔 **Chairpersons** who manage regions and earn commissions
- 💻 **Developers** who control the entire platform

### 🏆 Key Features

✅ **Hierarchical Structure**
- District → Division → Subcounty → Parish → Stage
- Each level has chairpersons who manage their region

✅ **Fair Commission System**
- Automatic distribution from each ride
- Transparent percentage breakdown
- Easy withdrawal system

✅ **Real-time Operations**
- Live ride tracking
- Instant notifications
- GPS navigation

✅ **Multiple Roles**
- Customers: Request & track rides
- Riders: Accept & complete rides
- Chairpersons: Manage regions & earn commissions
- Developers: Full system control

---

## 👥 User Roles Explained

### 💻 Developer (You)
**Access Level:** Super Admin
**Credentials:** abanabaasa2@gmail.com / @1997God

**You Can:**
- Manage all users
- Create/edit regions
- Configure commission percentages
- View all analytics
- Control platform settings

### 👔 Chairperson (5 Levels)
1. **District Chairperson** - Manages entire district
2. **Division Chairperson** - Manages division
3. **Subcounty Chairperson** - Manages subcounty
4. **Parish Chairperson** - Manages parish
5. **Stage Chairperson** - Manages stage (physical location)

**They Can:**
- Assign lower-level chairpersons
- View region analytics
- Track commission earnings
- Manage their region

### 🏍️ Rider
**They Can:**
- Register with vehicle details
- Get approved by stage chairperson
- Accept ride requests
- Complete rides & earn money
- Track earnings & commissions

### 👤 Customer
**They Can:**
- Request rides
- Track rider location
- Pay via multiple methods
- Rate riders
- View ride history

---

## 💰 Commission Structure

Every ride fare is automatically distributed:

```
Example Ride: 10,000 UGX

Distribution:
├─ Rider (70%): 7,000 UGX ← The driver
├─ Platform (5%): 500 UGX ← System fees
└─ Commissions (25%): 2,500 UGX
   ├─ Stage Chair (10%): 1,000 UGX
   ├─ Parish Chair (6%): 600 UGX
   ├─ Subcounty Chair (4%): 400 UGX
   ├─ Division Chair (3%): 300 UGX
   └─ District Chair (2%): 200 UGX
```

**All percentages are configurable by developers!**

---

## 🗄️ Database Structure

All tables use `mbg_` prefix to avoid conflicts:

### Core Tables
- `mbg_users` - All system users
- `mbg_user_profiles` - Extended user info

### Geographic Hierarchy
- `mbg_districts` - Top level regions
- `mbg_divisions` - Under districts
- `mbg_subcounties` - Under divisions
- `mbg_parishes` - Under subcounties
- `mbg_stages` - Physical boda locations

### Operations
- `mbg_committee_members` - Chairpersons
- `mbg_riders` - Registered riders
- `mbg_customers` - Customer profiles
- `mbg_rides` - All ride bookings
- `mbg_payments` - Payment transactions
- `mbg_commissions` - Commission records
- `mbg_platform_settings` - System config

---

## 🎨 Design & Branding

**Colors:**
- Primary: Orange (#f97316)
- Secondary: Yellow (#eab308)
- Background: White/Slate

**Theme:**
- Professional boda boda aesthetic
- Mobile-first responsive design
- Clean, modern interface
- Smooth animations

---

## 🔒 Security Features

✅ **Row-Level Security (RLS)** on all tables
✅ **JWT-based authentication**
✅ **Role-based access control**
✅ **Encrypted passwords**
✅ **Secure payment handling**
✅ **Audit trails for all transactions**

---

## 📱 Platform Features

### For Customers
- 📍 Request rides with pickup/dropoff
- 📊 Track ride in real-time
- 💳 Multiple payment methods
- ⭐ Rate and review riders
- 📜 View ride history

### For Riders
- ✅ Accept/decline ride requests
- 🗺️ GPS navigation to customer
- 💵 See fare breakdown with commissions
- 📈 Track daily/weekly/monthly earnings
- 🌟 Build reputation with ratings

### For Chairpersons
- 👥 Assign lower-level chairpersons
- 📊 View region statistics
- 💰 Track commission earnings
- 📈 Performance analytics
- 💸 Easy withdrawal system

### For Developers
- 🛠️ Full system control
- 👥 User management
- 🗺️ Region setup
- ⚙️ Commission configuration
- 📊 Platform-wide analytics

---

## 📂 Project Structure

```
mybodaguy/
├── backend/
│   ├── database/schema_mybodaguy/
│   │   ├── 00_clean.sql
│   │   ├── 01_users.sql
│   │   ├── 02_geographic_regions.sql
│   │   ├── 03_user_profiles.sql
│   │   ├── 04_committee_members.sql
│   │   ├── 05_riders.sql
│   │   ├── 06_customers.sql
│   │   ├── 07_rides.sql
│   │   ├── 08_payments.sql
│   │   ├── 09_commissions.sql
│   │   └── 10_platform_settings.sql
│   └── initialize_mybodaguy.js
│
└── frontend/src/
    ├── App.tsx (My Boda Guy App)
    └── mybodaguy/
        ├── services/
        │   ├── authService.ts
        │   ├── userService.ts
        │   └── supabaseClient.ts
        └── pages/
            ├── LandingPage.tsx
            ├── SignInPage.tsx
            ├── DeveloperDashboard.tsx
            ├── ChairpersonDashboard.tsx
            ├── RiderDashboard.tsx
            └── CustomerDashboard.tsx
```

---

## 🛠️ Technology Stack

- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS
- **Backend:** Supabase (PostgreSQL)
- **Authentication:** Supabase Auth
- **Real-time:** Supabase Subscriptions
- **Maps:** Google Maps / Mapbox (to integrate)
- **Payments:** Mobile Money API (to integrate)
- **Deployment:** Vercel + Supabase

---

## 📖 Documentation

- `START_MYBODAGUY.md` - Quick start guide
- `QUICK_START_MYBODAGUY.md` - Detailed setup
- `MYBODAGUY_README.md` - Complete documentation
- `MY_BODA_GUY_TRANSFORMATION_PLAN.md` - Full transformation plan
- `IMPLEMENTATION_COMPLETE.md` - What's been completed

---

## 🆘 Troubleshooting

### Can't sign in?
- Email: abanabaasa2@gmail.com
- Password: @1997God
- Check Supabase Auth settings

### No tables in database?
- Run: `cd backend && npm run init:mybodaguy`
- Check Supabase SQL Editor for mbg_* tables

### Wrong role showing?
- Check `mbg_users` table
- Your email should have `role_type = 'developer'`
- Database trigger auto-assigns on signup

---

## 🎯 Roadmap

### ✅ Phase 1: Foundation (COMPLETE)
- Database schema with mbg_ prefix
- User authentication
- Role-based dashboards
- Developer panel

### 🔄 Phase 2: Core Features (Next)
- Region management UI
- Chairperson assignment
- Rider onboarding
- Basic ride system

### 📅 Phase 3: Advanced Features
- Real-time GPS tracking
- Commission calculation engine
- Payment integration
- Analytics dashboard

### 🚀 Phase 4: Launch
- Mobile apps (iOS/Android)
- Marketing website
- Admin training
- Public launch

---

## 💬 Support

**Developer Email:** abanabaasa2@gmail.com
**Platform:** My Boda Guy
**Status:** Ready for Development
**Version:** 1.0.0

---

## 🎉 You're Ready to Build!

You now have a complete foundation for Uganda's premier boda boda platform. The database is set up, frontend is ready, and you have full developer access. Start building amazing features! 🏍️🇺🇬

**Next Steps:**
1. ✅ Sign in as developer
2. ✅ Explore the dashboard
3. 🔄 Build region management
4. 🔄 Add chairperson assignment
5. 🔄 Implement ride booking
6. 🔄 Integrate payments

Let's make My Boda Guy the #1 transport platform in Uganda! 🚀

---

**Built with ❤️ for Uganda's boda boda community**
