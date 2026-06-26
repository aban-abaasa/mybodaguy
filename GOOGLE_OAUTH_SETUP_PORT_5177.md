# 🚀 Google OAuth Setup - Port 5177

## ⚠️ Important: Your App Runs on Port 5177

Your app is configured to run on **http://localhost:5177** (not 5173).
All redirect URLs must use **5177**.

---

## ✅ Complete Setup Guide

### Step 1: Configure Google Cloud Console (5 minutes)

1. **Open Google Cloud Console:**
   - Go to: https://console.cloud.google.com
   - Sign in with your Google account

2. **Create or Select Project:**
   - Click project dropdown (top left)
   - Click "New Project" OR select existing project
   - Name: `My Boda Guy`
   - Click "Create"

3. **Enable Required APIs:**
   - Go to **"APIs & Services" → "Library"**
   - Search for **"Google+ API"** OR **"People API"**
   - Click it and press **"Enable"**

4. **Configure Consent Screen:**
   - Go to **"APIs & Services" → "OAuth consent screen"**
   - Select **"External"** (or Internal for workspace)
   - Fill in:
     - App name: `My Boda Guy`
     - User support email: Your email
     - Developer contact: Your email
   - Click **"Save and Continue"**
   - Skip scopes (click "Save and Continue")
   - Add test users (optional, add your email)
   - Click **"Save and Continue"**

5. **Create OAuth Client ID:**
   - Go to **"APIs & Services" → "Credentials"**
   - Click **"+ CREATE CREDENTIALS" → "OAuth client ID"**
   - Application type: **"Web application"**
   - Name: `My Boda Guy Web`
   
   **Authorized JavaScript origins:** (Add both!)
   ```
   http://localhost:5177
   https://hswxazpxcgtqbxeqcxxw.supabase.co
   ```
   
   **Authorized redirect URIs:** (CRITICAL - Use port 5177!)
   ```
   http://localhost:5177
   https://hswxazpxcgtqbxeqcxxw.supabase.co/auth/v1/callback
   ```
   
6. **Copy Credentials:**
   - After clicking "Create", you'll see:
     - **Client ID**: `123456789-abc...apps.googleusercontent.com`
     - **Client Secret**: `GOCSPX-abc123...`
   - **Copy both** (you'll need them in Step 2)

---

### Step 2: Configure Supabase (3 minutes)

1. **Open Supabase Dashboard:**
   - Go to: https://supabase.com/dashboard/project/hswxazpxcgtqbxeqcxxw

2. **Enable Google Provider:**
   - Click **"Authentication"** (left sidebar)
   - Click **"Providers"**
   - Find **"Google"**
   - Toggle it **ON** (should turn green)

3. **Add Google Credentials:**
   - Paste the **Client ID** (from Step 1)
   - Paste the **Client Secret** (from Step 1)
   - Click **"Save"**

4. **Configure Redirect URLs:**
   - Still in Supabase, go to **"Authentication" → "URL Configuration"**
   
   **Site URL:** (Use port 5177!)
   ```
   http://localhost:5177
   ```
   
   **Redirect URLs:** (Add all these!)
   ```
   http://localhost:5177
   http://localhost:5177/**
   https://hswxazpxcgtqbxeqcxxw.supabase.co/**
   ```
   
   - Click **"Save"**

---

### Step 3: Update AuthService (if needed)

Your auth service should already be correct, but let's verify:

**File:** `frontend/src/mybodaguy/services/authService.ts`

Make sure the `signInWithGoogle` function uses the correct redirect:

```typescript
async signInWithGoogle() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}`, // This gets http://localhost:5177
    },
  });

  if (error) throw error;
  return data;
}
```

**No changes needed** - `window.location.origin` automatically uses the correct port!

---

### Step 4: Test Sign-In (2 minutes)

1. **Make sure dev server is running:**
   ```bash
   cd frontend
   npm run dev
   ```
   
   Should show:
   ```
   Local: http://localhost:5177
   ```

2. **Clear Browser Storage:**
   - Press `F12` (DevTools)
   - Go to **"Application"** tab
   - Click **"Clear site data"** (or "Clear storage")
   - Close DevTools

3. **Open Your App:**
   ```
   http://localhost:5177
   ```

4. **Try Google Sign-In:**
   - Click **"Get Started"**
   - Click **"Continue with Google"**
   - Should redirect to Google
   - Select your account
   - Grant permissions
   - Should redirect back to `http://localhost:5177`
   - Dashboard should load!

