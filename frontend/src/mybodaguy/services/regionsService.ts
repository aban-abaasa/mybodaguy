import { supabase } from './supabaseClient';

export interface District {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Division {
  id: string;
  district_id: string;
  name: string;
  code: string | null;
  description: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Subcounty {
  id: string;
  division_id: string;
  name: string;
  code: string | null;
  description: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Parish {
  id: string;
  subcounty_id: string;
  name: string;
  code: string | null;
  description: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Stage {
  id: string;
  parish_id: string;
  name: string;
  location_name: string | null;
  location_lat: number | null;
  location_lng: number | null;
  description: string | null;
  is_active: boolean;
  created_at: string;
}

export const regionsService = {
  // Districts
  async getAllDistricts(): Promise<District[]> {
    const { data, error } = await supabase
      .from('districts')
      .select('*')
      .order('name');

    if (error) {
      console.error('[RegionsService] Error fetching districts:', error);
      return [];
    }

    return data || [];
  },

  async createDistrict(district: { name: string; code?: string; description?: string }): Promise<{ success: boolean; data?: District; error?: string }> {
    const { data, error } = await supabase
      .from('districts')
      .insert([district])
      .select()
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data };
  },

  async updateDistrict(id: string, updates: Partial<District>): Promise<boolean> {
    const { error } = await supabase
      .from('districts')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id);

    return !error;
  },

  // Divisions
  async getDivisionsByDistrict(districtId: string): Promise<Division[]> {
    const { data, error } = await supabase
      .from('divisions')
      .select('*')
      .eq('district_id', districtId)
      .order('name');

    if (error) {
      console.error('[RegionsService] Error fetching divisions:', error);
      return [];
    }

    return data || [];
  },

  async createDivision(division: { district_id: string; name: string; code?: string; description?: string }): Promise<{ success: boolean; data?: Division; error?: string }> {
    const { data, error } = await supabase
      .from('divisions')
      .insert([division])
      .select()
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data };
  },

  // Subcounties
  async getSubcountiesByDivision(divisionId: string): Promise<Subcounty[]> {
    const { data, error } = await supabase
      .from('subcounties')
      .select('*')
      .eq('division_id', divisionId)
      .order('name');

    if (error) {
      console.error('[RegionsService] Error fetching subcounties:', error);
      return [];
    }

    return data || [];
  },

  async createSubcounty(subcounty: { division_id: string; name: string; code?: string; description?: string }): Promise<{ success: boolean; data?: Subcounty; error?: string }> {
    const { data, error } = await supabase
      .from('subcounties')
      .insert([subcounty])
      .select()
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data };
  },

  // Parishes
  async getParishesBySubcounty(subcountyId: string): Promise<Parish[]> {
    const { data, error } = await supabase
      .from('parishes')
      .select('*')
      .eq('subcounty_id', subcountyId)
      .order('name');

    if (error) {
      console.error('[RegionsService] Error fetching parishes:', error);
      return [];
    }

    return data || [];
  },

  async createParish(parish: { subcounty_id: string; name: string; code?: string; description?: string }): Promise<{ success: boolean; data?: Parish; error?: string }> {
    const { data, error } = await supabase
      .from('parishes')
      .insert([parish])
      .select()
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data };
  },

  // Stages
  async getStagesByParish(parishId: string): Promise<Stage[]> {
    const { data, error } = await supabase
      .from('stages')
      .select('*')
      .eq('parish_id', parishId)
      .order('name');

    if (error) {
      console.error('[RegionsService] Error fetching stages:', error);
      return [];
    }

    return data || [];
  },

  async createStage(stage: { 
    parish_id: string; 
    name: string; 
    location_name?: string;
    location_lat?: number;
    location_lng?: number;
    description?: string;
  }): Promise<{ success: boolean; data?: Stage; error?: string }> {
    const { data, error } = await supabase
      .from('stages')
      .insert([stage])
      .select()
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data };
  },

  // Get chairperson for a specific region
  async getRegionChairperson(regionType: string, regionId: string) {
    const { data, error } = await supabase
      .from('mbg_committee_members')
      .select(`
        *,
        mbg_users!user_id(
          email,
          phone,
          mbg_user_profiles(full_name)
        )
      `)
      .eq('region_type', regionType)
      .eq('region_id', regionId)
      .eq('is_active', true)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      console.error('[RegionsService] Error fetching chairperson:', error);
    }

    return data;
  }
};
