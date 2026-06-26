import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Singleton instance of Supabase client
let supabaseInstance: SupabaseClient | null = null;

const SUPABASE_CONFIG_ERROR =
  '❌ [Supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in environment variables';

function createSupabaseConfigError(): Error {
  return new Error(SUPABASE_CONFIG_ERROR);
}

function createNoopChain(): any {
  const chain: Record<string | symbol, any> = {};

  const proxy = new Proxy(chain, {
    get(_target, prop) {
      if (prop === 'then') {
        return (onFulfilled?: (value: { data: null; error: Error }) => unknown, onRejected?: (reason: unknown) => unknown) =>
          Promise.resolve({ data: null, error: createSupabaseConfigError() }).then(onFulfilled, onRejected);
      }

      if (prop === 'catch') {
        return (onRejected?: (reason: unknown) => unknown) =>
          Promise.resolve({ data: null, error: createSupabaseConfigError() }).catch(onRejected);
      }

      if (prop === 'finally') {
        return (onFinally?: () => void) =>
          Promise.resolve({ data: null, error: createSupabaseConfigError() }).finally(onFinally);
      }

      return (..._args: unknown[]) => proxy;
    },
  });

  return proxy;
}

function createNoopSupabaseClient(): SupabaseClient {
  const noopChain = createNoopChain();

  return {
    auth: {
      async signUp() {
        return { data: null, error: createSupabaseConfigError() };
      },
      async signInWithPassword() {
        return { data: null, error: createSupabaseConfigError() };
      },
      async signInWithOAuth() {
        return { data: null, error: createSupabaseConfigError() };
      },
      async signInAnonymously() {
        return { data: null, error: createSupabaseConfigError() };
      },
      async signOut() {
        return { error: createSupabaseConfigError() };
      },
      async resetPasswordForEmail() {
        return { data: null, error: createSupabaseConfigError() };
      },
      async updateUser() {
        return { data: null, error: createSupabaseConfigError() };
      },
      async verifyOtp() {
        return { data: null, error: createSupabaseConfigError() };
      },
      async getSession() {
        return { data: { session: null }, error: createSupabaseConfigError() };
      },
      async getUser() {
        return { data: { user: null }, error: createSupabaseConfigError() };
      },
      onAuthStateChange(callback: (event: string, session: null) => void) {
        queueMicrotask(() => callback('SIGNED_OUT', null));

        return {
          data: { subscription: { unsubscribe: () => undefined } },
          error: null,
        };
      },
    },
    from() {
      return noopChain;
    },
    rpc() {
      return Promise.resolve({ data: null, error: createSupabaseConfigError() });
    },
    channel() {
      return noopChain;
    },
    removeChannel() {
      return Promise.resolve();
    },
    getChannels() {
      return [];
    },
    storage: {
      from() {
        return noopChain;
      },
    },
    realtime: {
      setAuth: async () => ({ error: createSupabaseConfigError() }),
    },
    functions: {
      invoke: async () => ({ data: null, error: createSupabaseConfigError() }),
    },
    schemas: {},
    rest: {} as any,
    authStateChangeEmitters: {},
    ...noopChain,
  } as unknown as SupabaseClient;
}

// Strip expired implicit-flow auth hashes from the URL before the client
// reads them — prevents a stale email-confirmation link from triggering
// a 403 → forced sign-out loop.
if (typeof window !== 'undefined' && window.location.hash.includes('access_token')) {
  try {
    const params    = new URLSearchParams(window.location.hash.slice(1));
    const expiresAt = Number(params.get('expires_at') || 0);
    const nowSec    = Math.floor(Date.now() / 1000);
    if (expiresAt > 0 && expiresAt < nowSec) {
      console.warn('[Supabase] Stale auth URL detected — clearing hash.');
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  } catch (_) { /* ignore hash-parsing failures */ }
}

/**
 * Initialize Supabase client as a singleton
 * Ensures only one GoTrueClient instance exists across the app
 */
export function initSupabaseClient(): SupabaseClient {
  if (supabaseInstance) {
    return supabaseInstance;
  }

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  // Validation
  if (!supabaseUrl || !supabaseAnonKey) {
    console.error(SUPABASE_CONFIG_ERROR);
    console.warn('ℹ️ [Supabase] Create frontend/.env.local from frontend/.env.example and add your real credentials.');
    supabaseInstance = createNoopSupabaseClient();
    return supabaseInstance;
  }

  try {
    // Create client with optimized settings
    supabaseInstance = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
        flowType: 'implicit',
      },
      realtime: {
        params: {
          eventsPerSecond: 10,
        },
      },
    });

    console.log('✅ [Supabase] Client initialized (singleton instance)');
    console.log(`✅ [Supabase] Project: ${supabaseUrl.split('.')[0].split('//')[1]}`);
    return supabaseInstance;
  } catch (err) {
    console.error('❌ [Supabase] Failed to initialize client:', err);
    supabaseInstance = createNoopSupabaseClient();
    return supabaseInstance;
  }
}

/**
 * Get the Supabase client instance
 * Creates it if it doesn't exist yet
 */
export function getSupabaseClient(): SupabaseClient {
  if (!supabaseInstance) {
    return initSupabaseClient();
  }
  return supabaseInstance;
}

// Initialize on module load to catch configuration errors early
export const supabase = getSupabaseClient();
