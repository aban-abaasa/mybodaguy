# Vercel Deployment Setup - My Boda Guy

## Required Environment Variables

Add these environment variables in your Vercel project settings:

### 1. Go to Vercel Dashboard
- Navigate to: https://vercel.com/dashboard
- Select your `mybodaguy` project
- Go to **Settings** → **Environment Variables**

### 2. Add Required Variables

#### Supabase Configuration (REQUIRED)
```
VITE_SUPABASE_URL
Value: https://xhfdxvabeynsiqyqsxki.supabase.co
Environment: Production, Preview, Development
```

```
VITE_SUPABASE_ANON_KEY
Value: [Your Supabase Anonymous Key]
Environment: Production, Preview, Development
```

To get your Supabase credentials:
1. Go to https://supabase.com/dashboard
2. Select your project
3. Go to **Settings** → **API**
4. Copy the **Project URL** and **anon public** key

#### App Configuration (Optional)
```
VITE_APP_NAME
Value: My Boda Guy
Environment: Production, Preview, Development
```

```
VITE_APP_URL
Value: https://mybodaguy.vercel.app
Environment: Production, Preview, Development
```

## Build Settings

Ensure your Vercel project has these settings:

### Framework Preset
- **Framework**: Vite

### Root Directory
- **Root Directory**: `frontend`

### Build Command
- **Build Command**: `npm run build`

### Output Directory
- **Output Directory**: `dist`

### Install Command
- **Install Command**: `npm install`

## Deployment Steps

1. **Add Environment Variables** (as listed above)
2. **Commit and Push** your code to GitHub
3. **Redeploy** in Vercel:
   - Go to **Deployments** tab
   - Click the three dots on the latest deployment
   - Click **Redeploy**
   - Check **Use existing Build Cache** (optional)
   - Click **Redeploy**

## Troubleshooting

### Build Fails with "Could not resolve import"
- Ensure all imports use relative paths from within the project
- Check that all imported files exist in the repository
- Remove references to external projects (like `../../../../../ICAN/`)

### Supabase Connection Fails
- Verify `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set correctly
- Ensure variables are available in all environments (Production, Preview, Development)
- Check Supabase project is active and not paused

### Environment Variables Not Working
- Variables must start with `VITE_` for Vite to expose them to client
- After adding variables, trigger a new deployment
- Clear build cache if variables still don't work

## Current Deployment Status

✅ Latest commit: 65c254e
✅ Branch: main
✅ Repository: github.com/aban-abaasa/mybodaguy

---

**Last Updated**: June 26, 2026
