# 🔧 Google Sign-In Troubleshooting Guide

## 🚨 Problem: Cannot Sign In with Google

This guide will help you diagnose and fix Google OAuth sign-in issues.

---

## 📋 Quick Diagnosis Checklist

Check these in order:

1. [ ] Is Google OAuth enabled in Supabase?
2. [ ] Are the redirect URLs correctly configured?
3. [ ] Is the database trigger working?
4. [ ] Are there any console errors?
5. [ ] Is the auth callback route configured?

---

## 🔍 Step-by-Step Fix

### Step 1: Verify Supabase Google OAuth Configuration

#### A. Check if Google Provider is Enabled

1. Go to Supabase Dashboard: https://supabase.com/dashboard
2. Select your project
3. Navigate to: **Authentication → Providers**
4. Find **Google** in the list
5. Make sure it's **toggled ON** (green)

**If OFF:**
- Toggle it ON
- You'll need to add Client ID and Client Secret (see Step 2)

#### B. Verify Redirect URLs in Supabase

1. Go to: **Authentication → URL Configuration**
2. Check **Site URL**:
   ```
   http://localhost:5173
   ```
3. Check **Redirect URLs** - should include:
   ```
   http://localhost:5173/**
   https://<your-project-ref>.supabase.co/**
   ```

**If missing or incorrect:**
- Click "Add URL"
- Add the URLs above
- Click "Save"

---

### Step 2: Get/Verify Google OAuth Credentials

#### A. Go to Google Cloud Console

1. Visit: https://console.cloud.google.com
2. Sign in with your Google account
3. Select or create a project

#### B. Enable Required APIs

1. In the sidebar, click **APIs & Services → Library**
2. Search for "Google+ API" or "People API"
3. Click it and press **Enable**

#### C. Create OAuth 2.0 Credentials

1. Go to **APIs & Services → Credentials**
2. Click **+ CREATE CREDENTIALS → OAuth client ID**

**If you see "Configure consent screen first":**
1. Click **CONFIGURE CONSENT SCREEN**
2. Select **External** (or Internal for workspace)
3. Fill in:
   - App name: `My Boda Guy`
   - User support email: Your email
   - Developer contact: Your email
4. Click **Save and Continue**
5. Click **Save and Continue** (skip optional scopes)
6. Add test users if needed
7. Click **Save and Continue**

**Now create OAuth Client ID:**

1. Application type: **Web application**
2. Name: `My Boda Guy Web`

3. **Authorized JavaScript origins:**
   ```
   http://localhost:5173
   https://<your-project-ref>.supabase.co
   ```

4. **Authorized redirect URIs** (CRITICAL):
   ```
   http://localhost:5173
   https://<your-project-ref>.supabase.co/auth/v1/callback
   ```
   
   Replace `<your-project-ref>` with your actual Supabase project reference (e.g., `hswxazpxcgtqbxeqcxxw`)

5. Click **CREATE**

6. **Copy the credentials shown:**
   - Client ID: `123456-abcdef.apps.googleusercontent.com`
   - Client Secret: `GOCSPX-abc123...`

#### D. Add Credentials to Supabase

1. Go back to Supabase Dashboard
2. Navigate to: **Authentication → Providers → Google**
3. Paste:
   - **Client ID** (from Google)
   - **Client Secret** (from Google)
4. Click **Save**

---

### Step 3: Verify Frontend Configuration

#### A. Check Environment Variables

**File:** `frontend/.env.local`

Make sure it contains:
```env
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

**If missing or incorrect:**
1. Get from Supabase: **Settings → API**
2. Copy **URL** and **anon/public** key
3. Update `.env.local`
4. Restart dev server: `npm run dev`

#### B. Verify Auth Service Code

**File:** `frontend/src/mybodaguy/services/authService.ts`

Should contain:
```typescript
async signInWithGoogle() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}`,
    },
  });

  if (error) throw error;
  return data;
}
```

---

### Step 4: Check Database Trigger

The database should automatically create user records when someone signs in with Google.

#### A. Verify Trigger Exists

