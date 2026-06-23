import { supabase } from './supabaseClient';

export const userService = {
  // Get user role from mbg_users table
  async getUserRole(userId: string): Promise<string | null> {
    console.log('[UserService] Fetching role for user:', userId);
    
    try {
      // Add timeout wrapper to detect hanging queries
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Query timeout after 10 seconds')), 10000);
      });

      const queryPromise = supabase
        .from('mbg_users')
        .select('role_type')
        .eq('id', userId)
        .single();

      const { data, error } = await Promise.race([queryPromise, timeoutPromise]);

      if (error) {
        console.error('[UserService] Error fetching user role:', error);
        console.error('[UserService] Error details:', {
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint
        });
        return null;
      }

      console.log('[UserService] User role data:', data);
      return data?.role_type || null;
    } catch (err) {
      console.error('[UserService] Query failed or timed out:', err);
      
      // Check if Supabase is reachable
      console.log('[UserService] Testing Supabase connection...');
      try {
        const testResponse = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/`, {
          method: 'HEAD',
          headers: {
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY
          }
        });
        console.log('[UserService] Supabase REST endpoint status:', testResponse.status);
      } catch (fetchErr) {
        console.error('[UserService] Cannot reach Supabase:', fetchErr);
      }
      
      return null;
    }
  },

  // Get user profile
  async getUserProfile(userId: string) {
    const { data, error } = await supabase
      .from('mbg_user_profiles')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error) throw error;
    return data;
  },

  // Update user profile
  async updateUserProfile(userId: string, updates: any) {
    const { data, error } = await supabase
      .from('mbg_user_profiles')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  // Get all users (developer only)
  async getAllUsers() {
    const { data, error } = await supabase
      .from('mbg_users')
      .select(`
        *,
        mbg_user_profiles (*)
      `)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
  },

  // Update user role (developer only)
  async updateUserRole(userId: string, roleType: string) {
    const { data, error } = await supabase
      .from('mbg_users')
      .update({ role_type: roleType, updated_at: new Date().toISOString() })
      .eq('id', userId)
      .select()
      .single();

    if (error) throw error;
    return data;
  },
};
