# Quick OAuth Update Checklist

## What You Need to Change

### 1. Google Cloud Console (5 minutes)
**URL:** https://console.cloud.google.com/apis/credentials

**Remove these old URLs:**
- ❌ `https://cyberlearn-omega.vercel.app`
- ❌ `https://cyberlearn-omega.vercel.app/`
- ❌ Any other CyberLearn URLs

**Add these new URLs:**

**Authorized JavaScript origins:**
```
http://localhost:5177
https://YOUR-NEW-MYBODAGUY-URL.vercel.app
```

**Authorized redirect URIs:**
```
http://localhost:5177
http://localhost:5177/
https://hswxazpxcgtqbxeqcxxw.supabase.co/auth/v1/callback
https://YOUR-NEW-MYBODAGUY-URL.vercel.app
https://YOUR-NEW-MYBODAGUY-URL.vercel.app/
```

---

### 2. Supabase Dashboard (2 minutes)
**URL:** https://app.supabase.com/project/hswxazpxcgtqbxeqcxxw/auth/url-configuration

**Update Site URL to:**
```
https://YOUR-NEW-MYBODAGUY-URL.vercel.app
```

**Update Redirect URLs - Add:**
```
http://localhost:5177/**
https://YOUR-NEW-MYBODAGUY-URL.vercel.app/**
```

---

### 3. Deploy to Vercel (10 minutes)
**URL:** https://vercel.com/dashboard

1. Create new project
2. Import your repo
3. Set root directory: `frontend`
4. Add environment variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. Deploy
6. Get your new URL (e.g., `https://mybodaguy-xxx.vercel.app`)
7. Go back to Step 1 & 2 and replace `YOUR-NEW-MYBODAGUY-URL` with actual URL

---

## Current Setup

**Local Development:**
- URL: `http://localhost:5177`
- Command: `npm run dev` (in frontend folder)

**Supabase:**
- Project: `hswxazpxcgtqbxeqcxxw`
- URL: `https://hswxazpxcgtqbxeqcxxw.supabase.co`

**Google OAuth:**
- Already configured (just needs URL updates)
- Client ID & Secret already in Supabase

---

## Test After Changes

### Local Test:
1. Run `npm run dev` in frontend folder
2. Open http://localhost:5177
3. Click "Get Started"
4. Click "Continue with Google"
5. Sign in → Should redirect back to app

### Production Test:
1. Open your Vercel URL
2. Click "Get Started"
3. Click "Continue with Google"
4. Sign in → Should redirect back to app

---

## Need Help?

If you get "redirect_uri_mismatch" error:
- Double-check the redirect URI in Google Console matches EXACTLY:
  `https://hswxazpxcgtqbxeqcxxw.supabase.co/auth/v1/callback`

If sign-in works but shows "Setting up account":
- Check browser console for errors
- Verify database tables exist (they should already)
- Check that user was created in `mbg_users` table

---

**Important:** After deploying to Vercel, you'll get a URL like:
`https://mybodaguy-xxx.vercel.app`

Use THIS URL to replace everywhere you see "YOUR-NEW-MYBODAGUY-URL"
