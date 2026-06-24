import { supabase } from './supabaseClient';

export type RegionType = 'district' | 'division' | 'subcounty' | 'parish' | 'stage';
export type ChairpersonRole = 
  | 'district_chairperson' 
  | 'division_chairperson' 
  | 'subcounty_chairperson' 
  | 'parish_chairperson' 
  | 'stage_chairperson';

export interface CommitteeMember {
  id: string;
  user_id: string;
  role: ChairpersonRole;
  region_type: RegionType;
  region_id: string;
  assigned_by: string | null;
  parent_chairperson_id: string | null;
  commission_rate: number;
  notes: string | null;
  phone: string | null;
  is_active: boolean;
  appointed_at: string;
}

export interface CommitteeMemberDetails {
  id: string;
  committee_member_id: string;
  full_name: string;
  national_id: string | null;
  profile_photo_url: string | null;
  address: string | null;
  alternate_phone: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  appointment_letter_url: string | null;
  bio: string | null;
}

export interface SubordinateChairperson {
  id: string;
  user_id: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: ChairpersonRole;
  region_type: RegionType;
  region_id: string;
  region_name: string;
  commission_rate: number;
  is_active: boolean;
  appointed_at: string;
}

export const chairpersonService = {
  // Get current user's committee member info
  async getMyCommitteeInfo(userId: string): Promise<CommitteeMember | null> {
    const { data, error } = await supabase
      .from('mbg_committee_members')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .maybeSingle();

    if (error) {
      console.error('[ChairpersonService] Error fetching committee info:', error);
      return null;
    }

    return data;
  },

  // Get ALL committee assignments for a user (multi-role support)
  async getAllMyCommitteeAssignments(userId: string): Promise<CommitteeMember[]> {
    const { data, error } = await supabase
      .from('mbg_committee_members')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .order('appointed_at', { ascending: false });

    if (error) {
      console.error('[ChairpersonService] Error fetching all committee assignments:', error);
      return [];
    }

    return data || [];
  },

  // Get subordinate chairpersons
  async getSubordinates(userId: string): Promise<SubordinateChairperson[]> {
    // Try RPC first
    const { data: rpcData, error: rpcError } = await supabase
      .rpc('get_subordinate_chairpersons', { chairperson_user_id: userId });
    if (!rpcError && rpcData && rpcData.length > 0) return rpcData;
    if (rpcError) console.error('[ChairpersonService] RPC error:', rpcError);

    // Fallback: region hierarchy — find committee members in sub-regions of this user's regions
    const myAssignments = await this.getAllMyCommitteeAssignments(userId);

    // Map each region level to its sub-region table and FK column
    const subRegionConfig: Record<string, { table: string; fk: string; childType: string }> = {
      district:  { table: 'mbg_divisions',   fk: 'district_id',  childType: 'division' },
      division:  { table: 'mbg_subcounties', fk: 'division_id',  childType: 'subcounty' },
      subcounty: { table: 'mbg_parishes',    fk: 'subcounty_id', childType: 'parish' },
      parish:    { table: 'mbg_stages',      fk: 'parish_id',    childType: 'stage' },
    };

    const seenIds = new Set<string>();
    const allMembers: any[] = [];

    for (const assignment of myAssignments) {
      const cfg = subRegionConfig[assignment.region_type];
      if (!cfg) continue;

      // Get IDs of immediate sub-regions
      const { data: subRegions } = await supabase
        .from(cfg.table)
        .select('id')
        .eq(cfg.fk, assignment.region_id);

      const subIds = (subRegions || []).map((r: any) => r.id);
      if (subIds.length === 0) continue;

      // Find committee members in those sub-regions (exclude self)
      const { data: members } = await supabase
        .from('mbg_committee_members')
        .select('id, user_id, role, region_type, region_id, commission_rate, is_active, appointed_at')
        .eq('region_type', cfg.childType)
        .in('region_id', subIds)
        .eq('is_active', true)
        .neq('user_id', userId);

      for (const m of members || []) {
        if (!seenIds.has(m.id)) {
          seenIds.add(m.id);
          allMembers.push(m);
        }
      }
    }

    return this._enrichMembers(allMembers);
  },

  // Attach user email + full_name to raw committee member rows
  async _enrichMembers(members: any[]): Promise<SubordinateChairperson[]> {
    if (!members.length) return [];
    return Promise.all(
      members.map(async (cm) => {
        const { data: u } = await supabase
          .from('mbg_users')
          .select('email, mbg_user_profiles(full_name, phone)')
          .eq('id', cm.user_id)
          .maybeSingle();
        return {
          id: cm.id,
          user_id: cm.user_id,
          full_name: (u as any)?.mbg_user_profiles?.[0]?.full_name || u?.email?.split('@')[0] || 'Unknown',
          email: u?.email || '',
          phone: (u as any)?.mbg_user_profiles?.[0]?.phone || null,
          role: cm.role,
          region_type: cm.region_type,
          region_id: cm.region_id,
          region_name: '',
          commission_rate: cm.commission_rate,
          is_active: cm.is_active,
          appointed_at: cm.appointed_at,
        } as SubordinateChairperson;
      })
    );
  },

  // Get subordinates for specific committee assignment
  async getSubordinatesForAssignment(committeeId: string): Promise<SubordinateChairperson[]> {
    // This would need a new RPC function, for now use existing and filter by region
    const { data: assignment } = await supabase
      .from('mbg_committee_members')
      .select('user_id')
      .eq('id', committeeId)
      .single();

    if (!assignment) return [];

    return this.getSubordinates(assignment.user_id);
  },

  // Assign a new chairperson
  async assignChairperson(params: {
    targetUserEmail: string;
    targetRole: ChairpersonRole;
    targetRegionType: RegionType;
    targetRegionId: string;
    commissionRate?: number;
    notes?: string;
  }): Promise<{ success: boolean; error?: string; committeeId?: string }> {
    try {
      // First, check if user exists in mbg_users
      const { data: existingUser, error: userLookupError } = await supabase
        .from('mbg_users')
        .select('id')
        .eq('email', params.targetUserEmail)
        .maybeSingle();

      if (userLookupError) {
        console.error('Error looking up user:', userLookupError);
        return {
          success: false,
          error: `Error looking up user: ${userLookupError.message}`
        };
      }

      let targetUserId: string;

      if (!existingUser) {
        // User not in mbg_users yet, sync from auth.users using database function
        console.log('[ChairpersonService] User not in mbg_users, syncing from auth.users...');
        
        // Get user ID from auth.users
        const { data: authUsers, error: authError } = await supabase.rpc('get_all_auth_users');
        
        if (authError) {
          return {
            success: false,
            error: 'Could not verify user exists. Please ensure they have signed up.'
          };
        }

        const authUser = authUsers?.find((u: any) => u.email === params.targetUserEmail);
        
        if (!authUser) {
          return {
            success: false,
            error: 'User not found. They need to sign up first.'
          };
        }

        // Sync user using database function (bypasses RLS)
        const { data: syncResult, error: syncError } = await supabase
          .rpc('sync_user_from_auth', { target_user_id: authUser.id });

        if (syncError || !syncResult?.success) {
          console.error('[ChairpersonService] Error syncing user:', syncError || syncResult?.error);
          return {
            success: false,
            error: `Could not sync user: ${syncError?.message || syncResult?.error || 'Unknown error'}`
          };
        }

        targetUserId = authUser.id;
      } else {
        targetUserId = existingUser.id;
      }

      // Call the mbg_assign_chairperson function (MyBodaGuy specific)
      const { data, error } = await supabase
        .rpc('mbg_assign_chairperson', {
          target_user_id: targetUserId,
          target_role: params.targetRole,
          target_region_type: params.targetRegionType,
          target_region_id: params.targetRegionId,
          commission_rate: params.commissionRate || 5.0
        });

      if (error) {
        console.error('[ChairpersonService] Error assigning chairperson:', error);
        return {
          success: false,
          error: error.message
        };
      }

      return {
        success: true,
        committeeId: data
      };
    } catch (err: any) {
      console.error('[ChairpersonService] Unexpected error:', err);
      return {
        success: false,
        error: err.message || 'Unexpected error occurred'
      };
    }
  },

  // Update subordinate chairperson status
  async updateSubordinateStatus(committeeId: string, isActive: boolean): Promise<boolean> {
    const { error } = await supabase
      .from('mbg_committee_members')
      .update({ is_active: isActive, updated_at: new Date().toISOString() })
      .eq('id', committeeId);

    if (error) {
      console.error('[ChairpersonService] Error updating status:', error);
      return false;
    }

    return true;
  },

  // Get regions available for assignment based on current user's level
  async getAssignableRegions(userId: string): Promise<{
    regionType: RegionType;
    regions: Array<{ id: string; name: string }>;
  } | null> {
    try {
      // Get current user's committee info
      const committeeInfo = await this.getMyCommitteeInfo(userId);
      
      if (!committeeInfo) {
        return null;
      }

      let regionType: RegionType;
      let tableName: string;
      let parentColumn: string;

      // Determine what level can be assigned based on current role
      switch (committeeInfo.role) {
        case 'district_chairperson':
          regionType = 'division';
          tableName = 'divisions';
          parentColumn = 'district_id';
          break;
        case 'division_chairperson':
          regionType = 'subcounty';
          tableName = 'subcounties';
          parentColumn = 'division_id';
          break;
        case 'subcounty_chairperson':
          regionType = 'parish';
          tableName = 'parishes';
          parentColumn = 'subcounty_id';
          break;
        case 'parish_chairperson':
          regionType = 'stage';
          tableName = 'stages';
          parentColumn = 'parish_id';
          break;
        default:
          return null;
      }

      // Fetch available regions
      const { data, error } = await supabase
        .from(tableName)
        .select('id, name')
        .eq(parentColumn, committeeInfo.region_id)
        .eq('is_active', true)
        .order('name');

      if (error) {
        console.error('[ChairpersonService] Error fetching regions:', error);
        return null;
      }

      return {
        regionType,
        regions: data || []
      };
    } catch (err) {
      console.error('[ChairpersonService] Error getting assignable regions:', err);
      return null;
    }
  },

  // Create or update committee member details
  async updateCommitteeMemberDetails(
    committeeId: string,
    details: Partial<CommitteeMemberDetails>
  ): Promise<boolean> {
    const { error } = await supabase
      .from('committee_member_details')
      .upsert({
        committee_member_id: committeeId,
        ...details,
        updated_at: new Date().toISOString()
      });

    if (error) {
      console.error('[ChairpersonService] Error updating details:', error);
      return false;
    }

    return true;
  },

  // Get committee member details
  async getCommitteeMemberDetails(committeeId: string): Promise<CommitteeMemberDetails | null> {
    const { data, error } = await supabase
      .from('committee_member_details')
      .select('*')
      .eq('committee_member_id', committeeId)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows
      console.error('[ChairpersonService] Error fetching details:', error);
    }

    return data;
  },

  // Get committee hierarchy view
  async getCommitteeHierarchy(): Promise<any[]> {
    const { data, error } = await supabase
      .from('committee_hierarchy')
      .select('*')
      .eq('is_active', true)
      .order('appointed_at', { ascending: false });

    if (error) {
      console.error('[ChairpersonService] Error fetching hierarchy:', error);
      return [];
    }

    return data || [];
  }
};
