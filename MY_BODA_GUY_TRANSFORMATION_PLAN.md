# My Boda Guy - Transformation Plan

## Overview
Transform the Cyberlearn cybersecurity training platform into "My Boda Guy" - a comprehensive transport and delivery application for boda boda (motorcycle taxi) management with hierarchical role-based system and commission tracking.

## Application Structure

### 1. **System Architecture**

```
My Boda Guy Platform
├── Developer Panel (Super Admin)
│   ├── System Configuration
│   ├── Global Settings
│   ├── Platform Analytics
│   └── Financial Overview
│
├── Hierarchical Role System
│   ├── District Chairperson (Level 1)
│   ├── Division Chairperson (Level 2)
│   ├── Subcounty Chairperson (Level 3)
│   ├── Parish Chairperson (Level 4)
│   ├── Stage Chairperson (Level 5)
│   └── Riders (Level 6)
│
├── Committee Management
│   ├── Committee Registration
│   ├── Commission Distribution
│   └── Performance Tracking
│
└── Ride Management
    ├── Ride Booking
    ├── Ride Tracking
    ├── Commission Calculation
    └── Payment Distribution
```

### 2. **Role Hierarchy & Permissions**

#### **Developer (Super Admin)**
- Full system access
- Manage all chairpersons at all levels
- View all financial transactions
- Configure commission percentages
- System-wide analytics
- Platform settings

#### **District Chairperson (Level 1)**
- Assign/manage Division Chairpersons
- View district-wide analytics
- Receive commission from all rides in district
- Manage district committee members
- Financial reports for district

#### **Division Chairperson (Level 2)**
- Assigned by District Chairperson
- Assign/manage Subcounty Chairpersons
- View division-wide analytics
- Receive commission from all rides in division
- Manage division committee members

#### **Subcounty Chairperson (Level 3)**
- Assigned by Division Chairperson
- Assign/manage Parish Chairpersons
- View subcounty-wide analytics
- Receive commission from all rides in subcounty
- Manage subcounty committee members

#### **Parish Chairperson (Level 4)**
- Assigned by Subcounty Chairperson
- Assign/manage Stage Chairpersons
- View parish-wide analytics
- Receive commission from all rides in parish
- Manage parish committee members

#### **Stage Chairperson (Level 5)**
- Assigned by Parish Chairperson
- Assign/manage Riders
- View stage-wide analytics
- Receive commission from all rides from their stage
- Manage stage operations
- Approve/reject rider applications

#### **Riders (Level 6)**
- Assigned by Stage Chairperson
- Accept/complete rides
- View earnings and commission breakdown
- Track ride history
- Update availability status
- Profile management

### 3. **Commission System**

#### **Commission Structure**
Each ride generates revenue that flows up the hierarchy:

```
Example: Ride Fare = 10,000 UGX

Distribution:
├── Platform Fee: 5% = 500 UGX
├── Rider Earnings: 70% = 7,000 UGX
└── Committee Commission: 25% = 2,500 UGX
    ├── Stage Chairperson: 10% = 1,000 UGX
    ├── Parish Chairperson: 6% = 600 UGX
    ├── Subcounty Chairperson: 4% = 400 UGX
    ├── Division Chairperson: 3% = 300 UGX
    └── District Chairperson: 2% = 200 UGX
```

**Commission percentages are configurable by Developer**

### 4. **Database Schema Changes**

#### **New Tables Needed:**

```sql
-- Geographic Regions
- districts (id, name, code, created_at)
- divisions (id, district_id, name, code, created_at)
- subcounties (id, division_id, name, code, created_at)
- parishes (id, subcounty_id, name, code, created_at)
- stages (id, parish_id, name, location_lat, location_lng, created_at)

-- Committee Structure
- committee_members (id, user_id, region_type, region_id, role, status, created_at)

-- Rides & Bookings
- rides (id, rider_id, customer_id, pickup_location, dropoff_location, 
  status, fare, distance, started_at, completed_at, created_at)

-- Commission Tracking
- commissions (id, ride_id, recipient_id, recipient_role, amount, 
  percentage, status, paid_at, created_at)

-- Riders
- riders (id, user_id, stage_id, vehicle_type, plate_number, 
  license_number, is_active, is_available, rating, created_at)

-- Customers
- customers (id, user_id, phone, default_location, rating, created_at)

-- Payments
- payments (id, ride_id, amount, payment_method, status, 
  transaction_id, created_at)

-- Platform Settings
- platform_settings (id, key, value, description, updated_at)
```

#### **Modified Tables:**

```sql
-- users (existing - minimal changes)
- Add: role_type ENUM('developer', 'chairperson', 'rider', 'customer')

-- user_profiles (major restructure)
- Remove: company_id, department_id (old structure)
- Add: region_type, region_id, hierarchy_level
- Update role to support new roles

-- Replace companies → districts
-- Replace departments → divisions/subcounties/parishes/stages
```

### 5. **Key Features**

#### **For Riders:**
- ✅ Accept ride requests
- ✅ Navigate to pickup/dropoff locations
- ✅ View earnings and commission breakdown
- ✅ Track ride history
- ✅ Update availability status
- ✅ View ratings and reviews
- ✅ Cash out earnings

#### **For Customers:**
- ✅ Request rides
- ✅ Track rider location in real-time
- ✅ View ride history
- ✅ Rate and review riders
- ✅ Manage payment methods
- ✅ Save favorite locations

