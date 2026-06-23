# Rider Matching Algorithm Documentation

## Overview
The My Boda Guy platform implements an intelligent rider matching algorithm that optimizes both customer experience and rider earnings through location knowledge, flexible work modes, and smart pricing.

## Core Algorithm Features

### 1. Location Knowledge System

#### For Riders:
- **Home Base Registration**: Riders register their primary/home location during signup
- **Known Areas Map**: Riders can mark multiple areas they know well
- **Area Discovery**: System tracks all registered locations as available service areas
- **Knowledge Sharing**: Multiple riders can mark the same location they're familiar with

#### Benefits:
- Customers get riders who know exact destinations
- Reduces navigation time and errors
- Improves service quality and delivery accuracy

### 2. Rider Work Modes

Riders can switch between three operational modes:

#### **Normal Mode**
- Standard pricing (0% adjustment)
- Regular earnings
- Balanced ride request distribution
- Standard commission rates

#### **VIP Mode**
- **+20% price increase** for premium service
- Priority matching for high-value customers
- Premium service badge
- Higher earnings per ride
- Customers looking for quality service see VIP riders first

#### **Return Home Mode**
- **Up to 50% discount** for customers
- Riders heading towards their home base
- Customers benefit from cheaper rides
- Riders get paid while going home
- Win-win pricing model

### 3. Supermarket Partnership Program

#### For Riders:
- Apply to work for specific supermarkets/businesses
- Each supermarket has its own commission rate (typically 12-20%)
- Distance-based matching with supermarket locations
- Application status tracking (pending, approved, rejected)

#### For Supermarkets:
- Dedicated delivery riders who know local routes
- Reliable delivery service
- Performance tracking and rating system

#### For Customers:
- Browse connected supermarkets
- Order items for delivery
- Get riders familiar with supermarket and delivery areas

## Smart Matching Algorithm

### Prioritization Factors

The algorithm ranks available riders based on:

1. **Location Knowledge Score** (Highest Priority)
   - Does the rider know the destination area?
   - Distance from rider's known areas to destination
   - Home base proximity to route

2. **Current Mode**
   - Return mode riders heading in customer's direction (Best value)
   - Normal mode riders (Standard service)
   - VIP mode riders (Premium service)

3. **Distance & ETA**
   - Current distance from pickup point
   - Estimated arrival time
   - Route efficiency

4. **Rider Reputation**
   - Overall rating (1-5 stars)
   - Total completed rides
   - Customer feedback history

5. **Pricing Calculation**
   ```
   Base Price = Distance × Base Rate
   
   Final Price = Base Price × Mode Multiplier
   
   Where Mode Multiplier:
   - VIP Mode: 1.20 (20% increase)
   - Normal Mode: 1.00 (no change)
   - Return Mode: 0.50 - 0.90 (10-50% discount based on route alignment)
   ```

### Matching Flow

```
Customer Request
    ↓
Parse Pickup & Dropoff Locations
    ↓
Query Available Riders
    ↓
Filter by:
  - Online status
  - Distance from pickup (< 5km preferred)
  - Active mode
    ↓
Calculate Knowledge Score:
  - Rider knows destination area? +100 points
  - Rider's home base near destination? +50 points
  - Previously served this route? +25 points
    ↓
Calculate Mode Score:
  - Return mode to destination? +75 points
  - VIP mode? +50 points
  - Normal mode? +25 points
    ↓
Sort by:
  1. Knowledge Score (DESC)
  2. Mode Score (DESC)
  3. Rating (DESC)
  4. Distance (ASC)
    ↓
Present Top Matches to Customer
```

## Customer Benefits

1. **Guaranteed Local Knowledge**: Get riders who know exactly where to go
2. **Price Options**: Choose between VIP service or budget-friendly return rides
3. **Transparency**: See rider ratings, distance, and pricing upfront
4. **Quick Service**: Reduced pickup times through smart proximity matching
5. **Supermarket Integration**: Seamless delivery from favorite stores

