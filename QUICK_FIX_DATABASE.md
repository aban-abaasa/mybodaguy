# Quick Fix: Run Database Setup

## The Problem
You see: "Database tables may not be initialized. Please run the SQL setup in Supabase."

## The Solution (2 minutes)

### Step 1: Open Supabase Dashboard
Go to: https://app.supabase.com/project/hswxazpxcgtqbxeqcxxw/sql/new

### Step 2: Copy the Complete SQL
Open this file: `backend/database/COMPLETE_MYBODAGUY_SETUP.sql`

Copy ALL the content (Ctrl+A, Ctrl+C)

### Step 3: Paste and Run
1. Paste into the Supabase SQL Editor
2. Click "RUN" button (bottom right)
3. Wait 5-10 seconds for it to complete
4. You should see "Success. No rows returned"

### Step 4: Refresh Your App
1. Go back to your app: http://localhost:5173
2. Sign in with Google (it's already configured!)
3. You'll be automatically logged in

## Google Sign-In Already Works!
- ✅ Google OAuth is already configured in Supabase
- ✅ The sign-in button is in the code
- ✅ All you needed was the database tables

## After Setup
When you sign in:
- First time users → Customer role (can request rides)
- abanabaasa2@gmail.com → Developer role (full access)

That's it! 🎉
