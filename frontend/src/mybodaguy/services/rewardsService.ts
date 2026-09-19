/**
 * BodaGoEra Rewards — points earned from rides/deliveries, redeemable for
 * ICAN coins or physical items (helmet, jacket, reflectors, home goods).
 * Separate ledger from the ICAN coin wallet (icanWalletService.ts) — see
 * ADD_REWARD_POINTS_LOYALTY_SYSTEM.sql for the schema and conversion rate.
 */

import { supabase } from '../../services/supabaseClient';

export const POINTS_PER_ICAN = 100;

export type RewardTier = 'bronze' | 'silver' | 'gold' | 'platinum';

export interface RewardSummary {
  points_balance: number;
  lifetime_points: number;
  tier: RewardTier;
  next_tier: RewardTier | null;
  next_threshold: number | null;
  progress_pct: number;
}

export interface RewardCatalogItem {
  id: string;
  category: 'safety_gear' | 'home';
  name: string;
  description: string | null;
  emoji: string;
  points_cost: number;
  role_scope: 'customer' | 'rider' | 'both';
  stock_qty: number | null;
  active: boolean;
  sort_order: number;
}

export interface RewardTransaction {
  id: string;
  points: number;
  direction: 'earn' | 'redeem';
  source: string;
  reference_id: string | null;
  note: string | null;
  created_at: string;
}

export interface RewardRedemption {
  id: string;
  catalog_item_id: string | null;
  item_name: string;
  points_spent: number;
  delivery_address: string | null;
  phone: string | null;
  status: 'pending' | 'processing' | 'shipped' | 'fulfilled' | 'cancelled';
  admin_notes: string | null;
  created_at: string;
  updated_at: string;
}

export async function getRewardSummary(userId: string): Promise<RewardSummary> {
  const { data, error } = await supabase.rpc('mbg_get_reward_summary', { p_user_id: userId });
  if (error) throw error;
  return data as RewardSummary;
}

export async function getRewardCatalog(): Promise<RewardCatalogItem[]> {
  const { data, error } = await supabase
    .from('mbg_reward_catalog')
    .select('*')
    .eq('active', true)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return (data ?? []) as RewardCatalogItem[];
}

export async function getRewardTransactions(userId: string, limit = 20): Promise<RewardTransaction[]> {
  const { data, error } = await supabase
    .from('mbg_reward_transactions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as RewardTransaction[];
}

export async function getMyRedemptions(userId: string, limit = 20): Promise<RewardRedemption[]> {
  const { data, error } = await supabase
    .from('mbg_reward_redemptions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as RewardRedemption[];
}

export interface RedeemCoinsResult {
  success: boolean;
  points_spent: number;
  ican_credited: number;
  redemption_id: string;
}

export async function redeemPointsForCoins(userId: string, points: number): Promise<RedeemCoinsResult> {
  const { data, error } = await supabase.rpc('mbg_redeem_points_for_coins', {
    p_user_id: userId,
    p_points: points,
  });
  if (error) throw error;
  if (!data?.success) throw new Error(data?.error ?? 'Redemption failed');
  return data as RedeemCoinsResult;
}

export interface RedeemItemResult {
  success: boolean;
  redemption_id: string;
  item_name: string;
  points_spent: number;
}

export async function redeemPointsForItem({
  userId,
  catalogItemId,
  deliveryAddress,
  phone,
}: {
  userId: string;
  catalogItemId: string;
  deliveryAddress: string;
  phone: string;
}): Promise<RedeemItemResult> {
  const { data, error } = await supabase.rpc('mbg_redeem_points_for_item', {
    p_user_id: userId,
    p_catalog_item_id: catalogItemId,
    p_delivery_address: deliveryAddress,
    p_phone: phone,
  });
  if (error) throw error;
  if (!data?.success) throw new Error(data?.error ?? 'Redemption failed');
  return data as RedeemItemResult;
}

export interface AdjustPointsResult {
  success: boolean;
  points_balance: number;
  [key: string]: any;
}

// Developer-only manual grant/deduction — see mbg_admin_adjust_reward_points
// in ADD_REWARD_POINTS_ADMIN_ADJUSTMENT.sql. Positive delta grants (and counts
// toward lifetime_points/tier like any other earn); negative delta deducts
// from the balance only. The RPC itself checks for the developer role and
// rejects everyone else — this just surfaces its jsonb error as a thrown one.
export async function adjustRewardPoints(userId: string, pointsDelta: number, note?: string): Promise<AdjustPointsResult> {
  const { data, error } = await supabase.rpc('mbg_admin_adjust_reward_points', {
    p_user_id: userId,
    p_points_delta: pointsDelta,
    p_note: note || null,
  });
  if (error) throw error;
  if (!data?.success) throw new Error(data?.error ?? 'Adjustment failed');
  return data as AdjustPointsResult;
}

export function pointsToICAN(points: number): number {
  return Math.floor((points / POINTS_PER_ICAN) * 1e8) / 1e8;
}

export const TIER_META: Record<RewardTier, { label: string; emoji: string; color: string }> = {
  bronze:   { label: 'Bronze',   emoji: '🥉', color: 'from-amber-600 to-amber-800' },
  silver:   { label: 'Silver',   emoji: '🥈', color: 'from-slate-400 to-slate-600' },
  gold:     { label: 'Gold',     emoji: '🥇', color: 'from-yellow-400 to-yellow-600' },
  platinum: { label: 'Platinum', emoji: '💎', color: 'from-cyan-400 to-indigo-600' },
};
