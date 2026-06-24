# 🎨 Role Switching Visual Guide

## What You'll See After Implementation

---

## Scenario 1: User with Multiple Roles (Chairperson + Rider)

### Initial Login - Chairperson View (Default)
```
┌─────────────────────────────────────────────────────────────┐
│ 🏍️ My Boda Guy              user@email.com    [Sign Out]    │ 
│ Chairperson Dashboard                                       │
│ ───────────────────────────────────────────────────────────│
│ [Chairperson] │ Rider │ Customer                           │ ← Role Tabs
├─────────────────────────────────────────────────────────────┤
│                  ORANGE-YELLOW GRADIENT                      │
│                                                              │
│  Welcome, Chairperson!                                      │
│  📍 3 Active Roles • Managing 5 Chairpersons • 12 Riders   │
│                                                              │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐  │
│  │My Roles│ │  Total │ │ Active │ │Commiss.│ │ Rides  │  │
│  │   3    │ │  Chairs│ │   5    │ │   5%   │ │  145   │  │
│  └────────┘ └────────┘ └────────┘ └────────┘ └────────┘  │
│                                                              │
│  Your Chairpersons                        [+ Assign New]   │
│  ┌──────────────────────────────────────────────────────┐ │
│  │ 👤 John Doe - Division Chairperson • Active • 5%    │ │
│  │ 👤 Jane Smith - Parish Chairperson • Active • 3%    │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                              │
│  Your Riders (from 2 stage assignments)  [+ Assign Rider] │
│  ┌──────────────────────────────────────────────────────┐ │
│  │ 🏍️ Mike Johnson - Motorcycle • Active • ⭐4.8       │ │
│  │ 🏍️ Sarah Wilson - Boda Boda • Active • ⭐4.9        │ │
│  └──────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Click "Rider" Tab - Rider View
```
┌─────────────────────────────────────────────────────────────┐
│ 🏍️ My Boda Guy              user@email.com    [Sign Out]    │
│ Rider Dashboard                                             │
│ ───────────────────────────────────────────────────────────│
│ Chairperson │ [Rider] │ Customer                           │ ← Role Tabs
├─────────────────────────────────────────────────────────────┤
│                  GREEN-EMERALD GRADIENT                      │
│                                                              │
│  ┌──── Rider Navigation Tabs (Desktop) ────────────────┐   │
│  │ [Overview] │ Work Mode │ Areas │ Markets            │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
│  Today's Earnings       Rides Done      Rating    Mode     │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐             │
│  │ 💰     │ │ 🏍️     │ │ ⭐     │ │ ⚙️     │             │
│  │UGX 45k │ │   8    │ │ 4.8⭐  │ │ Normal │             │
│  └────────┘ └────────┘ └────────┘ └────────┘             │
│                                                              │
│  Quick Start                                                │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐      │
│  │ ⚙️ Set Work  │ │ 🗺️ Manage    │ │ 🛒 Partner   │      │
│  │    Mode      │ │    Areas     │ │    Markets   │      │
│  │ VIP, Normal, │ │ Mark known   │ │ Work for     │      │
│  │ Discount,    │ │ locations    │ │ supermarkets │      │
│  │ Return       │ │              │ │              │      │
│  └──────────────┘ └──────────────┘ └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

---

## Scenario 2: User with Single Role (Rider Only)

### No Tabs - Direct Dashboard
```
┌─────────────────────────────────────────────────────────────┐
│ 🏍️ My Boda Guy              user@email.com    [Sign Out]    │
│ Rider Dashboard                                             │
├─────────────────────────────────────────────────────────────┤
│                  GREEN-EMERALD GRADIENT                      │
│                                                              │
│  ┌──── Rider Navigation Tabs ────────────────────────┐     │
│  │ [Overview] │ Work Mode │ Areas │ Markets           │     │
│  └────────────────────────────────────────────────────┘     │
│                                                              │
│  [Rider Dashboard Content - Same as above]                  │
└─────────────────────────────────────────────────────────────┘
```

---

## Mobile View: Multi-Role User

### Chairperson View (Mobile)
```
┌──────────────────────────┐
│ 🏍️ My Boda Guy     [⚡]  │
│ Chairperson Dashboard    │
│ ─────────────────────────│
│ [Chairperson] Rider Cust │ ← Scrollable
├──────────────────────────┤
│   ORANGE-YELLOW BG       │
│                          │
│ Welcome, Chairperson!    │
│ 📍 3 Roles • 5 Chairs    │
│                          │
│ ┌─────┐ ┌─────┐         │
│ │Roles│ │Total│         │
│ │  3  │ │ 5  │         │
│ └─────┘ └─────┘         │
│                          │
│ Your Chairpersons        │
│ [+ Assign]               │
│ ┌────────────────────┐  │
│ │👤 John Doe         │  │
│ │Division Chair • 5% │  │
│ └────────────────────┘  │
└──────────────────────────┘
```

