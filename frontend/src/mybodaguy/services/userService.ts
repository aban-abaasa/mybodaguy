import { supabase } from './supabaseClient';

export const userService = {
  // Get user role from mbg_users table
  async getUserRole(userId: string): Promise<string | null> {
    console.log('[UserService] Fetching role for user:', userId);
    
    try {
      // Add a reasonable timeout (30 seconds) with proper fallback
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const { data, error } = await supabase
        .from('mbg_users')
        .select('role_type, user_roles')
        .eq('id', userId)
        .abortSignal(controller.signal)
        .maybeSingle();

      clearTimeout(timeoutId);

      if (error) {
        console.error('[UserService] Error fetching user role:', error);
        // Return 'customer' as default instead of null to prevent logout
        return 'customer';
      }

      if (!data) {
        console.warn('[UserService] No user record found for:', userId);
        console.log('[UserService] This user may need to be synced from auth.users');
        // Try to sync the user first
        try {
          const { data: syncResult } = await supabase.rpc('sync_user_from_auth', {
            target_user_id: userId
          });
          if (syncResult?.success) {
            console.log('[UserService] User synced successfully, retrying...');
            // Retry once after sync
            const { data: retryData } = await supabase
              .from('mbg_users')
              .select('role_type, user_roles')
              .eq('id', userId)
              .maybeSingle();
            return retryData?.role_type || retryData?.user_roles?.[0] || 'customer';
          }
        } catch (syncErr) {
          console.error('[UserService] Sync failed:', syncErr);
        }
        // Return 'customer' as default
        return 'customer';
      }

      console.log('[UserService] User role data:', data);
      // Fall back to user_roles array if role_type is not set
      return data?.role_type || data?.user_roles?.[0] || 'customer';
    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.error('[UserService] Query timed out after 30 seconds');
      } else {
        console.error('[UserService] Query failed:', err);
      }
      // Return 'customer' as default to prevent logout on errors
      return 'customer';
    }
  },

  // Get all roles for a user (NEW - Multi-role support)
  async getUserRoles(userId: string): Promise<string[]> {
    console.log('[UserService] Fetching all roles for user:', userId);
    
    try {
      const { data, error } = await supabase.rpc('get_user_roles', {
        target_user_id: userId
      });

      if (error) {
        console.error('[UserService] Error fetching user roles:', error);
        // Fallback to single role
        const singleRole = await this.getUserRole(userId);
        return singleRole ? [singleRole] : ['customer'];
      }

      console.log('[UserService] User roles:', data);
      return data || ['customer'];
    } catch (err) {
      console.error('[UserService] getUserRoles failed:', err);
      // Fallback to single role
      const singleRole = await this.getUserRole(userId);
      return singleRole ? [singleRole] : ['customer'];
    }
  },

  // Add role to user
  async addUserRole(userId: string, role: string): Promise<boolean> {
    try {
      const { data, error } = await supabase.rpc('add_user_role', {
        target_user_id: userId,
        new_role: role
      });

      if (error) {
        console.error('[UserService] Error adding user role:', error);
        return false;
      }

      return data;
    } catch (err) {
      console.error('[UserService] addUserRole failed:', err);
      return false;
    }
  },

  // Remove role from user
  async removeUserRole(userId: string, role: string): Promise<boolean> {
    try {
      const { data, error } = await supabase.rpc('remove_user_role', {
        target_user_id: userId,
        role_to_remove: role
      });

      if (error) {
        console.error('[UserService] Error removing user role:', error);
        return false;
      }

      return data;
    } catch (err) {
      console.error('[UserService] removeUserRole failed:', err);
      return false;
    }
  },

  // Check if user has specific role
  async userHasRole(userId: string, role: string): Promise<boolean> {
    try {
      const { data, error} = await supabase.rpc('user_has_role', {
        target_user_id: userId,
        role_to_check: role
      });

      if (error) {
        console.error('[UserService] Error checking user role:', error);
        return false;
      }

      return data || false;
    } catch (err) {
      console.error('[UserService] userHasRole failed:', err);
      return false;
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
    // First try to get users from the database function that queries auth.users
    try {
      const { data, error } = await supabase.rpc('get_all_auth_users');
      
      if (error) {
        console.error('[UserService] Error calling get_all_auth_users:', error);
        // Fallback to mbg_users table if function doesn't exist
        const fallbackResult = await supabase
          .from('mbg_users')
          .select(`
            *,
            mbg_user_profiles (*)
          `)
          .order('created_at', { ascending: false });
        
        if (fallbackResult.error) throw fallbackResult.error;
        return fallbackResult.data;
      }
      
      // Transform the RPC result to match expected format
      return data?.map((user: any) => ({
        id: user.id,
        email: user.email,
        phone: user.phone,
        role_type: user.role_type,
        is_active: user.is_active,
        created_at: user.created_at,
        mbg_user_profiles: user.full_name ? [{ full_name: user.full_name }] : [],
        user_metadata: {
          full_name: user.full_name
        }
      })) || [];
    } catch (err) {
      console.error('[UserService] Error in getAllUsers:', err);
      throw err;
    }
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
