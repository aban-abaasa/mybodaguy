import { supabase } from './supabaseClient';

// IcanEra Cover — insurance. The database side is ICAN/backend/ADD_INSURANCE_PLATFORM.sql
// (shared by ICANera and BodaGoEra) and mybodaguy/backend/database/ADD_INSURANCE_ON_RIDER_CARD.sql.
// Prices are in ICAN (currency stability); the screens show them in the user's own currency
// at the live ICAN price. The price a customer sees is the whole price: no fee line, ever.

export type CoverType =
  | 'accident' | 'third_party' | 'comprehensive' | 'medical' | 'life'
  | 'goods_in_transit' | 'property' | 'liability' | 'fleet';

export const COVER_TYPE_META: Record<CoverType, { label: string; blurb: string }> = {
  accident:         { label: 'Accident',         blurb: 'Injury or death from an accident' },
  third_party:      { label: 'Third-party',      blurb: 'Harm you cause to others, the legal minimum for a vehicle' },
  comprehensive:    { label: 'Comprehensive',    blurb: 'Your vehicle and third parties' },
  medical:          { label: 'Medical',          blurb: 'Hospital and treatment costs' },
  life:             { label: 'Life',             blurb: 'A payout to your family' },
  goods_in_transit: { label: 'Goods in transit', blurb: 'Parcels and cargo you carry' },
  property:         { label: 'Property',         blurb: 'Stock, premises and equipment' },
  liability:        { label: 'Liability',        blurb: 'Claims against your business' },
  fleet:            { label: 'Fleet',            blurb: 'All your vehicles under one policy' },
};

export const coverTypeLabel = (type: string) =>
  COVER_TYPE_META[type as CoverType]?.label ?? type.replace(/_/g, ' ');

export type PolicyState = 'active' | 'grace' | 'waiting' | 'expired' | 'cancelled';
export type Tone = 'ok' | 'warn' | 'bad' | 'muted';

export const POLICY_STATE_META: Record<PolicyState, { label: string; tone: Tone }> = {
  active:    { label: 'Active',       tone: 'ok' },
  grace:     { label: 'Renew now',    tone: 'warn' },
  waiting:   { label: 'Starts soon',  tone: 'warn' },
  expired:   { label: 'Expired',      tone: 'bad' },
  cancelled: { label: 'Cancelled',    tone: 'muted' },
};

export type ShareScope = 'identity' | 'activity' | 'compliance' | 'finances';
export type BusinessShareScope = 'business_activity' | 'business_finances';
export type RenewWith = 'wallet' | 'points_first' | 'points_only';

export const SHARE_SCOPES: { id: ShareScope; label: string; help: string }[] = [
  { id: 'identity',   label: 'Who I am',          help: 'Your email and your vehicle details (plate, model). Your licence number stays hidden.' },
  { id: 'activity',   label: 'My ride record',    help: 'How many rides you finish and cancel, your rating, how long you have ridden.' },
  { id: 'compliance', label: 'My standing',       help: 'Driving permit status, ID card and any commission you owe.' },
  { id: 'finances',   label: 'My money, monthly', help: 'Monthly totals of ICAN in and out for six months. Never individual transactions.' },
];

export const BUSINESS_SHARE_SCOPES: { id: BusinessShareScope; label: string; help: string }[] = [
  { id: 'business_activity', label: 'Fleet activity',     help: 'How many drivers you have and the rides they finish and cancel.' },
  { id: 'business_finances', label: 'Business wallet',    help: 'Monthly totals of ICAN in and out of the business wallet. Never individual transactions.' },
];

// Renewing opens in the last half of a period (30 days at most), the same rule the database enforces,
// so a double tap or an over-eager renewal can never charge twice for cover that is already paid for.
export const renewWindowDays = (periodDays: number) => Math.min(periodDays / 2, 30);

export const periodLabel = (days: number) =>
  days === 7 ? 'week' : days === 30 ? 'month' : days === 90 ? '3 months' : days === 365 ? 'year' : `${days} days`;

// ── Shapes ───────────────────────────────────────────────────────────────

