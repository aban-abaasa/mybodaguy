import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storageKey: 'mybodaguy-auth',
    lockAcquireTimeout: 10000,
    detectSessionInUrl: true,
    flowType: 'pkce',
    autoRefreshToken: true,
    persistSession: true,
    storage: localStorage,
  },
  // Reduce connection pool issues
  global: {
    headers: {
      'x-client-info': 'mybodaguy-web',
    },
  },
});
