import { supabase } from './supabaseClient';

// Rider ID cards — see backend/database/ADD_RIDER_ID_CARDS.sql.
// The district chairperson issues a card, the rider pays the fee from their own
// ICAN wallet (shared equally across their stage / parish / subcounty / division /
// district chairpersons), and the card's QR opens the public /rider-card/<code> page.

// Same canonical origin the other QR codes (receipts, tickets) point at, so a
// printed card keeps working whichever deployment issued it.
const RIDER_CARD_BASE_URL = 'https://bodagoera.icanera.space';

export const riderCardVerifyUrl = (code: string) => `${RIDER_CARD_BASE_URL}/rider-card/${code}`;

// Used only until the fee has loaded; the real number is rider_card.fee_ican.
export const DEFAULT_RIDER_CARD_FEE_ICAN = 2;

export type RiderCardStatus = 'pending_payment' | 'active' | 'revoked';

// Driving-permit status, worked out from the licence expiry on the rider's record.
export type PermitStatus = 'valid' | 'expiring_soon' | 'expired' | 'not_recorded';

// 'pending' while the card fee is unpaid or ride commission is still owed.
export type FeesStatus = 'paid' | 'pending';

export interface RiderCard {
  card_id: string;
  card_number: string;
  verify_code: string;
  status: RiderCardStatus;
  fee_ican: number;
  issued_at: string;
  paid_at: string | null;
  rider_id: string;
  full_name: string;
  avatar_url: string | null;
  vehicle_type: string;
  plate_number: string;
  vehicle_model: string | null;
  vehicle_color: string | null;
  rider_status: string;
  rating: number | null;
  completed_rides: number | null;
  member_since: string;
  stage: string | null;
  parish: string | null;
  subcounty: string | null;
  division: string | null;
  district: string | null;
  // Information that differs per division and per stage.
  division_code: string | null;
  division_contact_name: string | null;
  division_contact_phone: string | null;
  division_notes: string | null;
  stage_code: string | null;
  stage_contact_name: string | null;
  stage_contact_phone: string | null;
  stage_notes: string | null;
  accent_color: string | null;
  // Driving permit (the number is masked)
  license_masked: string | null;
  license_expiry: string | null;
  permit_status: PermitStatus;
  permit_days_left: number | null;
  // Fees to the chairpersons
  card_fee_status: 'paid' | 'pending' | 'cancelled';
  commission_owed_ugx: number;
  fees_status: FeesStatus;
}

// One row of the district chairperson's list: a rider and their live card, if any.
export interface DistrictRiderRow {
  rider_id: string;
  full_name: string;
  avatar_url: string | null;
  vehicle_type: string;
  plate_number: string;
  rider_status: string;
  stage: string | null;
  parish: string | null;
  subcounty: string | null;
  division: string | null;
  district: string | null;
  // Chairperson-only: the full permit number, so it can be corrected.
  license_number: string | null;
  license_expiry: string | null;
  permit_status: PermitStatus;
  permit_days_left: number | null;
  card: RiderCard | null;
}

export interface CardRegionInfo {
  region_id: string;
  name: string;
  code: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  notes: string | null;
  accent_color: string | null;
}

export interface CardStageInfo extends CardRegionInfo {
  parish: string | null;
  division: string | null;
}

export interface CardRegionInfoSet {
  divisions: CardRegionInfo[];
  stages: CardStageInfo[];
}

export type CardRegionInfoFields = Pick<CardRegionInfo, 'code' | 'contact_name' | 'contact_phone' | 'notes' | 'accent_color'>;

// What the public QR page gets back — public-safe fields only.
export interface RiderCardProof {
  is_valid: boolean;
  state?: 'valid' | 'unpaid' | 'suspended' | 'cancelled';
  card_number?: string;
  full_name?: string;
  avatar_url?: string | null;
  vehicle_type?: string;
  vehicle_model?: string | null;
  vehicle_color?: string | null;
  plate_number?: string;
  rating?: number | null;
  completed_rides?: number | null;
  member_since?: string;
  issued_at?: string;
  stage?: string | null;
  parish?: string | null;
  subcounty?: string | null;
  division?: string | null;
  district?: string | null;
  division_code?: string | null;
  division_contact_name?: string | null;
  division_contact_phone?: string | null;
  division_notes?: string | null;
  stage_code?: string | null;
  stage_contact_name?: string | null;
  stage_contact_phone?: string | null;
  stage_notes?: string | null;
  accent_color?: string | null;
  license_masked?: string | null;
  license_expiry?: string | null;
  permit_status?: PermitStatus;
  permit_days_left?: number | null;
  fees?: {
    status: FeesStatus;
    card_fee_ican: number;
    card_fee_status: 'paid' | 'pending' | 'cancelled';
    card_fee_paid_at: string | null;
    commission_owed_ugx: number;
  };
}

export interface CardResult {
  success: boolean;
  error?: string;
  card?: RiderCard;
  alreadyPaid?: boolean;
}

// A hex colour is the only thing from the database that ends up in a style
// attribute, so anything else falls back to the default gold.
export const safeAccent = (color?: string | null, fallback = '#c4a052') =>
  color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : fallback;

// How each permit status reads and looks, shared by the card, the chairperson's
// list and the public QR page so they can never disagree.
export const PERMIT_META: Record<PermitStatus, { label: string; tone: 'ok' | 'warn' | 'bad' | 'muted' }> = {
  valid: { label: 'Valid', tone: 'ok' },
  expiring_soon: { label: 'Expiring soon', tone: 'warn' },
  expired: { label: 'Expired', tone: 'bad' },
  not_recorded: { label: 'Not recorded', tone: 'muted' },
};