export interface PlanInsurer {
  insurer_id: string;
  name: string;
  regulator: string;
  licence_number: string;
  licence_expiry: string;
  country: string;
  claims_phone: string | null;
}

export interface CoverPlan {
  plan_id: string;
  name: string;
  summary: string | null;
  benefits: string[];
  cover_type: CoverType;
  audience: ('person' | 'rider' | 'business')[];
  vehicle_types: string[] | null;
  period_days: number;
  price_ican: number;
  price_with_data_ican: number | null;
  data_discount_pct: number;
  data_discount_scopes: ShareScope[];
  group_price_ican: number | null;
  group_discount_pct: number;
  group_min_members: number;
  points_enabled: boolean;
  points_cost: number | null;
  cover_limit_ican: number;
  waiting_days: number;
  terms_url: string | null;
  insurer: PlanInsurer;
}

export interface MyPolicy {
  policy_id: string;
  policy_number: string;
  state: PolicyState;
  cover_type: CoverType;
  insured_kind: 'person' | 'rider' | 'business';
  insured_label: string | null;
  insured_name: string | null;
  payer_kind: 'user' | 'business';
  payer_name: string | null;
  payer_business_id: string | null;
  insured_business_id: string | null;
  insured_rider_id: string | null;
  group_size: number;
  started_at: string;
  cover_starts_at: string;
  ends_at: string;
  days_left: number;
  auto_renew: boolean;
  renew_with: RenewWith;
  last_renewal_error: string | null;
  renewal_price_ican: number;
  renewal_points_cost: number | null;
  data_discount_pct: number;
  plan: {
    plan_id: string; name: string; summary: string | null; period_days: number; cover_limit_ican: number;
    waiting_days: number; points_enabled: boolean; active: boolean; terms_url: string | null; benefits: string[];
    data_discount_pct: number; data_discount_scopes: ShareScope[];
  };
  insurer: { insurer_id: string; name: string; status: string; claims_phone: string | null; contact_phone: string | null; contact_email: string | null };
  holder_scopes: ShareScope[];
  business_scopes: BusinessShareScope[];
  unread_from_insurer: number;
  open_claims: number;
  role?: 'insured' | 'payer' | 'both';
}

export interface PolicyMessage {
  id: string;
  side: 'holder' | 'insurer' | 'system';
  body: string;
  created_at: string;
  claim_id: string | null;
  mine: boolean;
  sender_name: string;
}

export type ClaimStatus = 'submitted' | 'in_review' | 'info_needed' | 'approved' | 'rejected' | 'paid' | 'closed';

export const CLAIM_STATUS_META: Record<ClaimStatus, { label: string; tone: Tone }> = {
  submitted:   { label: 'Submitted',          tone: 'muted' },
  in_review:   { label: 'Under review',       tone: 'warn' },
  info_needed: { label: 'More info needed',   tone: 'warn' },
  approved:    { label: 'Approved',           tone: 'ok' },
  rejected:    { label: 'Rejected',           tone: 'bad' },
  paid:        { label: 'Paid',               tone: 'ok' },
  closed:      { label: 'Closed',             tone: 'muted' },
};

export interface PolicyClaim {
  claim_id: string;
  claim_number: string;
  policy_id: string;
  policy_number: string;
  plan: string;
  insurer: string;
  incident_date: string;
  description: string;
  amount_claimed_ican: number | null;
  evidence_urls: string[];
  status: ClaimStatus;
  insurer_note: string | null;
  approved_amount_ican: number | null;
  decided_at: string | null;
  paid_at: string | null;
  created_at: string;
}

export interface AccessLogEntry { at: string; insurer: string; scopes: string[] }

export interface PolicyPayment {
  at: string; kind: 'purchase' | 'renewal'; total_ican: number; points_used: number; period_start: string; period_end: string;
}

// What the live rider card (and the public QR page) shows.
export type CardInsuranceState = 'active' | 'grace' | 'waiting' | 'expired' | 'none' | 'unavailable';

export interface CardInsurancePolicy {
  state: PolicyState;
  insurer: string;
  plan: string;
  cover_type: CoverType;
  ref: string;
  valid_until: string;
}

