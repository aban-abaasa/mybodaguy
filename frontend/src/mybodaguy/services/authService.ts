import { supabase, createIsolatedAuthClient } from './supabaseClient';

export type IcaneraSignInResult =
  | { status: 'signed_in' }
  | {
      status: 'mfa_required';
      verify: (code: string) => Promise<void>;
      cancel: () => Promise<void>;
    };

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

  // Sign in with ICANera credentials: the email + password of the ICANera
  // account (shared Supabase project, shared auth.users, so the same account
  // works across ICAN, digital-city-era and mybodaguy). This replaces the old
  // wallet account number + PIN sign-in, whose 4-6 digit PIN could be guessed.
  //
  // The password is checked on an isolated client. If the account has
  // two-step verification (authenticator app) switched on in ICAN, the
  // session is only handed to the app-wide client once the 6-digit code has
  // been accepted, so a stolen password alone never gets anyone in.
  // userService.getUserRole auto-provisions the mbg_users row (via
  // sync_user_from_auth) on first use.
  async signInWithIcanera(email: string, password: string): Promise<IcaneraSignInResult> {
    const isolated = createIsolatedAuthClient();

    const { error } = await isolated.auth.signInWithPassword({
      email: String(email || '').trim().toLowerCase(),
      password,
    });
    if (error) throw error;

    const adoptSession = async () => {
      const { data: { session } } = await isolated.auth.getSession();
      if (!session) throw new Error('Sign-in failed. Please try again.');

      const { error: adoptError } = await supabase.auth.setSession({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      });
      if (adoptError) throw adoptError;
      // Not signOut(): that would revoke the very session just handed over.
      isolated.auth.stopAutoRefresh();
    };

    // Fail closed: if the assurance level can't be read, don't sign in.
    const { data: aal, error: aalError } = await isolated.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aalError || !aal) {
      await isolated.auth.signOut();
      throw new Error('Could not check your two-step verification. Please try again.');
    }

    if (aal.currentLevel === 'aal1' && aal.nextLevel === 'aal2') {
      return {
        status: 'mfa_required',
        verify: async (code: string) => {
          const { data: factors, error: factorsError } = await isolated.auth.mfa.listFactors();
          if (factorsError) throw factorsError;
          const factor = factors?.totp?.find((f) => f.status === 'verified');
          if (!factor) throw new Error('Could not find your authenticator app. Sign in to ICAN to review two-step verification.');

          const { error: verifyError } = await isolated.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
          if (verifyError) throw verifyError;
          await adoptSession();
        },
        cancel: async () => {
          await isolated.auth.signOut().catch(() => undefined);
        },
      };
    }

    await adoptSession();
    return { status: 'signed_in' };
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
