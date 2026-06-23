import { supabase } from './supabaseClient';

export const roleService = {
  // Promote user to rider (must be done by Stage Chairperson or Developer)
  async promoteToRider(userId: string, stageId: string, vehicleDetails: any) {
    // First update user role
    const { error: userError } = await supabase
      .from('mbg_users')
      .update({ role_type: 'rider', updated_at: new Date().toISOString() })
      .eq('id', userId);

    if (userError) throw userError;

    // Create rider profile
    const { data, error } = await supabase
      .from('mbg_riders')
      .insert({
        user_id: userId,
        stage_id: stageId,
        ...vehicleDetails,
        status: 'pending', // Needs approval
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  // Promote user to chairperson (must be done by higher-level chairperson or Developer)
  async promoteToChairperson(
    userId: string,
    role: string,
    regionType: string,
    regionId: string,
    assignedBy: string
  ) {
    // First update user role
    const { error: userError } = await supabase
      .from('mbg_users')
      .update({ role_type: 'chairperson', updated_at: new Date().toISOString() })
      .eq('id', userId);

    if (userError) throw userError;

    // Create committee member record
    const { data, error } = await supabase
      .from('mbg_committee_members')
      .insert({
        user_id: userId,
        role: role,
        region_type: regionType,
        region_id: regionId,
        assigned_by: assignedBy,
        is_active: true,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  // Demote user back to customer (Developer only)
  async demoteToCustomer(userId: string) {
    const { error } = await supabase
      .from('mbg_users')
      .update({ role_type: 'customer', updated_at: new Date().toISOString() })
      .eq('id', userId);

    if (error) throw error;

    // Optionally deactivate their rider/chairperson records instead of deleting
    // This preserves history
    await supabase
      .from('mbg_riders')
      .update({ status: 'inactive' })
      .eq('user_id', userId);

    await supabase
      .from('mbg_committee_members')
      .update({ is_active: false })
      .eq('user_id', userId);
  },

  // Check if user can be promoted (they must be signed up first)
  async canPromoteUser(userId: string): Promise<boolean> {
    const { data, error } = await supabase
      .from('mbg_users')
      .select('id, role_type')
      .eq('id', userId)
      .single();

    if (error) return false;
    return data !== null; // User exists in system
  },

  // Get users eligible for promotion (customers only)
  async getEligibleUsers() {
    const { data, error } = await supabase
      .from('mbg_users')
      .select(`
        *,
        mbg_user_profiles (*)
      `)
      .eq('role_type', 'customer')
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
  },
};