export const permitDetail = (status: PermitStatus, expiry?: string | null, daysLeft?: number | null) => {
  if (!expiry) return 'No expiry date on file';
  const when = new Date(`${expiry}T00:00:00`).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
  if (status === 'expired') return `Expired ${when}`;
  if (status === 'expiring_soon') {
    return daysLeft === 0 ? `Expires today (${when})` : `Expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'} (${when})`;
  }
  return `Valid until ${when}`;
};

export const formatUgx = (n: number) => `UGX ${Math.round(n).toLocaleString('en-UG')}`;

const errorMessage = (e: unknown, fallback: string) =>
  e instanceof Error && e.message ? e.message : fallback;

async function callCardRpc(fn: string, args: Record<string, unknown>, fallback: string): Promise<CardResult> {
  try {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) return { success: false, error: error.message };
    if (!data || typeof data !== 'object') return { success: false, error: 'Unexpected response' };
    const res = data as { success?: boolean; error?: string; card?: RiderCard; already_paid?: boolean };
    if (!res.success) return { success: false, error: res.error || fallback };
    return { success: true, card: res.card, alreadyPaid: !!res.already_paid };
  } catch (e) {
    return { success: false, error: errorMessage(e, fallback) };
  }
}

export const riderCardService = {
  async getFee(): Promise<number> {
    const { data, error } = await supabase.rpc('mbg_get_rider_card_fee');
    const fee = Number(data);
    if (error || !Number.isFinite(fee) || fee <= 0) return DEFAULT_RIDER_CARD_FEE_ICAN;
    return fee;
  },

  // District chairperson: every rider in their district(s) with the state of their card.
  async getDistrictRiders(): Promise<{ rows: DistrictRiderRow[]; error?: string }> {
    const { data, error } = await supabase.rpc('mbg_get_district_riders_for_cards');
    if (error) return { rows: [], error: error.message };
    return { rows: (data as DistrictRiderRow[] | null) ?? [] };
  },

  issueCard(riderId: string): Promise<CardResult> {
    return callCardRpc('mbg_issue_rider_card', { p_rider_id: riderId }, 'Could not issue the card');
  },

  cancelCard(cardId: string): Promise<CardResult> {
    return callCardRpc('mbg_cancel_rider_card', { p_card_id: cardId }, 'Could not cancel the card');
  },

  // District chairperson: the division / stage information printed on riders' cards.
  async getRegionInfo(): Promise<{ info: CardRegionInfoSet; error?: string }> {
    const empty: CardRegionInfoSet = { divisions: [], stages: [] };
    const { data, error } = await supabase.rpc('mbg_get_card_region_info');
    if (error) return { info: empty, error: error.message };
    const info = data as Partial<CardRegionInfoSet> | null;
    return { info: { divisions: info?.divisions ?? [], stages: info?.stages ?? [] } };
  },

  async setRegionInfo(
    regionType: 'division' | 'stage',
    regionId: string,
    fields: CardRegionInfoFields
  ): Promise<{ success: boolean; error?: string }> {
    const { data, error } = await supabase.rpc('mbg_set_card_region_info', {
      p_region_type: regionType,
      p_region_id: regionId,
      p_code: fields.code,
      p_contact_name: fields.contact_name,
      p_contact_phone: fields.contact_phone,
      p_notes: fields.notes,
      p_accent_color: fields.accent_color,
    });
    if (error) return { success: false, error: error.message };
    const res = data as { success?: boolean; error?: string } | null;
    return res?.success ? { success: true } : { success: false, error: res?.error || 'Could not save' };
  },

  // District chairperson: record a rider's driving permit. A blank number keeps
  // the one on file; a blank expiry makes the permit "not recorded".
  async setRiderPermit(
    riderId: string,
    licenseNumber: string,
    licenseExpiry: string
  ): Promise<{ success: boolean; error?: string; permitStatus?: PermitStatus }> {
    const { data, error } = await supabase.rpc('mbg_set_rider_permit', {
      p_rider_id: riderId,
      p_license_number: licenseNumber.trim() || null,
      p_license_expiry: licenseExpiry || null,
    });
    if (error) return { success: false, error: error.message };
    const res = data as { success?: boolean; error?: string; permit_status?: PermitStatus } | null;
    return res?.success
      ? { success: true, permitStatus: res.permit_status }
      : { success: false, error: res?.error || 'Could not save the permit' };
  },

  // Rider: my own live cards (unpaid or active).
  async getMyCards(): Promise<{ cards: RiderCard[]; error?: string }> {
    const { data, error } = await supabase.rpc('mbg_get_my_rider_cards');
    if (error) return { cards: [], error: error.message };
    return { cards: (data as RiderCard[] | null) ?? [] };
  },

  payCard(cardId: string): Promise<CardResult> {
    return callCardRpc('mbg_pay_rider_card', { p_card_id: cardId }, 'Payment failed');
  },

  // Public: what the QR page shows.
  async verifyCard(code: string): Promise<{ proof: RiderCardProof | null; error?: string }> {
    const { data, error } = await supabase.rpc('mbg_verify_rider_card', { p_code: code });
    if (error) return { proof: null, error: error.message };
    return { proof: (data as RiderCardProof | null) ?? { is_valid: false } };
  },
};