---

## 🔍 Verify Console Output

### Before Clicking "Continue with Google":
```
✅ [Supabase] Client initialized (singleton instance)
✅ [Supabase] Project: hswxazpxcgtqbxeqcxxw
[MyBodaGuy] Initializing auth...
[MyBodaGuy] Session: null
[MyBodaGuy] Auth state changed: INITIAL_SESSION
```

### After Successful Sign-In:
```
[MyBodaGuy] Auth state changed: SIGNED_IN
[MyBodaGuy] Session: {user: {...}}
[UserService] Fetching role for user: abc-123-def...
[UserService] User role received: customer
```

---

## 🐛 Common Issues with Port 5177

### Issue 1: "redirect_uri_mismatch"

**Cause:** Redirect URLs still have port 5173 instead of 5177

**Fix:**
1. Go to Google Cloud Console → Credentials
2. Edit your OAuth client
3. Make sure Authorized redirect URIs includes:
   ```
   http://localhost:5177
   https://hswxazpxcgtqbxeqcxxw.supabase.co/auth/v1/callback
   ```
4. Save and wait 5 minutes for changes to propagate

### Issue 2: OAuth Button Does Nothing

**Cause:** Google provider not enabled in Supabase

**Fix:**
1. Go to Supabase Dashboard
2. Authentication → Providers
3. Find Google and toggle it ON
4. Add Client ID and Secret
5. Save

### Issue 3: "Provider not found"

**Cause:** Client ID or Secret not saved in Supabase

**Fix:**
1. Go back to Google Cloud Console
2. Copy Client ID and Secret again
3. Go to Supabase → Authentication → Providers → Google
4. Paste both credentials
5. Click Save

---

## 📋 Complete URL Checklist

Use these exact URLs for port **5177**:

### Google Cloud Console - Authorized JavaScript origins:
- [ ] `http://localhost:5177`
- [ ] `https://hswxazpxcgtqbxeqcxxw.supabase.co`

### Google Cloud Console - Authorized redirect URIs:
- [ ] `http://localhost:5177`
- [ ] `https://hswxazpxcgtqbxeqcxxw.supabase.co/auth/v1/callback`

### Supabase - Site URL:
- [ ] `http://localhost:5177`

### Supabase - Redirect URLs:
- [ ] `http://localhost:5177`
- [ ] `http://localhost:5177/**`
- [ ] `https://hswxazpxcgtqbxeqcxxw.supabase.co/**`

---

## 🎯 Quick Test Command

After setup, run this in your browser console (F12):

```javascript
console.log('App URL:', window.location.origin);
console.log('Port:', window.location.port);
// Should show:
// App URL: http://localhost:5177
// Port: 5177
```

---

## 🚀 Production Deployment

When deploying to production (e.g., Vercel, Netlify):

1. **Add Production URLs to Google Console:**
   ```
   https://yourdomain.com
   https://yourdomain.com/auth/callback (if using routing)
   ```

2. **Update Supabase URLs:**
   - Site URL: `https://yourdomain.com`
   - Redirect URLs: `https://yourdomain.com/**`

3. **No code changes needed!**
   - `window.location.origin` automatically works in production

---

## ✅ Success Checklist

- [ ] Google OAuth client created with port **5177**
- [ ] Client ID and Secret added to Supabase
- [ ] Google provider enabled in Supabase
- [ ] Redirect URLs configured with port **5177**
- [ ] Browser storage cleared
- [ ] Dev server running on port 5177
- [ ] Tested "Continue with Google" button
- [ ] Successfully signed in and see dashboard

---

## 📞 Still Having Issues?

**Copy this info and share:**

1. **Your Port:** 5177
2. **Console Error:** (copy exact error from F12 console)
3. **What Happens:** (describe what happens when you click Google button)
4. **Supabase Project:** hswxazpxcgtqbxeqcxxw

**Check these:**
- [ ] Dev server shows `http://localhost:5177` (not 5173)
- [ ] Google Console has port 5177 in redirect URLs
- [ ] Supabase has port 5177 in Site URL
- [ ] Cleared browser cache/storage

---

**Estimated Time:** 10 minutes  
**Port:** 5177 (IMPORTANT!)  
**Next:** Follow steps above, then test sign-in

🏍️ **Let's Get Google Auth Working on Port 5177!** 🇺🇬
