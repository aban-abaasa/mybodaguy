import { supabase } from '../../services/supabaseClient';

export type BusinessCategory = 'transport_company' | 'security_escort';

export type AccessStatus = 'pending' | 'approved' | 'rejected' | 'suspended';

/**
 * What the UI treats a business as:
 *  - unsupported: ADD_BUSINESS_REGISTRATION_AND_ACCESS.sql is not applied yet, so there is no gate
 *  - incomplete:  the business exists but has no registration row (details never submitted)
 *  - otherwise the status the developer panel set
 */
export type AccessState = 'unsupported' | 'incomplete' | AccessStatus;

export interface BusinessRegistration {
  business_profile_id: string;
  registration_number: string | null;
  tax_id: string | null;
  license_number: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  business_address: string | null;
  website: string | null;
  operating_hours: string | null;
  access_status: AccessStatus;
  grandfathered: boolean;
  rejection_reason: string | null;
  reviewed_at: string | null;
  submitted_at: string | null;
}

export interface RegistrationInput {
  registrationNumber: string;
  licenseNumber: string;
  contactPhone: string;
  taxId?: string;
  contactEmail?: string;
  businessAddress?: string;
  website?: string;
  operatingHours?: string;
}

export interface ProfileInput {
  businessName: string;
  description: string;
  homeCity: string;
  homeCountry: string;
  contactPhone: string;
  contactEmail: string;
  businessAddress: string;
  website: string;
  operatingHours: string;
}

export interface BusinessOverview {
  team_total: number;
  team_active: number;
  team_online: number;
  team_verified: number;
  avg_rating: number | null;
  rides_30d: number;
  completed_30d: number;
  cancelled_30d: number;
  active_now: number;
  revenue_30d: number;
  revenue_all: number;
  trend: { day: string; completed: number; revenue: number }[];
  top: { name: string; rides: number; revenue: number }[];
}

export const LICENSE_LABEL: Record<BusinessCategory, string> = {
  transport_company: 'Operating licence number',
  security_escort: 'Security licence number',
};

/** PostgREST / Postgres signals for "that function is not installed yet". */
export function isRpcMissing(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  return (
    err.code === 'PGRST202' ||
    err.code === '42883' ||
    /could not find the function|schema cache/i.test(err.message || '')
  );
}

export function accessStateOf(supported: boolean, reg: BusinessRegistration | undefined): AccessState {
  if (!supported) return 'unsupported';
  return reg ? reg.access_status : 'incomplete';
}

/** Whether the business may run its team (add drivers, go online, buy cover). */
export function isLive(state: AccessState): boolean {
  return state === 'unsupported' || state === 'approved';
}

/** Used by the registration form and the modal so both enforce the same rules as the database. */
export function validateRegistration(v: RegistrationInput): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!v.registrationNumber.trim()) errors.registrationNumber = 'Enter your business registration number';
  if (!v.licenseNumber.trim()) errors.licenseNumber = 'Enter your licence number';
  if (v.contactPhone.replace(/\D/g, '').length < 7) errors.contactPhone = 'Enter a valid contact phone number';
  if (v.contactEmail?.trim() && !/^\S+@\S+\.\S+$/.test(v.contactEmail.trim())) errors.contactEmail = 'Enter a valid email address';
  if (v.website?.trim() && !/^(https?:\/\/)?[^\s.]+\.[^\s]+$/.test(v.website.trim())) errors.website = 'Enter a valid website address';
  return errors;
}

/** Percent complete for the set-up checklist and profile completeness. */
export function profileCompleteness(b: { description: string | null; avatar_url: string | null; home_city: string | null }, r: BusinessRegistration | undefined): number {
  const parts = [
    !!b.avatar_url,
    !!b.description?.trim(),
    !!b.home_city?.trim(),
    !!r?.contact_phone,
    !!r?.business_address,
    !!r?.operating_hours,
  ];
  return Math.round((parts.filter(Boolean).length / parts.length) * 100);
}

