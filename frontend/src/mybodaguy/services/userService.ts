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
    try {
      let users: any[] = [];

      const { data, error } = await supabase.rpc('get_all_auth_users');

      if (error) {
        console.error('[UserService] Error calling get_all_auth_users:', error);
        const fallbackResult = await supabase
          .from('mbg_users')
          .select('*, mbg_user_profiles (*)')
          .order('created_at', { ascending: false });

        if (fallbackResult.error) throw fallbackResult.error;
        users = fallbackResult.data || [];
      } else {
        users = data?.map((user: any) => ({
          id: user.id,
          email: user.email,
          phone: user.phone,
          role_type: user.role_type,
          is_active: user.is_active,
          created_at: user.created_at,
          mbg_user_profiles: user.full_name ? [{ full_name: user.full_name }] : [],
        })) || [];
      }

      // Fetch specific chairperson level for every user with role_type = 'chairperson'
      const chairpersonIds = users
        .filter((u: any) => u.role_type === 'chairperson')
        .map((u: any) => u.id);

      if (chairpersonIds.length > 0) {
        const { data: committeeData } = await supabase
          .from('mbg_committee_members')
          .select('user_id, role, is_active')
          .in('user_id', chairpersonIds)
          .eq('is_active', true);

        // A user may have multiple committee records. Pick the highest level
        // (lowest index in the hierarchy = most access).
        const CHAIR_HIERARCHY = [
          'district_chairperson',
          'division_chairperson',
          'subcounty_chairperson',
          'parish_chairperson',
          'stage_chairperson',
        ];
        const highestRoleMap = new Map<string, string>();
        for (const c of (committeeData || []) as any[]) {
          const current = highestRoleMap.get(c.user_id);
          if (!current) {
            highestRoleMap.set(c.user_id, c.role);
          } else {
            const currentIdx = CHAIR_HIERARCHY.indexOf(current);
            const newIdx = CHAIR_HIERARCHY.indexOf(c.role);
            if (newIdx < currentIdx) highestRoleMap.set(c.user_id, c.role);
          }
        }

        users = users.map((u: any) => ({
          ...u,
          committee_role: highestRoleMap.get(u.id) ?? null,
        }));
      }

      return users;
    } catch (err) {
      console.error('[UserService] Error in getAllUsers:', err);
      throw err;
    }
  },

  // Assign a chairperson role and automatically cascade all lower-level roles.
  // The DB trigger (13_cascade_chairperson_roles.sql) does this automatically,
  // but this function also handles it in the app layer for reliability.
  async assignChairpersonRole(
    userId: string,
    role: string,
    regionType: string,
    regionId: string
  ) {
    const CHAIR_HIERARCHY = [
      'district_chairperson',
      'division_chairperson',
      'subcounty_chairperson',
      'parish_chairperson',
      'stage_chairperson',
    ] as const;
    const REGION_TYPES = ['district', 'division', 'subcounty', 'parish', 'stage'] as const;

    const assignedIdx = CHAIR_HIERARCHY.indexOf(role as typeof CHAIR_HIERARCHY[number]);
    if (assignedIdx === -1) throw new Error(`Invalid chairperson role: ${role}`);

    const { data: { user: currentUser } } = await supabase.auth.getUser();

    // 1. Mark the user as chairperson in mbg_users
    await supabase
      .from('mbg_users')
      .update({ role_type: 'chairperson', updated_at: new Date().toISOString() })
      .eq('id', userId);

    // 2. Insert the primary committee_member record
    const { data: primary, error: primaryErr } = await supabase
      .from('mbg_committee_members')
      .upsert(
        {
          user_id: userId,
          role,
          region_type: regionType,
          region_id: regionId,
          assigned_by: currentUser?.id,
          is_active: true,
        },
        { onConflict: 'user_id,region_type,region_id' }
      )
      .select('id')
      .single();

    if (primaryErr) throw primaryErr;

    // 3. Cascade: insert every level below the assigned level
    if (assignedIdx < CHAIR_HIERARCHY.length - 1) {
      const cascadeRecords = CHAIR_HIERARCHY.slice(assignedIdx + 1).map((lowerRole, offset) => ({
        user_id: userId,
        role: lowerRole,
        region_type: REGION_TYPES[assignedIdx + 1 + offset],
        region_id: regionId,         // same region_id; inherited from top assignment
        assigned_by: currentUser?.id,
        parent_chairperson_id: primary.id,
        is_active: true,
      }));

      const { error: cascadeErr } = await supabase
        .from('mbg_committee_members')
        .upsert(cascadeRecords, { onConflict: 'user_id,region_type,region_id' });

      if (cascadeErr) {
        console.error('[UserService] cascade error (non-fatal, trigger may handle it):', cascadeErr);
      }
    }

    return primary.id;
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
