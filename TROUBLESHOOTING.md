# 🔧 Troubleshooting My Boda Guy

## Issue: App Stuck on "Loading My Boda Guy..."

### Quick Fix:

**1. Restart the development server:**
```bash
# Stop the current server (Ctrl+C in terminal)
# Then restart:
cd frontend
npm run dev
```

**2. Clear browser cache:**
- Press `Ctrl + Shift + R` (hard refresh)
- Or open DevTools (F12) → Right-click refresh → Empty Cache and Hard Reload

**3. Check console for errors:**
- Press F12 to open browser console
- Look for any red errors
- Common issues:
  - "Missing Supabase environment variables" → Check .env.local file
  - "Failed to fetch" → Database not initialized or Supabase down
  - Import errors → Check file paths

### Step-by-Step Fix:

#### Step 1: Verify Environment Variables
```bash
# Check if .env.local exists
cd frontend
type .env.local
```

Should show:
```
VITE_SUPABASE_URL=https://hswxazpxcgtqbxeqcxxw.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

#### Step 2: Initialize Database
```bash
cd backend
npm run init:mybodaguy
```

Wait for "✅ Database initialization complete!"

#### Step 3: Restart Frontend
```bash
cd frontend
npm run dev
```

#### Step 4: Open Fresh Browser Tab
- Go to: http://localhost:5173
- Press Ctrl+Shift+R to hard refresh

### Common Errors & Solutions:

#### Error: "Missing Supabase environment variables"
**Solution:**
1. Check `frontend/.env.local` exists
2. Verify VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set
3. Restart dev server

#### Error: "Failed to connect to Supabase"
**Solution:**
1. Check internet connection
2. Verify Supabase URL is correct
3. Check if Supabase project is active

#### Error: "Cannot read properties of undefined"
**Solution:**
1. Database tables not created
2. Run: `cd backend && npm run init:mybodaguy`
3. Restart frontend

#### Error: Import errors (module not found)
**Solution:**
```bash
cd frontend
npm install
npm run dev
```

### Still Not Working?

Try a complete reset:

```bash
# 1. Stop all servers

# 2. Clean install
cd frontend
rm -rf node_modules
npm install

# 3. Reinitialize database
cd ../backend
npm run init:mybodaguy

# 4. Start fresh
cd ../frontend
npm run dev

# 5. Open new browser tab
# Go to: http://localhost:5173
# Hard refresh: Ctrl+Shift+R
```

### Check Console Logs

Look for these logs in browser console (F12):
```
✅ [MyBodaGuy] Initializing auth...
✅ [MyBodaGuy] Session: null (or session object)
✅ [MyBodaGuy] Auth state changed: SIGNED_OUT
```

### Database Connection Test

In browser console, type:
```javascript
// Check if Supabase is connected
console.log(import.meta.env.VITE_SUPABASE_URL)
```

Should show your Supabase URL.

### Need More Help?

1. Check browser console (F12) for errors
2. Check terminal where `npm run dev` is running
3. Look for red error messages
4. Share the error message for specific help

---

**Most common fix:** Just restart the dev server!
```bash
Ctrl+C  # Stop server
npm run dev  # Start again
```
