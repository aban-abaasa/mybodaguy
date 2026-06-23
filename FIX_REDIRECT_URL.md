# Fix Localhost Port Issue

## Problem
Your app runs on `http://localhost:5177` but Google OAuth is configured for port `5173`.

## Solution 1: Add Port 5177 to Allowed URLs (Recommended)

1. **Go to Supabase Dashboard**
   - https://supabase.com/dashboard/project/hswxazpxcgtqbxeqcxxw
   
2. **Navigate to Authentication → URL Configuration**
   - Click "Authentication" in sidebar
   - Click "URL Configuration"

3. **Add these URLs to "Redirect URLs":**
   ```
   http://localhost:5177
   http://localhost:5177/**
   http://localhost:5173
   http://localhost:5173/**
   https://mybodaguy.vercel.app/**
   ```

4. **Add to "Site URL":**
   ```
   http://localhost:5177
   ```

5. **Click "Save"**

6. **Update Google Cloud Console** (if needed)
   - Go to: https://console.cloud.google.com
   - Select your project
   - Go to "APIs & Services" → "Credentials"
   - Edit your OAuth 2.0 Client ID
   - Add to "Authorized redirect URIs":
     ```
     http://localhost:5177
     ```
   - Save

7. **Refresh localhost:5177**

---

## Solution 2: Change Vite Port to 5173

If you want to use port 5173 instead:

1. **Update `vite.config.ts`** (see below)
2. **Restart dev server**
3. **Access app at `http://localhost:5173`**

---

## Solution 3: Use Environment Variable

Set the port via command line:
```bash
cd frontend
npm run dev -- --port 5173
```