Run this in Supabase SQL Editor:

```sql
-- Check if trigger exists
SELECT 
  trigger_name, 
  event_manipulation, 
  event_object_table
FROM information_schema.triggers
WHERE trigger_name = 'on_auth_user_created_mbg';
```

**Expected Result:** Should show one row with trigger details

**If NO results:**
Run this to create it:

```sql
-- Create the trigger function
CREATE OR REPLACE FUNCTION public.handle_new_auth_user_mbg()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_role mbg_user_role_type;
BEGIN
  -- Check if this is the hardcoded developer account
  IF NEW.email = 'abanabaasa2@gmail.com' THEN
    user_role := 'developer';
  ELSE
    -- Everyone else starts as customer
    user_role := 'customer';
  END IF;

  -- Create user record
  INSERT INTO public.mbg_users (id, email, role_type)
  VALUES (NEW.id, COALESCE(NEW.email, ''), user_role)
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        role_type = user_role,
        updated_at = NOW();

  -- Create user profile
  INSERT INTO public.mbg_user_profiles (user_id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', 'User'))
  ON CONFLICT (user_id) DO NOTHING;

  -- Create customer profile for non-developers
  IF user_role = 'customer' THEN
    INSERT INTO public.mbg_customers (user_id)
    VALUES (NEW.id)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- Create the trigger
DROP TRIGGER IF EXISTS on_auth_user_created_mbg ON auth.users;
CREATE TRIGGER on_auth_user_created_mbg
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_auth_user_mbg();
```

---

### Step 5: Test Sign-In

#### A. Clear Browser Storage (Important!)

1. Open DevTools (F12)
2. Go to **Application** tab
3. **Clear all storage:**
   - Local Storage → Delete all
   - Session Storage → Delete all
   - Cookies → Clear
4. Close DevTools
5. Refresh page

#### B. Try Signing In

1. Click "Sign in with Google"
2. Watch for:
   - Redirect to Google
   - Google account selection screen
   - Permission/consent screen (first time)
   - Redirect back to your app

#### C. Check Browser Console

Open DevTools Console (F12) and look for:

**Good signs:**
```
[MyBodaGuy] Initializing auth...
[MyBodaGuy] Session: {user: {...}}
[UserService] Fetching role for user: ...
[UserService] User role received: customer
```

**Bad signs (errors):**
```
❌ redirect_uri_mismatch
❌ invalid_client
❌ access_denied
❌ OAuth client not found
```

---

## 🐛 Common Errors & Fixes

### Error 1: "redirect_uri_mismatch"

**Cause:** Redirect URL in Google Console doesn't match Supabase callback URL

**Fix:**
1. Go to Google Cloud Console → Credentials
2. Edit your OAuth client
3. Make sure **Authorized redirect URIs** includes EXACTLY:
   ```
   https://<your-project-ref>.supabase.co/auth/v1/callback
   ```
4. Save and try again (may take a few minutes to propagate)

---

### Error 2: "invalid_client"

**Cause:** Wrong Client ID or Client Secret in Supabase

**Fix:**
1. Go to Google Cloud Console → Credentials
2. Find your OAuth client
3. Copy Client ID and Client Secret
4. Go to Supabase → Authentication → Providers → Google
5. Replace with correct values
6. Click Save
7. Try again

---

### Error 3: "access_denied"

**Cause:** User canceled or app not verified

**Fix:**
1. Make sure consent screen is configured
2. Add yourself as a test user (if app is in testing)
3. Try with the same Google account used to create the OAuth client

---

### Error 4: "Database tables not initialized"

**Cause:** Trigger didn't create user record

**Fix:**
1. Run the complete database setup:
   ```sql
   -- Run this in Supabase SQL Editor
   -- File: backend/database/COMPLETE_MYBODAGUY_SETUP.sql
   ```
2. Delete the user from Supabase: **Authentication → Users**
3. Try signing in again

---

### Error 5: User Stuck on "Setting up your account..."

**Cause:** No role assigned to user

