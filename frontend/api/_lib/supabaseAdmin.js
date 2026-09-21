import { createClient } from '@supabase/supabase-js';

// Service-role client for Vercel serverless functions only (never imported
// by client-side code — everything under /api runs server-side on Vercel).
// SUPABASE_SERVICE_ROLE_KEY must be set as a plain (non-VITE_) environment
// variable in the Vercel project so it's never bundled into the browser.
// Fail with a message that names the problem. Without this the Supabase client
// throws an opaque "supabaseUrl is required" while the module loads, the
// function dies before it can send any CORS headers, and the browser reports a
// misleading CORS error instead of "server not configured".
const missing = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].filter((name) => !process.env[name]);
if (missing.length > 0) {
  throw new Error(`Server is missing environment variable(s): ${missing.join(', ')} — set them in the Vercel project settings.`);
}

export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);
