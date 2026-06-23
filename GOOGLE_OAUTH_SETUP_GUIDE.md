# Google OAuth Setup Guide for My Boda Guy

## Problem
You're seeing "Setting up your account..." and "Database tables may not be initialized" errors. This happens because:
1. Database tables aren't created yet
2. Google OAuth isn't configured in Supabase

## Solution - Follow These Steps

### Step 1: Run Database Setup SQL

1. **Open Supabase Dashboard**
   - Go to: https://supabase.com/dashboard
   - Select your project: `hswxazpxcgtqbxeqcxxw`

2. **Navigate to SQL Editor**
   - Click on "SQL Editor" in the left sidebar
   - Click "+ New query"

3. **Copy & Run the Setup SQL**
   - Open file: `backend/database/COMPLETE_MYBODAGUY_SETUP.sql`
   - Copy ALL contents
   - Paste into SQL Editor
   - Click "Run" or press `Ctrl+Enter`

4. **Verify Success**
   - You should see: "Success. No rows returned"
   - This creates all tables, triggers, and policies

---

### Step 2: Configure Google OAuth in Supabase

#### A. Get Google OAuth Credentials

1. **Go to Google Cloud Console**
   - Visit: https://console.cloud.google.com
   - Sign in with your Google account

2. **Create a New Project** (or use existing)
   - Click on project dropdown (top left)
   - Click "New Project"
   - Name: "My Boda Guy"
   - Click "Create"

3. **Enable Google+ API**
   - In the search bar, type "Google+ API"
   - Click "Google+ API"
   - Click "Enable"

4. **Create OAuth Credentials**
   - Go to "APIs & Services" → "Credentials"
   - Click "+ CREATE CREDENTIALS"
   - Select "OAuth client ID"

5. **Configure Consent Screen** (if prompted)
   - Click "Configure Consent Screen"
   - Select "External" (or Internal if G Suite)
   - Fill in:
     - App name: "My Boda Guy"
     - User support email: your email
     - Developer contact: your email
   - Click "Save and Continue"
   - Skip scopes (or add email, profile)
   - Add test users if needed
   - Click "Save and Continue"

6. **Create OAuth Client ID**
   - Application type: "Web application"
   - Name: "My Boda Guy Web Client"
   
   **Authorized JavaScript origins:**
   ```
   http://localhost:5173
   https://hswxazpxcgtqbxeqcxxw.supabase.co
   ```

   **Authorized redirect URIs:**
   ```
   http://localhost:5173/auth/callback
   https://hswxazpxcgtqbxeqcxxw.supabase.co/auth/v1/callback
   ```

7. **Copy Credentials**
   - You'll see:
     - **Client ID**: Something like `123456789-abc...apps.googleusercontent.com`
     - **Client Secret**: Something like `GOCSPX-abc...`
   - **IMPORTANT**: Keep these safe!

---

#### B. Configure Supabase with Google OAuth

1. **Open Supabase Dashboard**
   - Go to your project: https://supabase.com/dashboard/project/hswxazpxcgtqbxeqcxxw

2. **Navigate to Authentication Settings**
   - Click "Authentication" in left sidebar
   - Click "Providers"

3. **Enable Google Provider**
   - Find "Google" in the list
   - Toggle it **ON** (enable)

4. **Add Google Credentials**
   - Paste your **Client ID**
   - Paste your **Client Secret**
   - Click "Save"

5. **Configure Redirect URLs** (in Supabase)
   - Go to "Authentication" → "URL Configuration"
   - Add these Site URLs:
     ```
     http://localhost:5173
     ```
   - Add these Redirect URLs:
     ```
     http://localhost:5173/auth/callback
     http://localhost:5173/**
     ```
   - Click "Save"

---

### Step 3: Update Your Frontend Code (if needed)

Your auth service should already be set up, but verify:

**File**: `frontend/src/mybodaguy/services/authService.ts`