**Fix:**
1. Go to Supabase → Table Editor → mbg_users
2. Find your user by email
3. Check if `role_type` is set
4. If NULL or missing, manually set it:
   ```sql
   UPDATE mbg_users 
   SET role_type = 'customer' 
   WHERE email = 'your-email@gmail.com';
   ```
5. Refresh your app

---

### Error 6: "Auth session missing" or keeps logging out

**Cause:** Auth lock issues or session persistence problem

**Fix:**
Already fixed in `supabaseClient.ts` with:
```typescript
auth: {
  storageKey: 'mybodaguy-auth',
  lockAcquireTimeout: 10000,
  persistSession: true,
  storage: localStorage,
}
```

If still happening:
1. Clear browser storage completely
2. Make sure you're not in Incognito/Private mode
3. Check if cookies are enabled
4. Try a different browser

---

## 🧪 Manual Testing Procedure

### Test 1: Fresh Sign-In
```
1. Clear all browser storage
2. Go to http://localhost:5173
3. Click "Get Started"
4. Click "Continue with Google"
5. Select Google account
6. Grant permissions
7. Should redirect to customer dashboard
```

### Test 2: Verify Database Record
```sql
-- Run in Supabase SQL Editor
SELECT 
  u.email,
  u.role_type,
  u.is_active,
  p.full_name,
  c.user_id as is_customer
FROM mbg_users u
LEFT JOIN mbg_user_profiles p ON p.user_id = u.id
LEFT JOIN mbg_customers c ON c.user_id = u.id
WHERE u.email = 'your-test-email@gmail.com';
```

**Expected Result:**
- email: your test email
- role_type: customer (or developer if abanabaasa2@gmail.com)
- is_active: true
- full_name: Your Google name
- is_customer: UUID (proves customer record exists)

### Test 3: Sign Out & Sign In Again
```
1. Click sign out
2. Click "Get Started" → "Sign In"
3. Click "Continue with Google"
4. Should sign in WITHOUT consent screen (already authorized)
5. Should go straight to dashboard
```

---

## 🔒 Security Checklist

Before going to production:

- [ ] Client Secret is in Supabase (NOT in frontend code)
- [ ] RLS policies enabled on all tables
- [ ] Production URLs added to Google Console
- [ ] HTTPS enabled for production domain
- [ ] Test users removed (or app published)
- [ ] Consent screen completed
- [ ] Privacy policy URL added (if required)

---

## 📞 Still Having Issues?

### Check These:

1. **Browser Console Errors**
   - F12 → Console tab
   - Look for red error messages
   - Share error text for help

2. **Supabase Logs**
   - Dashboard → Logs → Auth logs
   - Check for failed sign-in attempts
   - Look for error messages

3. **Google Console Errors**
   - Google Cloud Console → APIs & Services → Credentials
   - Check for OAuth client errors
   - Verify API quotas not exceeded

4. **Network Tab**
   - F12 → Network tab
   - Try signing in
   - Look for failed requests (red)
   - Check redirect chains

---

## 🎯 Quick Fix Script

If nothing else works, run this complete reset:

```sql
-- 1. Delete your user (if exists)
DELETE FROM auth.users WHERE email = 'your-email@gmail.com';

-- 2. Recreate trigger
DROP TRIGGER IF EXISTS on_auth_user_created_mbg ON auth.users;
CREATE TRIGGER on_auth_user_created_mbg
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_auth_user_mbg();

-- 3. Verify tables exist
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name LIKE 'mbg_%'
ORDER BY table_name;
```

Then:
1. Clear browser storage
2. Restart dev server
3. Try signing in again

---

## ✅ Success Indicators

You know it's working when:
- ✅ No console errors
- ✅ Redirects to Google smoothly
- ✅ Redirects back to app after authentication
- ✅ Dashboard loads with correct role
- ✅ User appears in Supabase Authentication → Users
- ✅ User record in mbg_users table
- ✅ Profile record in mbg_user_profiles table

---

**Last Updated:** 2026-06-25  
**Status:** Comprehensive troubleshooting guide ready

🏍️ **My Boda Guy - Get Google Auth Working!** 🇺🇬
