# ✅ Port 5177 Configuration Checklist

## 🎯 Your App Runs On: http://localhost:5177

---

## Google Cloud Console Settings

### 1. Authorized JavaScript Origins
```
☐ http://localhost:5177
☐ https://hswxazpxcgtqbxeqcxxw.supabase.co
```

### 2. Authorized Redirect URIs
```
☐ http://localhost:5177
☐ https://hswxazpxcgtqbxeqcxxw.supabase.co/auth/v1/callback
```

**Where to add these:**
- Google Cloud Console
- → APIs & Services
- → Credentials
- → Click your OAuth Client
- → Edit
- → Add the URLs above
- → Save

---

## Supabase Dashboard Settings

### 1. Authentication → Providers → Google
```
☐ Toggle ON (green)
☐ Client ID: [paste from Google]
☐ Client Secret: [paste from Google]
☐ Click "Save"
```

### 2. Authentication → URL Configuration

**Site URL:**
```
☐ http://localhost:5177
```

**Redirect URLs:**
```
☐ http://localhost:5177
☐ http://localhost:5177/**
☐ https://hswxazpxcgtqbxeqcxxw.supabase.co/**
```

---

## Before Testing

```
☐ Dev server is running (npm run dev)
☐ Browser shows: http://localhost:5177
☐ Cleared browser storage (F12 → Application → Clear)
☐ Hard refresh: Ctrl + Shift + R
```

---

## Test Sign-In

1. Open: http://localhost:5177
2. Click "Get Started"
3. Click "Continue with Google"
4. Should redirect to Google
5. Select account
6. Should redirect back to http://localhost:5177
7. Dashboard should load

---

## ⚠️ Common Mistakes

❌ **WRONG:** `http://localhost:5173` (old port)  
✅ **RIGHT:** `http://localhost:5177` (your port)

❌ **WRONG:** Missing `http://localhost:5177` in Google Console  
✅ **RIGHT:** Must be in both JavaScript origins AND redirect URIs

❌ **WRONG:** Clicking save but not waiting 5 minutes  
✅ **RIGHT:** Google OAuth changes take 1-5 minutes to propagate

---

## Quick Copy-Paste

### For Google Cloud Console:

**JavaScript Origins:**
```
http://localhost:5177
https://hswxazpxcgtqbxeqcxxw.supabase.co
```

**Redirect URIs:**
```
http://localhost:5177
https://hswxazpxcgtqbxeqcxxw.supabase.co/auth/v1/callback
```

### For Supabase URL Configuration:

**Site URL:**
```
http://localhost:5177
```

**Redirect URLs:**
```
http://localhost:5177
http://localhost:5177/**
https://hswxazpxcgtqbxeqcxxw.supabase.co/**
```

---

## Verification

Run in browser console (F12):
```javascript
console.log(window.location.origin);
// Should output: http://localhost:5177
```

---

**Status:** Use THIS guide for port 5177  
**Complete Setup:** See `GOOGLE_OAUTH_SETUP_PORT_5177.md`

🏍️ **Port 5177 Configuration Ready!** 🇺🇬
