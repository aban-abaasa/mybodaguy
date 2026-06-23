# Google OAuth Setup Guide for MyBodaGuy

## Step 1: Create Google OAuth Credentials

### 1. Go to Google Cloud Console
Visit: https://console.cloud.google.com/

### 2. Create or Select a Project
- Click on the project dropdown at the top
- Click "NEW PROJECT"
- Name it: "MyBodaGuy" or similar
- Click "CREATE"

### 3. Enable Google+ API
- Go to "APIs & Services" → "Library"
- Search for "Google+ API"
- Click on it and click "ENABLE"

### 4. Create OAuth Consent Screen
- Go to "APIs & Services" → "OAuth consent screen"
- Select "External" (for testing)
- Click "CREATE"
- Fill in the required fields:
  - App name: **MyBodaGuy**
  - User support email: **Your email**
  - Developer contact: **Your email**
- Click "SAVE AND CONTINUE"
- Skip Scopes (click "SAVE AND CONTINUE")
- Add test users if needed (your own email)
- Click "SAVE AND CONTINUE"

### 5. Create OAuth Client ID
- Go to "APIs & Services" → "Credentials"
- Click "+ CREATE CREDENTIALS" → "OAuth client ID"
- Application type: **Web application**
- Name: **MyBodaGuy Web Client**
- Authorized JavaScript origins:
  ```
  http://localhost:5173
  http://localhost:5174
  http://localhost:3000
  ```
- Authorized redirect URIs:
  ```
  https://hswxazpxcgtqbxeqcxxw.supabase.co/auth/v1/callback
  http://localhost:5173
  http://localhost:5174
  ```
- Click "CREATE"

### 6. Copy Your Credentials
You'll see a popup with:
- **Client ID** (looks like: xxxxx.apps.googleusercontent.com)
- **Client Secret** (looks like: GOCSPX-xxxxx)

**Save these securely!**

---

## Step 2: Configure Supabase

### 1. Go to Supabase Dashboard
Visit: https://app.supabase.com/project/hswxazpxcgtqbxeqcxxw

### 2. Enable Google Provider
- Go to **Authentication** → **Providers**
- Find **Google** in the list
- Toggle it to **Enabled**
- Paste your **Client ID**
- Paste your **Client Secret**
- Site URL should be: `http://localhost:5173` (for development)
- Redirect URLs: Add `http://localhost:5173/**`

### 3. Save Configuration
Click **Save** at the bottom

---

## Step 3: Test the Integration

1. Start your development server:
   ```bash
   cd frontend
   npm run dev
   ```

2. Open your app: http://localhost:5173

3. Click "Get Started" → Click "Continue with Google"

4. You should be redirected to Google sign-in

5. After signing in with Google, you should be redirected back to your app

---

## Troubleshooting

### Error: "redirect_uri_mismatch"
- Make sure the redirect URI in Google Console matches exactly:
  `https://hswxazpxcgtqbxeqcxxw.supabase.co/auth/v1/callback`

### Error: "Access blocked: This app's request is invalid"
- Make sure OAuth consent screen is configured
- Add your email as a test user if in testing mode

### User signs in but no dashboard appears
- Check browser console for errors
- Verify database tables are created (run COMPLETE_MYBODAGUY_SETUP.sql)
- Check that the user_profiles table has the new user

---

## Development Credentials (Keep Secure!)

After setup, your credentials will be:
- **Google Client ID**: [Your Client ID]
- **Google Client Secret**: [Your Client Secret]
- **Supabase URL**: https://hswxazpxcgtqbxeqcxxw.supabase.co
- **Supabase Anon Key**: (already in .env.local)

**Never commit these to git!**
