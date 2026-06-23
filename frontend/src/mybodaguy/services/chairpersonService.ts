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
      .from('committee_members')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .single();

    if (error) {
      console.error('[ChairpersonService] Error fetching committee info:', error);
      return null;
    }

    return data;
  },

  // Get subordinate chairpersons
  async getSubordinates(userId: string): Promise<SubordinateChairperson[]> {
    const { data, error } = await supabase
      .rpc('get_subordinate_chairpersons', { chairperson_user_id: userId });

    if (error) {
      console.error('[ChairpersonService] Error fetching subordinates:', error);
      return [];
    }

    return data || [];
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
      // First, look up or create the target user
      const { data: existingUser, error: userLookupError } = await supabase
        .from('mbg_users')
        .select('id')
        .eq('email', params.targetUserEmail)
        .single();

      let targetUserId: string;

      if (userLookupError || !existingUser) {
        // User doesn't exist, need to invite them
        return {
          success: false,
          error: 'User not found. They need to sign up first or you need to send them an invitation.'
        };
      }

      targetUserId = existingUser.id;

      // Call the assign_chairperson function
      const { data, error } = await supabase
        .rpc('assign_chairperson', {
          target_user_id: targetUserId,
          target_role: params.targetRole,
          target_region_type: params.targetRegionType,
          target_region_id: params.targetRegionId,
          commission_rate: params.commissionRate || 5.0,
          notes: params.notes || null
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
      .from('committee_members')
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
