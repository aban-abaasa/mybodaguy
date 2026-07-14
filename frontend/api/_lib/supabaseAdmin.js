import { createClient } from '@supabase/supabase-js';

// Service-role client for Vercel serverless functions only (never imported
// by client-side code — everything under /api runs server-side on Vercel).
// SUPABASE_SERVICE_ROLE_KEY must be set as a plain (non-VITE_) environment
// variable in the Vercel project so it's never bundled into the browser.
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