export const businessService = {
  /** All registration rows for the caller's businesses, keyed by business id. */
  async listRegistrations(): Promise<{ supported: boolean; byBusiness: Map<string, BusinessRegistration>; error: string | null }> {
    const { data, error } = await supabase.rpc('mbg_my_business_registrations');
    const byBusiness = new Map<string, BusinessRegistration>();
    if (error) {
      // Not installed: behave exactly as before the gate existed.
      // Any other failure keeps the gate on and reports the error, so a flaky network never reads as "all approved".
      return isRpcMissing(error)
        ? { supported: false, byBusiness, error: null }
        : { supported: true, byBusiness, error: error.message };
    }
    for (const row of (data || []) as BusinessRegistration[]) byBusiness.set(row.business_profile_id, row);
    return { supported: true, byBusiness, error: null };
  },

  /** Returns an error message, or null on success. A missing RPC counts as success (gate not installed). */
  async submitRegistration(businessProfileId: string, v: RegistrationInput): Promise<string | null> {
    const { data, error } = await supabase.rpc('mbg_submit_business_registration', {
      p_business_profile_id: businessProfileId,
      p_registration_number: v.registrationNumber.trim(),
      p_license_number: v.licenseNumber.trim(),
      p_contact_phone: v.contactPhone.trim(),
      p_tax_id: v.taxId?.trim() || null,
      p_contact_email: v.contactEmail?.trim() || null,
      p_business_address: v.businessAddress?.trim() || null,
      p_website: v.website?.trim() || null,
      p_operating_hours: v.operatingHours?.trim() || null,
    });
    if (error) return isRpcMissing(error) ? null : error.message;
    if (!data?.success) return data?.error || 'Could not submit registration';
    return null;
  },

  async updateProfile(businessProfileId: string, v: ProfileInput): Promise<string | null> {
    const { data, error } = await supabase.rpc('mbg_update_business_profile', {
      p_business_profile_id: businessProfileId,
      p_business_name: v.businessName.trim(),
      p_description: v.description.trim() || null,
      p_home_city: v.homeCity.trim() || null,
      p_home_country: v.homeCountry.trim() || 'Uganda',
      p_contact_phone: v.contactPhone.trim() || null,
      p_contact_email: v.contactEmail.trim() || null,
      p_business_address: v.businessAddress.trim() || null,
      p_website: v.website.trim() || null,
      p_operating_hours: v.operatingHours.trim() || null,
    });
    if (error) return isRpcMissing(error) ? 'Profile editing is not switched on yet' : error.message;
    if (!data?.success) return data?.error || 'Could not save profile';
    return null;
  },

  async overview(businessProfileId: string): Promise<{ data: BusinessOverview | null; error: string | null }> {
    const { data, error } = await supabase.rpc('mbg_business_overview', { p_business_profile_id: businessProfileId });
    if (error) return { data: null, error: isRpcMissing(error) ? 'not_installed' : error.message };
    if (!data?.success) return { data: null, error: data?.error || 'Could not load overview' };
    return { data: data as BusinessOverview, error: null };
  },
};

/** Developer panel side. */
export interface AdminBusinessRow {
  business_profile_id: string;
  business_name: string;
  category_key: BusinessCategory;
  description: string | null;
  home_city: string | null;
  home_country: string | null;
  avatar_url: string | null;
  owner_name: string | null;
  owner_email: string | null;
  registration_number: string | null;
  tax_id: string | null;
  license_number: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  business_address: string | null;
  website: string | null;
  access_status: AccessStatus;
  grandfathered: boolean;
  rejection_reason: string | null;
  team_size: number;
  submitted_at: string | null;
  reviewed_at: string | null;
}

export type ReviewDecision = 'approve' | 'reject' | 'suspend' | 'reinstate';

export const adminBusinessService = {
  async list(): Promise<{ rows: AdminBusinessRow[]; error: string | null }> {
    const { data, error } = await supabase.rpc('mbg_admin_list_business_registrations');
    if (error) {
      return { rows: [], error: isRpcMissing(error) ? 'not_installed' : error.message };
    }
    return { rows: (data || []) as AdminBusinessRow[], error: null };
  },

  async review(businessProfileId: string, decision: ReviewDecision, reason?: string): Promise<string | null> {
    const { data, error } = await supabase.rpc('mbg_admin_review_business', {
      p_business_profile_id: businessProfileId,
      p_decision: decision,
      p_reason: reason?.trim() || null,
    });
    if (error) return error.message;
    if (!data?.success) return data?.error || 'Review failed';
    return null;
  },
};
