# 🚀 Google Sign-In Quick Fix Guide

## Problem Identified
Your console shows:
```
[MyBodaGuy] Session: null
[MyBodaGuy] Auth state changed: INITIAL_SESSION
```

This means Google OAuth needs to be configured in Supabase.

---

## ✅ 3-Step Fix

### Step 1: Enable Google OAuth in Supabase (5 minutes)

1. **Open Supabase Dashboard:**
   - Go to: https://supabase.com/dashboard/project/hswxazpxcgtqbxeqcxxw

2. **Navigate to Authentication:**
   - Click **"Authentication"** in left sidebar
   - Click **"Providers"**

3. **Enable Google:**
   - Scroll down to find **"Google"**
   - Toggle it **ON** (should turn green)

4. **Get Google Credentials (New Tab):**
   - Open: https://console.cloud.google.com
   - Select project or create new one
   - Go to **"APIs & Services" → "Credentials"**
   - Click **"+ CREATE CREDENTIALS" → "OAuth client ID"**

5. **Configure OAuth Client:**
   - Application type: **Web application**
   - Name: `My Boda Guy`
   
   **Authorized JavaScript origins:**
   ```
   http://localhost:5173
   https://hswxazpxcgtqbxeqcxxw.supabase.co
   ```
   
   **Authorized redirect URIs:** (CRITICAL - Copy exactly!)
   ```
   http://localhost:5173
   https://hswxazpxcgtqbxeqcxxw.supabase.co/auth/v1/callback
   ```
   
6. **Copy Credentials:**
   - Copy the **Client ID** (ends with .apps.googleusercontent.com)
   - Copy the **Client Secret** (starts with GOCSPX-)

7. **Add to Supabase:**
   - Go back to Supabase → Authentication → Providers → Google
   - Paste **Client ID**
   - Paste **Client Secret**
   - Click **"Save"**

---

### Step 2: Configure Redirect URLs in Supabase (2 minutes)

1. **Still in Supabase Dashboard:**
   - Go to **Authentication → URL Configuration**

2. **Add Site URL:**
   ```
   http://localhost:5173
   ```

3. **Add Redirect URLs:**
   ```
   http://localhost:5173/**
   https://hswxazpxcgtqbxeqcxxw.supabase.co/**
   ```

4. **Click "Save"**

---

### Step 3: Test Sign-In (1 minute)

1. **Clear Browser Storage:**
   - Press `F12` (DevTools)
   - Go to **Application** tab
   - Click **"Clear site data"** or **"Clear storage"**
   - Close DevTools

2. **Refresh Your App:**
   - Press `Ctrl + Shift + R` (hard refresh)

3. **Try Google Sign-In:**
   - Click **"Get Started"**
   - Click **"Continue with Google"**
   - Select your Google account
   - Grant permissions
   - Should redirect back and sign in!

---

## 🔍 Verify It's Working

After clicking "Continue with Google", watch the console:

**Before Fix (What you see now):**
```
[MyBodaGuy] Session: null
[MyBodaGuy] Auth state changed: INITIAL_SESSION
```

**After Fix (What you should see):**
```
[MyBodaGuy] Initializing auth...
[MyBodaGuy] Session: {user: {...}}
[MyBodaGuy] Auth state changed: SIGNED_IN
[UserService] Fetching role for user: abc-123...
[UserService] User role received: customer
```

---

## 🐛 Common Issues

### Issue 1: "Provider not found" error
**Fix:** Google provider not enabled in Supabase
- Go to Authentication → Providers → Enable Google

### Issue 2: "redirect_uri_mismatch"
**Fix:** URLs don't match between Google Console and Supabase
- In Google Console, Authorized redirect URIs must include:
  ```
  https://hswxazpxcgtqbxeqcxxw.supabase.co/auth/v1/callback
  ```
- Wait 5 minutes for Google to propagate changes

### Issue 3: "invalid_client"
**Fix:** Wrong Client ID or Secret in Supabase
- Double-check you copied the full Client ID
- Make sure Client Secret has no extra spaces
- Re-paste in Supabase → Authentication → Providers → Google

### Issue 4: Still showing "Session: null"
**Fix:** Clear browser storage and try again
- Press F12 → Application → Clear site data
- Hard refresh: Ctrl + Shift + R
- Try signing in again

---

## 📋 Checklist

Before asking for help, verify:

- [ ] Google provider is **enabled** in Supabase (green toggle)
- [ ] Client ID and Secret are **pasted** in Supabase
- [ ] Redirect URL includes `/auth/v1/callback` in Google Console
- [ ] Site URL is set to `http://localhost:5173` in Supabase
- [ ] Browser storage is **cleared**
- [ ] Dev server is **running** (`npm run dev`)
- [ ] Checked browser console for errors (F12)

---

## 🎯 Expected Flow

1. Click "Continue with Google" → Redirects to Google
2. Select Google account → Shows permission screen
3. Grant permissions → Redirects back to your app
4. Auth listener fires `SIGNED_IN` event
5. User role is fetched from database
6. Dashboard loads based on role

---

## 🔧 If Database Tables Don't Exist

If you get "Database tables not initialized" after signing in:

1. **Run the database setup:**
   - Go to Supabase Dashboard → SQL Editor
   - Open a new query
   - Copy and paste contents of: `backend/database/COMPLETE_MYBODAGUY_SETUP.sql`
   - Click "Run" or press Ctrl+Enter

2. **Sign out and sign in again:**
   - Click sign out button
   - Clear browser storage
   - Sign in with Google again

---

## 💡 Pro Tips

### Development
- Use **Incognito/Private browsing** to test fresh sign-ins
- Check **Network tab** (F12) to see OAuth redirects
- Watch **Console tab** (F12) for auth state changes

### Production
- Add production URL to Google Console redirects
- Update Supabase URL Configuration with production domain
- Test with multiple Google accounts

---

## 📞 Need More Help?

**Check these in order:**

1. **Supabase Logs:**
   - Dashboard → Logs → Auth logs
   - Look for failed sign-in attempts

2. **Google Console:**
   - APIs & Services → Credentials
   - Check if OAuth client is created correctly

3. **Browser Console:**
   - Press F12 → Console tab
   - Look for red error messages
   - Check Network tab for failed requests

---

## 🎉 Success Indicators

You know it's working when:

✅ Console shows `[MyBodaGuy] Session: {user: {...}}`  
✅ No redirect errors  
✅ Dashboard loads after Google sign-in  
✅ User appears in Supabase Authentication → Users  
✅ User role is assigned (customer or developer)

---

## 📸 Visual Guide

### Supabase - Enable Google Provider
```
Authentication → Providers → Google → Toggle ON → Add Client ID & Secret → Save
```

### Google Console - OAuth Client
```
APIs & Services → Credentials → Create OAuth Client ID → Web application
→ Add Redirect URI: https://hswxazpxcgtqbxeqcxxw.supabase.co/auth/v1/callback
→ Create → Copy Client ID & Secret
```

### Supabase - URL Configuration
```
Authentication → URL Configuration
→ Site URL: http://localhost:5173
→ Redirect URLs: http://localhost:5173/**
→ Save
```

---

**Estimated Time:** 8 minutes total  
**Difficulty:** Easy  
**Prerequisites:** Google account, Supabase project

🏍️ **Let's get you signed in!** 🇺🇬