#### **For Chairpersons (All Levels):**
- ✅ Assign lower-level chairpersons/riders
- ✅ View analytics for their region
- ✅ Track commission earnings
- ✅ Manage committee members
- ✅ View active rides in region
- ✅ Generate reports
- ✅ Withdraw commissions

#### **For Developers:**
- ✅ Full system control
- ✅ Configure commission percentages
- ✅ Manage all users and regions
- ✅ View platform-wide analytics
- ✅ Financial oversight
- ✅ System settings

### 6. **UI/UX Changes**

#### **Branding Update:**
- Name: "My Boda Guy"
- Primary Color: Orange/Yellow (typical boda boda colors)
- Icon: Motorcycle icon
- Theme: Transport & Delivery focused

#### **Dashboard Views by Role:**

**Developer Dashboard:**
- Platform statistics
- Total rides/revenue
- Commission overview
- User management
- System settings

**Chairperson Dashboard:**
- Region statistics
- Active riders count
- Commission earnings
- Assigned subordinates
- Region map view

**Rider Dashboard:**
- Ride requests (accept/decline)
- Current ride status
- Earnings today/week/month
- Commission breakdown
- Availability toggle
- Navigation map

**Customer Dashboard:**
- Request ride
- Active ride tracking
- Ride history
- Payment methods
- Saved locations

### 7. **Commission Flow Example**

```
1. Customer requests ride: 10,000 UGX
2. Rider accepts and completes ride
3. System calculates commission:
   
   Ride Fare: 10,000 UGX
   
   Automatic Distribution:
   ├── Rider (70%): 7,000 UGX → rider.earnings
   ├── Stage Chair (10%): 1,000 UGX → commission_pending
   ├── Parish Chair (6%): 600 UGX → commission_pending
   ├── Subcounty Chair (4%): 400 UGX → commission_pending
   ├── Division Chair (3%): 300 UGX → commission_pending
   ├── District Chair (2%): 200 UGX → commission_pending
   └── Platform Fee (5%): 500 UGX → platform.revenue

4. Commissions move to "paid" status after withdrawal
5. All transactions logged for audit trail
```

### 8. **Account Creation Flow**

#### **Chairperson Registration:**
1. User creates account
2. Assigned by higher-level chairperson OR developer
3. Committee details provided
4. Region/territory assigned
5. Account activated
6. Commission tracking begins

#### **Rider Registration:**
1. User creates account
2. Selects stage to join
3. Provides vehicle details (plate, license)
4. Uploads required documents
5. Stage chairperson approves
6. Account activated
7. Can start accepting rides

### 9. **Payment Integration**

#### **Supported Methods:**
- Mobile Money (MTN, Airtel)
- Cash (on delivery)
- Bank Transfer
- Card Payment (optional)

#### **Withdrawal System:**
- Minimum withdrawal amount
- Withdrawal to mobile money
- Withdrawal to bank account
- Transaction history
- Automated processing

### 10. **Real-time Features**

- Live ride tracking
- Real-time location updates
- Push notifications for:
  - New ride requests
  - Ride status updates
  - Commission earnings
  - New assignments
  - System announcements

### 11. **Analytics & Reporting**

#### **For Chairpersons:**
- Daily/weekly/monthly ride statistics
- Commission earnings breakdown
- Active riders count
- Region performance metrics
- Comparative analysis

#### **For Developers:**
- Platform-wide analytics
- Revenue trends
- User growth
- Popular routes
- Peak hours analysis
- Commission distribution

### 12. **Mobile Responsiveness**

- Fully responsive design
- Mobile-first approach
- Progressive Web App (PWA)
- Offline capability
- GPS/location services
- Push notifications

## Implementation Priority

### Phase 1: Foundation (Week 1-2)
1. ✅ Database schema restructure
2. ✅ User roles and authentication update
3. ✅ Basic region hierarchy setup
4. ✅ Updated user profiles

### Phase 2: Core Features (Week 3-4)
1. ✅ Ride management system
2. ✅ Commission calculation engine
3. ✅ Chairperson assignment flow
4. ✅ Rider management

### Phase 3: UI/UX (Week 5-6)
1. ✅ Rebrand to "My Boda Guy"
2. ✅ Dashboard views for each role
3. ✅ Map integration
4. ✅ Real-time tracking

### Phase 4: Payments (Week 7-8)
1. ✅ Payment integration
2. ✅ Withdrawal system
3. ✅ Transaction history
4. ✅ Commission distribution

### Phase 5: Polish & Launch (Week 9-10)
1. ✅ Testing all features
2. ✅ Performance optimization
3. ✅ Documentation
4. ✅ Deployment

## Technical Stack Retained

- **Frontend**: React 19, Vite, Tailwind CSS
- **Backend**: Supabase (PostgreSQL)
- **Authentication**: Supabase Auth
- **Real-time**: Supabase subscriptions
- **Maps**: Google Maps API / Mapbox
- **Deployment**: Vercel + Supabase

## Next Steps

1. Review and approve this transformation plan
2. Begin database schema migration
3. Update authentication and role system
4. Implement core ride management features
5. Rebuild UI with new branding

---

**Document Created:** June 22, 2026
**Status:** Awaiting Approval
**Estimated Timeline:** 10 weeks for complete transformation