```typescript
import { supabase } from './supabaseClient';

export const authService = {
  // Sign in with Google
  async signInWithGoogle() {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    
    if (error) throw error;
    return data;
  },

  // Get current session
  async getSession() {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    return data.session;
  },

  // Sign out
  async signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  },

  // Listen to auth changes
  onAuthStateChange(callback: (event: string, session: any) => void) {
    return supabase.auth.onAuthStateChange(callback);
  },
};
```

---

### Step 4: Test the Setup

1. **Start Your Development Server**
   ```bash
   cd frontend
   npm run dev
   ```

2. **Open Browser**
   - Go to: http://localhost:5173
   - Click "Get Started" or "Sign In"

3. **Click "Sign in with Google"**
   - You should see Google's OAuth consent screen
   - Select your Google account
   - Grant permissions

4. **Check for Success**
   - You should be redirected back to your app
   - User should be created in database
   - Role should be set automatically:
     - `abanabaasa2@gmail.com` → **developer**
     - All others → **customer**

---

### Step 5: Verify Database Records

1. **Open Supabase Table Editor**
   - Go to "Table Editor"

2. **Check `mbg_users` table**
   - You should see your user with correct role

3. **Check `mbg_user_profiles` table**
   - User profile should be created

4. **Check `mbg_customers` table** (if not developer)
   - Customer record should exist

---

## Troubleshooting

### Error: "redirect_uri_mismatch"
**Solution**: Make sure redirect URIs in Google Cloud Console exactly match your Supabase callback URL:
```
https://hswxazpxcgtqbxeqcxxw.supabase.co/auth/v1/callback
```

### Error: "Database tables not initialized"
**Solution**: Run the SQL setup script again from Step 1

### Error: "Email not confirmed"
**Solution**: 
- Go to Supabase → Authentication → Settings
- Disable "Confirm email" requirement

### Error: "User already exists"
**Solution**: 
- Go to Supabase → Authentication → Users
- Delete the user
- Try signing in again

### Error: "Invalid OAuth client"
**Solution**:
- Check Client ID and Secret in Supabase are correct
- Make sure Google+ API is enabled
- Verify consent screen is configured

---

## Security Checklist

✅ **Client Secret** is stored securely in Supabase (not in frontend code)  
✅ **Service Role Key** is NOT exposed to frontend  
✅ **RLS policies** are enabled on all tables  
✅ **Redirect URIs** are whitelisted  
✅ **HTTPS** will be used in production  

---

## Production Deployment

When deploying to production:

1. **Add Production URLs to Google Cloud Console**
   ```
   https://yourdomain.com
   https://yourdomain.com/auth/callback
   ```

2. **Update Supabase Redirect URLs**
   ```
   https://yourdomain.com
   https://yourdomain.com/**
   ```

3. **Update Environment Variables**
   - No changes needed! Supabase manages OAuth server-side

---

## Quick Reference

### Your Supabase Details
- **URL**: `https://hswxazpxcgtqbxeqcxxw.supabase.co`
- **Anon Key**: Already in `.env.local`
- **Service Role Key**: Already in `.env.local`

### Your Google OAuth Redirect URL
```
https://hswxazpxcgtqbxeqcxxw.supabase.co/auth/v1/callback
```

### Developer Account
- **Email**: `abanabaasa2@gmail.com`
- **Role**: `developer` (auto-assigned by trigger)

---

## Next Steps After Setup

1. ✅ Test sign-in with Google
2. ✅ Verify user roles are assigned correctly
3. ✅ Test customer dashboard access
4. ✅ Test rider registration (if applicable)
5. ✅ Implement backend API for rider matching algorithm

---

## Need Help?

If you're still having issues:
1. Check browser console for errors (F12)
2. Check Supabase logs: Dashboard → Logs
3. Verify all redirect URLs match exactly
4. Make sure SQL script ran successfully
5. Test with a different Google account

---

## Summary

1. ✅ Run `COMPLETE_MYBODAGUY_SETUP.sql` in Supabase
2. ✅ Create Google OAuth credentials
3. ✅ Configure Google provider in Supabase
4. ✅ Add redirect URLs in both Google and Supabase
5. ✅ Test sign-in
6. ✅ Verify database records

**You're all set!** 🚀