## Rider Benefits

1. **Flexible Earnings**: Switch modes based on time of day and goals
2. **Work Smart**: Earn more in VIP mode during peak hours
3. **Efficient Returns**: Get paid while heading home
4. **Multiple Income Streams**: 
   - Regular rides
   - Supermarket deliveries (with commission)
   - VIP premiums
5. **Territory Control**: Mark areas you know best for competitive advantage

## Implementation Components

### Frontend Components Created:

1. **RiderLocationManager.tsx**
   - Add/remove known areas
   - Set home base location
   - Visual area management
   - Tips for maximizing ride requests

2. **RiderModeSelector.tsx**
   - Switch between Normal/VIP/Return modes
   - Visual mode comparison
   - Real-time earnings preview
   - Mode-specific benefits display

3. **SupermarketPartnership.tsx**
   - Browse available supermarkets
   - Apply for partnerships
   - Track application status
   - View commission rates and distance

4. **EnhancedRideRequest.tsx**
   - Smart location input
   - Real-time rider matching
   - Visual rider comparison
   - Transparent pricing display
   - Mode indicators (VIP/Return badges)
   - Knowledge indicators (destination familiarity)

### Updated Dashboards:

1. **RiderDashboard**
   - Overview with earnings stats
   - Quick access to mode switching
   - Area management
   - Partnership applications
   - Tabbed navigation

2. **CustomerDashboard**
   - Enhanced ride request flow
   - Matched rider cards with full details
   - Delivery ordering (supermarket integration)
   - Ride history tracking

## Next Steps (Backend Implementation Needed)

### Database Schema:
1. **rider_locations** table
   - rider_id, location_name, address, latitude, longitude, is_home, created_at

2. **rider_modes** table
   - rider_id, current_mode, mode_changed_at

3. **supermarket_partnerships** table
   - id, supermarket_id, rider_id, status, commission_rate, applied_at

4. **ride_requests** table
   - id, customer_id, rider_id, pickup_location, dropoff_location, price, mode, status

5. **ride_history** table
   - Track completed rides, ratings, earnings

### API Endpoints:
- `POST /api/riders/locations` - Add known location
- `DELETE /api/riders/locations/:id` - Remove location
- `PUT /api/riders/mode` - Update work mode
- `POST /api/partnerships/apply` - Apply to supermarket
- `POST /api/rides/match` - Match riders (algorithm implementation)
- `POST /api/rides/request` - Create ride request
- `GET /api/rides/history` - Get ride history

### Algorithm Services:
- Location knowledge scoring service
- Mode pricing calculator
- Real-time rider availability tracker
- Route optimization engine
- Commission calculation service

## Testing Scenarios

1. **Return Mode Discount Validation**
   - Rider heading home should offer 30-50% discount
   - Price should be attractive but profitable

2. **VIP Mode Premium**
   - Verify 20% price increase
   - Ensure VIP riders appear first for quality-seeking customers

3. **Knowledge Priority**
   - Riders who know destination should rank higher
   - Even if farther away initially

4. **Distance Limits**
   - Don't show riders more than 10km from pickup
   - Prioritize riders within 3km

5. **Multiple Mode Availability**
   - Customer should see mix of modes
   - Allow choice based on budget/preference

## Future Enhancements

1. **Dynamic Pricing**: Surge pricing during peak hours
2. **Route History Learning**: ML-based route familiarity scoring
3. **Customer Preferences**: Save favorite riders
4. **Subscription Plans**: Monthly plans for regular customers
5. **Corporate Accounts**: Business-to-business delivery services
6. **Real-time Tracking**: Live GPS tracking during rides
7. **In-app Chat**: Customer-rider communication
8. **Multi-stop Rides**: Add waypoints to rides
9. **Scheduled Rides**: Book rides in advance
10. **Loyalty Programs**: Rewards for frequent riders and customers
