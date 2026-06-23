import { supabase } from './supabaseClient';

export interface Rider {
  id: string;
  user_id: string;
  full_name: string;
  email: string;
  phone: string | null;
  vehicle_type: 'motorcycle' | 'bicycle' | 'tuktuk';
  plate_number: string;
  license_number: string;
  vehicle_model: string | null;
  vehicle_color: string | null;
  status: 'pending' | 'active' | 'suspended' | 'inactive';
  is_available: boolean;
  rating: number;
  total_rides: number;
  completed_rides: number;
  approved_at: string | null;
  created_at: string;
}

export interface AssignRiderParams {
  targetUserEmail: string;
  targetStageId: string;
  vehicleType: 'motorcycle' | 'bicycle' | 'tuktuk';
  plateNumber: string;
  licenseNumber: string;
  licenseExpiry?: string;
  vehicleModel?: string;
  vehicleYear?: number;
  vehicleColor?: string;
}

export const riderService = {
  /**
   * Assign a rider to a stage
   */
  async assignRider(params: AssignRiderParams): Promise<{ success: boolean; error?: string; rider_id?: string }> {
    try {
      console.log('[RiderService] Assigning rider:', params);

      const { data, error } = await supabase.rpc('mbg_assign_rider', {
        target_user_email: params.targetUserEmail,
        target_stage_id: params.targetStageId,
        vehicle_type: params.vehicleType,
        plate_number: params.plateNumber,
        license_number: params.licenseNumber,
        license_expiry: params.licenseExpiry || null,
        vehicle_model: params.vehicleModel || null,
        vehicle_year: params.vehicleYear || null,
        vehicle_color: params.vehicleColor || null
      });

      if (error) {
        console.error('[RiderService] Error assigning rider:', error);
        return { success: false, error: error.message };
      }

      console.log('[RiderService] Assignment result:', data);

      if (data && typeof data === 'object') {
        if (data.success) {
          return { success: true, rider_id: data.rider_id };
        } else {
          return { success: false, error: data.error || 'Assignment failed' };
        }
      }

      return { success: false, error: 'Unexpected response format' };
    } catch (error: any) {
      console.error('[RiderService] Exception assigning rider:', error);
      return { success: false, error: error.message || 'Failed to assign rider' };
    }
  },

  /**
   * Get all riders for a stage
   */
  async getStageRiders(stageId: string): Promise<Rider[]> {
    try {
      console.log('[RiderService] Fetching riders for stage:', stageId);

      const { data, error } = await supabase.rpc('mbg_get_stage_riders', {
        target_stage_id: stageId
      });

      if (error) {
        console.error('[RiderService] Error fetching riders:', error);
        return [];
      }

      console.log('[RiderService] Riders fetched:', data?.length || 0);
      return data || [];
    } catch (error) {
      console.error('[RiderService] Exception fetching riders:', error);
      return [];
    }
  },

  /**
   * Update rider status (approve, suspend, activate)
   */
  async updateRiderStatus(
    riderId: string,
    status: 'active' | 'suspended' | 'inactive'
  ): Promise<{ success: boolean; error?: string }> {
    try {
      console.log('[RiderService] Updating rider status:', { riderId, status });

      const { error } = await supabase
        .from('mbg_riders')
        .update({
          status,
          updated_at: new Date().toISOString()
        })
        .eq('id', riderId);

      if (error) {
        console.error('[RiderService] Error updating status:', error);
        return { success: false, error: error.message };
      }

      console.log('[RiderService] Status updated successfully');
      return { success: true };
    } catch (error: any) {
      console.error('[RiderService] Exception updating status:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Update rider availability
   */
  async updateRiderAvailability(
    riderId: string,
    isAvailable: boolean
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await supabase
        .from('mbg_riders')
        .update({
          is_available: isAvailable,
          updated_at: new Date().toISOString()
        })
        .eq('id', riderId);

      if (error) {
        console.error('[RiderService] Error updating availability:', error);
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (error: any) {
      console.error('[RiderService] Exception updating availability:', error);
      return { success: false, error: error.message };
    }
  }
};
