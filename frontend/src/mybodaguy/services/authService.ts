import { supabase } from './supabaseClient';

export const authService = {
  // Sign in with email and password
  async signIn(email: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) throw error;
    return data;
  },

  // Sign up with email and password. country is asked at signup so
  // cross-border matching (mbg_riders.operator_country/service_countries,
  // mbg_user_profiles.country) has real data from day one instead of
  // defaulting every account to Uganda.
  async signUp(email: string, password: string, fullName?: string, country?: string) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName || '',
          country: country || 'Uganda',
        },
      },
    });

    if (error) throw error;

    // auth.users is shared across ICAN, digital-city-era and mybodaguy —
    // Supabase silently "succeeds" a signUp for an email that already has an
    // account (in any of the three apps) by returning a user with no
    // identities, instead of an error. Surface that as a real error so the
    // caller doesn't tell the person to "check their email" for nothing.
    if (data.user && data.user.identities && data.user.identities.length === 0) {
      throw new Error('An account with this email already exists. Please sign in instead.');
    }

    return data;
  },

  // Sign out
  async signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  },

  // Get current session
  async getSession() {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    return data.session;
  },

  // Get current user
  async getCurrentUser() {
    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;
    return data.user;
  },

  // Listen to auth state changes
  onAuthStateChange(callback: (event: string, session: any) => void) {
    return supabase.auth.onAuthStateChange(callback);
  },

  // Reset password
  async resetPassword(email: string) {
    const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    if (error) throw error;
    return data;
  },

  // Update password
  async updatePassword(newPassword: string) {
    const { data, error } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (error) throw error;
    return data;
  },

  // Sign in with an ICANera wallet account number (or phone) + PIN. Verified
  // server-side by the same wallet-login edge function ICAN uses (shared
  // Supabase project, shared auth.users), which hands back a magic-link
  // token_hash redeemed into a real session here — so one wallet account
  // works across ICAN, digital-city-era and mybodaguy. userService.getUserRole
  // auto-provisions the mbg_users row (via sync_user_from_auth) on first use.
  async signInWithWallet(identifier: string, pin: string) {
    const { data, error } = await supabase.functions.invoke('wallet-login', {
      body: { identifier: String(identifier || '').trim(), pin: String(pin || '').trim() },
    });

    if (error) {
      // supabase-js only gives a generic "Edge Function returned a non-2xx
      // status code" here — the real { success: false, error } body lives on
      // error.context (the raw Response object).
      const detail = await (error as any).context?.json?.().catch(() => null);
      throw new Error(detail?.error || error.message);
    }
    if (!data?.success) throw new Error(data?.error || 'Wallet sign-in failed');

    const { data: otpData, error: otpError } = await supabase.auth.verifyOtp({
      token_hash: data.token_hash,
      type: 'email',
    });

    if (otpError) throw otpError;
    return otpData;
  },

  // Sign in with Google
  async signInWithGoogle() {
    console.log('[AuthService] Initiating Google OAuth...');
    console.log('[AuthService] Redirect will be to:', window.location.origin);
    
    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}`,
        },
      });

      if (error) {
        console.error('[AuthService] OAuth error:', error);
        throw error;
      }
      
      console.log('[AuthService] OAuth initiated successfully:', data);
      return data;
    } catch (err) {
      console.error('[AuthService] Exception during OAuth:', err);
      throw err;
    }
  },
};