export interface CardInsurance {
  state: CardInsuranceState;
  policies: CardInsurancePolicy[];
}

export const CARD_INSURANCE_META: Record<Exclude<CardInsuranceState, 'unavailable'>, { label: string; tone: Tone }> = {
  active:  { label: 'Insured',      tone: 'ok' },
  grace:   { label: 'Renew now',    tone: 'warn' },
  waiting: { label: 'Starts soon',  tone: 'warn' },
  expired: { label: 'Cover expired', tone: 'bad' },
  none:    { label: 'Not insured',  tone: 'muted' },
};

export interface DriverCover { rider_id: string; insurance: CardInsurance }

// ── Plumbing ─────────────────────────────────────────────────────────────

export type ActionResult = { success: boolean; error?: string; [key: string]: unknown };

// "The database function isn't there" — the insurance SQL has not been run for this project yet.
export const looksNotSetUp = (message?: string | null) =>
  !!message && /could not find the function|schema cache|does not exist|PGRST202|42883|not switched on yet/i.test(message);

// What the screens say (and still recognise through looksNotSetUp) when the SQL has not been run.
const NOT_SET_UP = 'Insurance is not switched on yet. Please try again later.';

async function read<T>(fn: string, args: Record<string, unknown> = {}): Promise<{ data: T | null; error?: string }> {
  try {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) return { data: null, error: looksNotSetUp(error.message) ? NOT_SET_UP : error.message };
    return { data: data as T };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : 'Something went wrong' };
  }
}

async function act(fn: string, args: Record<string, unknown>, fallback: string): Promise<ActionResult> {
  try {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) return { success: false, error: looksNotSetUp(error.message) ? NOT_SET_UP : error.message };
    const res = data as ActionResult | null;
    if (!res || typeof res !== 'object') return { success: false, error: 'Unexpected response' };
    return res.success ? res : { ...res, success: false, error: res.error || fallback };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : fallback };
  }
}

// The wallet's own wording is "Insufficient ICAN. Have: 0.45, Need: 2".
export const friendlyPayError = (message?: string) => {
  const m = message?.match(/Insufficient ICAN\. Have: ([\d.]+), Need: ([\d.]+)/i);
  if (!m) return message || 'Payment failed';
  const fmt = (n: number) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 4 });
  return `Not enough IcanEra in the wallet: it has ${fmt(Number(m[1]))}, this needs ${fmt(Number(m[2]))}.`;
};

export const formatIcan = (n: number | null | undefined) =>
  n == null ? '—' : Number(n).toLocaleString(undefined, { maximumFractionDigits: 4 });

export interface LocalRate { currency: string; priceLocal: number }

// The user's own currency at the LIVE ICAN price (their sign-up country), as the wallet shows it.
export async function getLocalRate(userId: string): Promise<LocalRate | null> {
  try {
    const { data, error } = await supabase.rpc('ican_get_user_wallet_display', { p_user_id: userId });
    const row = (data as { currency_code?: string; price_local?: number }[] | null)?.[0];
    if (error || !row || !(Number(row.price_local) > 0)) return null;
    return { currency: row.currency_code || 'UGX', priceLocal: Number(row.price_local) };
  } catch {
    return null;
  }
}

export const formatLocal = (ican: number | null | undefined, rate: LocalRate | null) =>
  ican == null || !rate
    ? ''
    : `≈ ${rate.currency} ${Math.round(Number(ican) * rate.priceLocal).toLocaleString()}`;

// ── The service ──────────────────────────────────────────────────────────