### Switch to Rider (Mobile)
```
┌──────────────────────────┐
│ 🏍️ My Boda Guy     [⚡]  │
│ Rider Dashboard          │
│ ─────────────────────────│
│ Chairperson [Rider] Cust │ ← Tab Changed
├──────────────────────────┤
│   GREEN-EMERALD BG       │
│                          │
│ ⚙️ Overview        [☰]  │ ← Current Tab
│                          │
│ ┌──────┐ ┌──────┐       │
│ │💰    │ │🏍️    │       │
│ │45k   │ │  8   │       │
│ └──────┘ └──────┘       │
│                          │
│ Quick Start              │
│ ┌──────────────────┐    │
│ │ ⚙️ Set Work Mode  │    │
│ │ VIP, Normal...   │    │
│ └──────────────────┘    │
│                          │
│ [Tap ☰ for menu]        │
└──────────────────────────┘
```

### Mobile Menu (When ☰ Clicked)
```
┌──────────────────────────┐
│ 🏍️ My Boda Guy     [⚡]  │
│ Rider Dashboard          │
│ ─────────────────────────│
│ Chairperson [Rider] Cust │
├──────────────────────────┤
│   ┌──────────────────┐  │
│   │ Overview         │  │ ← Dropdown
│   │ ⚙️ Work Mode     │  │   Menu
│   │ 🗺️ Areas        │  │
│   │ 🛒 Markets      │  │
│   │ ───────────────  │  │
│   │ 👤 My Profile   │  │
│   └──────────────────┘  │
│                          │
└──────────────────────────┘
```

---

## Color Scheme Per Role

### 🔵 Developer
- **Header**: Blue to Indigo gradient
- **Background**: Light blue to indigo tint
- **Active Tab**: White text + white underline

### 🟠 Chairperson (Default for multi-role)
- **Header**: Orange to Yellow gradient
- **Background**: Light orange to yellow tint
- **Active Tab**: White text + white underline

### 🟢 Rider
- **Header**: Green to Emerald gradient
- **Background**: Light green to emerald tint
- **Active Tab**: White text + white underline

### 🟣 Customer
- **Header**: Purple to Pink gradient
- **Background**: Light purple to pink tint
- **Active Tab**: White text + white underline

---

## Tab Behavior

### Desktop:
- **Inactive tabs**: White text at 70% opacity
- **Hover**: White text at 90% opacity
- **Active tab**: 
  - White text at 100% opacity
  - White bottom border (2px)
  - No background change

### Mobile:
- Tabs scroll horizontally if screen too narrow
- Same hover/active states as desktop
- Tap to switch instantly

---

## Key Visual Indicators

### ✅ You're on Chairperson Dashboard:
- Orange-yellow gradient everywhere
- "Chairperson Dashboard" subtitle
- "Chairperson" tab has white underline
- See subordinates and riders

### ✅ You're on Rider Dashboard:
- Green-emerald gradient everywhere
- "Rider Dashboard" subtitle
- "Rider" tab has white underline
- See work modes, areas, partnerships

### ✅ Background Changes Instantly:
- No page reload
- Smooth transition between gradients
- Dashboard content swaps immediately

---

## Testing Indicators

When testing, look for:
1. ✅ **No duplicate headers** (should only see one "My Boda Guy" logo)
2. ✅ **Clean tabs** at top below logo (horizontal row)
3. ✅ **Active tab** clearly marked with white underline
4. ✅ **Background color** matches active role
5. ✅ **Dashboard content** changes when clicking tabs
6. ✅ **Sign out** button visible in unified header

---

## What Changed Visually

### Before (Broken):
```
❌ Each dashboard had its own header
❌ Duplicate "My Boda Guy" logos
❌ No clear way to switch roles
❌ JSX syntax error prevented loading
```

### After (Fixed):
```
✅ Single unified header for all dashboards
✅ Clean role tabs at top
✅ Background changes per role
✅ No duplicate headers
✅ Smooth role switching
```

---

## User Journey Example

**Story**: Sarah is a Parish Chairperson who also rides

1. **Logs in** → Sees Chairperson dashboard (orange background)
2. **Checks subordinates** → Sees 3 chairpersons she manages
3. **Clicks "Rider" tab** → Background turns green
4. **Sets work mode** → Chooses "Discount Mode" at 15% off
5. **Marks known areas** → Adds 5 locations she knows well
6. **Clicks "Chairperson" tab** → Back to orange background
7. **Assigns new subordinate** → Promotes someone to Stage Chairperson
8. **Signs out** → From unified header button

---

## Pro Tips for Users

### 🎯 Want to switch roles fast?
- Just click the role name at the top
- No page reload needed
- Your data in each role stays as-is

### 🎯 Lost which role you're in?
- Look at the background color
- Check which tab has the white underline
- Read the subtitle under "My Boda Guy"

### 🎯 On mobile?
- Swipe the role tabs left/right
- Use the ☰ menu for rider navigation
- Sign out button is the lightning icon ⚡

---

**Visual Guide Status**: ✅ Complete
**Implementation Date**: 2026-06-24
**System**: MyBodaGuy Multi-Role Platform
