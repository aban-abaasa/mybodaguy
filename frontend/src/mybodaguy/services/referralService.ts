/**
 * BodaGoEra Referrals — ported from Supermarkera's referralService.js.
 *
 * Same shape (a ?ref=CODE link is remembered, then redeemed once the visitor is
 * signed in) but the rules are enforced on the server, because the reward here
 * is real ICAN: the referrer earns a % of their friend's FIRST DEPOSIT (default
 * 5%, adjustable from the ICAN developer panel's Referrals tab, which manages
 * referrals for both apps). Backed by ICAN/backend/ADD_REFERRAL_SYSTEM.sql —
 * the browser never writes to a referral table, it only calls these RPCs.
 */

import { supabase } from '../../services/supabaseClient';

export const REFERRAL_SOURCE_APP = 'mybodaguy';
const PENDING_REF_KEY = 'mbg_pending_referral_code';
const PENDING_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type ReferralFriendState = 'joined' | 'pending' | 'paid' | 'rejected';

export interface ReferralFriend {
  first_name: string;
  state: ReferralFriendState;
  reward_ican: number | null;
  reward_ugx: number | null;
  created_at: string;
}

export interface ReferralStats {
  code: string | null;
  enabled: boolean;
  reward_percent: number;
  max_reward_ican: number | null;
  min_deposit_ican: number;
  live_price_ugx: number; // current UGX value of 1 ICAN
  friends_joined: number;
  friends_deposited: number;
  earned_ican: number;
  pending_ican: number;
  earned_ugx: number; // what the paid rewards were worth when earned (live price at deposit time)
  pending_ugx: number;
  friends: ReferralFriend[];
}

// Called once at app start (main.tsx): any page can be the landing page of a
// shared link, so this runs before React mounts. Best-effort — never throws.
export function captureReferralFromUrl(): void {
  try {
    const ref = new URLSearchParams(window.location.search).get('ref');
    if (!ref) return;
    const code = ref.trim().toUpperCase();
    if (!code) return;
    localStorage.setItem(PENDING_REF_KEY, JSON.stringify({ code, savedAt: Date.now() }));
  } catch {
    // Storage unavailable (private mode, etc.) — referral capture is best-effort.
  }
}

// Stores a code typed by hand on the sign-in / sign-up page — same slot a ?ref=
// link fills, so the redeem step after sign-in needs no special case.
export function savePendingReferralCode(code: string): void {
  try {
    const clean = String(code || '').trim().toUpperCase();
    if (!clean) return;
    localStorage.setItem(PENDING_REF_KEY, JSON.stringify({ code: clean, savedAt: Date.now() }));
  } catch {
    // Storage unavailable — best-effort.
  }
}

export function getPendingReferralCode(): string | null {
  return readPending()?.code ?? null;
}

export function clearPendingReferralCode(): void {
  clearPending();
}

function readPending(): { code: string; savedAt: number } | null {
  try {
    const raw = localStorage.getItem(PENDING_REF_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed?.code ? parsed : null;
  } catch {
    return null;
  }
}

function clearPending(): void {
  try { localStorage.removeItem(PENDING_REF_KEY); } catch { /* ignore */ }
}

// Redeem reasons worth retrying later; every other reason is final, so the
// stored code is dropped instead of re-tried on every dashboard load.
const KEEP_PENDING_REASONS = new Set(['not_signed_in', 'paused']);

const REASON_MESSAGE: Record<string, string> = {
  invalid_code: 'That referral code is not valid.',
  wrong_app: 'That referral code belongs to a different app.',
  own_code: "You can't use your own referral code.",
  already_referred: 'A referral code was already applied to your account.',
  already_deposited: 'Referral codes only apply before your first ICAN deposit.',
  circular: "That person joined through your code, so it can't be used the other way round.",
};

export interface ConsumeResult {
  applied: boolean;
  referrerName?: string;
  message?: string;
}

// Applies a stored code to the signed-in user. Safe on every dashboard load:
// a no-op when nothing is pending or the code has expired. Only a genuine
// server-side refusal produces a `message` worth showing the person.
export async function consumePendingReferralCode(): Promise<ConsumeResult> {
  const pending = readPending();
  if (!pending) return { applied: false };

  if (Date.now() - (pending.savedAt || 0) > PENDING_TTL_MS) {
    clearPending();
    return { applied: false };
  }

  const { data, error } = await supabase.rpc('ican_referral_redeem_code', {
    p_code: pending.code,
    p_source_app: REFERRAL_SOURCE_APP,
  });
  if (error) throw error; // transient (network etc.) — keep the code pending

  if (data?.success) {
    clearPending();
    return { applied: true, referrerName: data.referrer_name || 'your friend' };
  }

  const reason: string = data?.reason ?? 'unknown';
  if (!KEEP_PENDING_REASONS.has(reason)) clearPending();
  // 'already_referred' after a page-reload race is not worth nagging about.
  const silent = KEEP_PENDING_REASONS.has(reason) || reason === 'already_referred';
  return { applied: false, message: silent ? undefined : REASON_MESSAGE[reason] };
}

// The caller's code (created on first use) plus everything the card shows.
export async function loadReferralStats(): Promise<ReferralStats> {
  const codeRes = await supabase.rpc('ican_referral_get_or_create_code', { p_source_app: REFERRAL_SOURCE_APP });
  if (codeRes.error) throw codeRes.error;
  if (!codeRes.data?.success) throw new Error(codeRes.data?.reason ?? 'Could not load your referral code');

  const { data, error } = await supabase.rpc('ican_referral_my_stats', { p_source_app: REFERRAL_SOURCE_APP });
  if (error) throw error;
  if (!data?.success) throw new Error(data?.reason ?? 'Could not load referral stats');

  return {
    code: data.code ?? codeRes.data.code,
    enabled: !!data.enabled,
    reward_percent: Number(data.reward_percent ?? 0),
    max_reward_ican: data.max_reward_ican == null ? null : Number(data.max_reward_ican),
    min_deposit_ican: Number(data.min_deposit_ican ?? 0),
    live_price_ugx: Number(data.live_price_ugx ?? 0),
    friends_joined: Number(data.friends_joined ?? 0),
    friends_deposited: Number(data.friends_deposited ?? 0),
    earned_ican: Number(data.earned_ican ?? 0),
    pending_ican: Number(data.pending_ican ?? 0),
    earned_ugx: Number(data.earned_ugx ?? 0),
    pending_ugx: Number(data.pending_ugx ?? 0),
    friends: (data.friends ?? []) as ReferralFriend[],
  };
}

// Signed-out typo check for the sign-in / sign-up "Have a referral code?" field.
// Answers only valid / not valid (never who owns it); redemption itself still
// happens after sign-in. Throws on a network error so the caller can keep the
// code and let the server re-check it later.
export async function checkReferralCode(code: string): Promise<{ valid: boolean; paused?: boolean; reason?: string }> {
  const { data, error } = await supabase.rpc('ican_referral_check_code', {
    p_code: code,
    p_source_app: REFERRAL_SOURCE_APP,
  });
  if (error) throw error;
  return (data ?? { valid: false, reason: 'invalid_code' }) as { valid: boolean; paused?: boolean; reason?: string };
}

export function buildReferralLink(code: string): string {
  return `${window.location.origin}/?ref=${encodeURIComponent(code)}`;
}