export const insuranceService = {
  listPlans(audience: 'person' | 'rider' | 'business', vehicleType?: string | null, coverType?: string | null) {
    return read<CoverPlan[]>('ins_list_plans', {
      p_audience: audience, p_cover_type: coverType ?? null, p_vehicle_type: vehicleType ?? null,
    });
  },

  quote(planId: string, members = 1, shareScopes: ShareScope[] = []) {
    return read<{ success: boolean; error?: string; per_member_ican: number; total_ican: number; members: number;
                  discount_pct: number; group_discount_applied: boolean; points_enabled: boolean; points_cost: number | null }>(
      'ins_quote', { p_plan_id: planId, p_members: members, p_share_scopes: shareScopes });
  },

  subscribePersonal(a: {
    planId: string; riderId?: string | null; usePoints?: boolean; pointsOnly?: boolean;
    shareScopes?: ShareScope[]; autoRenew?: boolean; renewWith?: RenewWith;
  }) {
    return act('ins_subscribe_personal', {
      p_plan_id: a.planId, p_rider_id: a.riderId ?? null, p_use_points: !!a.usePoints, p_points_only: !!a.pointsOnly,
      p_share_scopes: a.shareScopes ?? [], p_auto_renew: !!a.autoRenew, p_renew_with: a.renewWith ?? 'wallet',
    }, 'Could not buy this cover');
  },

  subscribeBusiness(a: { planId: string; businessId: string; kind: 'business' | 'rider'; riderIds?: string[]; pin: string }) {
    return act('ins_subscribe_business', {
      p_plan_id: a.planId, p_business_id: a.businessId, p_insured_kind: a.kind,
      p_rider_ids: a.kind === 'rider' ? a.riderIds ?? [] : null, p_pin: a.pin,
    }, 'Could not buy this cover');
  },

  myPolicies() {
    return read<MyPolicy[]>('ins_my_policies');
  },

  businessPolicies(businessId: string) {
    return read<MyPolicy[]>('ins_business_policies', { p_business_id: businessId });
  },

  driverCover(businessId: string) {
    return read<DriverCover[]>('mbg_business_driver_cover', { p_business_profile_id: businessId });
  },

  payments(policyId: string) {
    return read<PolicyPayment[]>('ins_policy_payments', { p_policy_id: policyId });
  },

  renew(policyId: string, o: { usePoints?: boolean; pointsOnly?: boolean; pin?: string } = {}) {
    return act('ins_renew_policy', {
      p_policy_id: policyId, p_use_points: !!o.usePoints, p_points_only: !!o.pointsOnly, p_pin: o.pin ?? null,
    }, 'Could not renew');
  },

  setAutoRenew(policyId: string, autoRenew: boolean, renewWith: RenewWith) {
    return act('ins_set_auto_renew', { p_policy_id: policyId, p_auto_renew: autoRenew, p_renew_with: renewWith }, 'Could not change renewal');
  },

  stopRenewing(policyId: string, reason?: string) {
    return act('ins_cancel_policy', { p_policy_id: policyId, p_reason: reason ?? null }, 'Could not stop renewal');
  },

  setConsent(policyId: string, scopes: ShareScope[]) {
    return act('ins_set_data_consent', { p_policy_id: policyId, p_scopes: scopes }, 'Could not save what you share');
  },

  setBusinessConsent(policyId: string, scopes: BusinessShareScope[]) {
    return act('ins_set_business_data_consent', { p_policy_id: policyId, p_scopes: scopes }, 'Could not save what the business shares');
  },

  accessLog(policyId: string) {
    return read<AccessLogEntry[]>('ins_policy_access_log', { p_policy_id: policyId });
  },

  messages(policyId: string) {
    return read<PolicyMessage[]>('ins_list_messages', { p_policy_id: policyId });
  },

  postMessage(policyId: string, body: string, claimId?: string | null) {
    return act('ins_post_message', { p_policy_id: policyId, p_body: body, p_claim_id: claimId ?? null }, 'Could not send');
  },

  fileClaim(a: { policyId: string; incidentDate: string; description: string; amount?: number | null; evidenceUrls?: string[] }) {
    return act('ins_file_claim', {
      p_policy_id: a.policyId, p_incident_date: a.incidentDate, p_description: a.description,
      p_amount_claimed_ican: a.amount ?? null, p_ride_id: null, p_evidence_urls: a.evidenceUrls ?? [],
    }, 'Could not file the claim');
  },

  myClaims(policyId?: string | null) {
    return read<PolicyClaim[]>('ins_my_claims', { p_policy_id: policyId ?? null });
  },
};
