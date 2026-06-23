# MyBodaGuy - Deployment & OAuth Update Guide

## Current Situation
- ❌ Old: CyberLearn app at `https://cyberlearn-omega.vercel.app/`
- ✅ New: MyBodaGuy app (needs new Vercel deployment)
- 🔧 Local dev: `http://localhost:5177`
- 🔧 Supabase: `https://hswxazpxcgtqbxeqcxxw.supabase.co`

---

## Step 1: Deploy MyBodaGuy to Vercel

### 1.1 Go to Vercel
Visit: https://vercel.com/dashboard

### 1.2 Create New Project
- Click "Add New" → "Project"
- Import your Git repository (or upload the project)
- Select the `frontend` folder as the root directory

### 1.3 Configure Build Settings
```
Framework Preset: Vite
Build Command: npm run build
Output Directory: dist
Install Command: npm install
Root Directory: frontend
```

### 1.4 Add Environment Variables
Add these in Vercel project settings → Environment Variables:

```env
VITE_SUPABASE_URL=https://hswxazpxcgtqbxeqcxxw.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhzd3hhenB4Y2d0cWJ4ZXFjeHh3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIxNDE1NzAsImV4cCI6MjA2NzcxNzU3MH0.ryOHQGgiEFf25Q9XA2K0akCcrQ7NcZddVfnWMdAH0DU
```

### 1.5 Deploy
- Click "Deploy"
- Wait for deployment to complete
- Your new URL will be something like: `https://mybodaguy-xxx.vercel.app`

### 1.6 Optional: Add Custom Domain
- Go to Project Settings → Domains
- Add custom domain like: `mybodaguy.com` or `app.mybodaguy.com`

---

## Step 2: Update Google OAuth Configuration

### 2.1 Go to Google Cloud Console
Visit: https://console.cloud.google.com/apis/credentials

### 2.2 Find Your OAuth Client
- Go to "APIs & Services" → "Credentials"
- Click on your existing OAuth 2.0 Client ID (or create a new one)

### 2.3 Update Authorized JavaScript Origins
Add these URLs:
```
http://localhost:5177
https://YOUR-NEW-VERCEL-URL.vercel.app
https://hswxazpxcgtqbxeqcxxw.supabase.co
```

### 2.4 Update Authorized Redirect URIs
**IMPORTANT:** Remove old CyberLearn URLs and add:
```
http://localhost:5177
http://localhost:5177/
https://hswxazpxcgtqbxeqcxxw.supabase.co/auth/v1/callback
https://YOUR-NEW-VERCEL-URL.vercel.app
https://YOUR-NEW-VERCEL-URL.vercel.app/
```

### 2.5 Save Changes
Click "SAVE" at the bottom

---

## Step 3: Update Supabase Configuration

### 3.1 Go to Supabase Dashboard
Visit: https://app.supabase.com/project/hswxazpxcgtqbxeqcxxw/auth/url-configuration

### 3.2 Update Site URL
Change to your new Vercel URL:
```
https://YOUR-NEW-VERCEL-URL.vercel.app
```

### 3.3 Update Redirect URLs
Add these to "Redirect URLs":
```
http://localhost:5177/**
https://YOUR-NEW-VERCEL-URL.vercel.app/**
```

### 3.4 Verify Google Provider Settings
- Go to Authentication → Providers → Google
- Make sure Google OAuth is enabled
- Client ID and Secret should already be configured
- If not, add them from Google Cloud Console

---

## Step 4: Test Everything

### 4.1 Test Local Development
1. Start dev server: `npm run dev` (in frontend folder)
2. Open: http://localhost:5177
3. Click "Get Started" → "Continue with Google"
4. Sign in with Google
5. You should be redirected back and logged in

### 4.2 Test Production
1. Open your new Vercel URL
2. Click "Get Started" → "Continue with Google"
3. Sign in with Google
4. You should be redirected back and logged in

---

## URLs Reference

### Old (Remove These)
- ❌ `https://cyberlearn-omega.vercel.app/` (CyberLearn - delete this)

### New (Add These)
- ✅ Local Dev: `http://localhost:5177`
- ✅ Production: `https://YOUR-NEW-VERCEL-URL.vercel.app`
- ✅ Supabase: `https://hswxazpxcgtqbxeqcxxw.supabase.co`
- ✅ OAuth Callback: `https://hswxazpxcgtqbxeqcxxw.supabase.co/auth/v1/callback`

---

## Checklist

### Vercel Deployment
- [ ] Project deployed to Vercel
- [ ] Environment variables added
- [ ] Build successful
- [ ] App opens in browser

### Google OAuth
- [ ] Old CyberLearn URLs removed
- [ ] New Vercel URL added to JavaScript origins
- [ ] Callback URL added to redirect URIs
- [ ] localhost:5177 added for development
- [ ] Changes saved

### Supabase
- [ ] Site URL updated to new Vercel URL
- [ ] Redirect URLs updated
- [ ] Google provider enabled
- [ ] OAuth credentials configured

### Testing
- [ ] Local Google Sign-In works
- [ ] Production Google Sign-In works
- [ ] User profile created automatically
- [ ] Dashboard loads after sign-in

---

## Common Issues

### "redirect_uri_mismatch"
- Check Google Cloud Console redirect URIs match exactly
- Must include: `https://hswxazpxcgtqbxeqcxxw.supabase.co/auth/v1/callback`

### "Site URL not allowed"
- Update Supabase Site URL to your Vercel URL
- Add Vercel URL to Redirect URLs list

### "This app is blocked"
- OAuth consent screen may need verification
- Add test users in Google Cloud Console during development

---

## Quick Commands

```bash
# Start local development
cd frontend
npm run dev

# Build for production
npm run build

# Preview production build locally
npm run preview
```

---

**Last Updated**: June 23, 2026
**Status**: Ready for deployment 🚀
