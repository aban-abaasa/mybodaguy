/**
 * ICAN Wallet Service — My Boda Guy (TypeScript)
 * 1 ICAN = 5,000 UGX floor price.
 * All rider/driver earnings auto-deduct 10% tithe via DB stored function.
 */

import { supabase } from '../../services/supabaseClient';

export const ICAN_TO_UGX = 5000;
export const SOURCE_APP = 'mybodaguy';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ICANWallet {
  id: string;
  user_id: string;
  wallet_address: string;
  ican_balance: number;
  total_earned: number;
  total_spent: number;
  total_tithe_paid: number;
  status: 'active' | 'suspended' | 'frozen';
  created_at: string;
  updated_at: string;
}

export interface ICANBalance {
  ican: number;
  ugx: number;
  address: string | null;
  totalEarned: number;
  totalSpent: number;
  totalTithe: number;
}

export interface ICANTransaction {
  id: string;
  sender_user_id: string | null;
  recipient_user_id: string | null;
  ican_amount: number;
  ugx_equivalent: number;
  transaction_type: 'earn' | 'transfer_in' | 'transfer_out' | 'tithe' | 'purchase' | 'sale' | 'cashback' | 'refund';
  source_app: string;
  reference_id: string | null;
  note: string | null;
  status: 'pending' | 'completed' | 'failed' | 'reversed';
  created_at: string;
  direction: 'in' | 'out';
}

export interface EarnResult {
  success: boolean;
  tx_id: string;
  gross_earned: number;
  tithe_deducted: number;
  net_credited: number;
}

export interface TransferResult {
  success: boolean;
  tx_id: string;
  amount_sent: number;
  tithe_deducted: number;
  recipient_received: number;
}

export interface BuyResult {
  success: boolean;
  tx_id: string;
  ican_bought: number;
  ugx_paid: number;
}

export interface SellResult {
  success: boolean;
  tx_id: string;
  ican_sold: number;
  ugx_payout: number;
}

// ─── Wallet ───────────────────────────────────────────────────────────────────

export async function getOrCreateWallet(userId: string): Promise<ICANWallet> {
  const { data, error } = await supabase.rpc('get_or_create_ican_wallet', {
    p_user_id: userId,
  });
  if (error) throw error;
  return data as ICANWallet;
}

export async function getWallet(userId: string): Promise<ICANWallet | null> {
  const { data, error } = await supabase
    .from('ican_user_wallets')
    .select('*')
    .eq('user_id', userId)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data as ICANWallet | null;
}

export async function getBalance(userId: string): Promise<ICANBalance> {
  const wallet = await getWallet(userId);
  return {
    ican: wallet?.ican_balance ?? 0,
    ugx: (wallet?.ican_balance ?? 0) * ICAN_TO_UGX,
    address: wallet?.wallet_address ?? null,
    totalEarned: wallet?.total_earned ?? 0,
    totalSpent: wallet?.total_spent ?? 0,
    totalTithe: wallet?.total_tithe_paid ?? 0,
  };
}

// ─── Transactions ─────────────────────────────────────────────────────────────

export async function getTransactions(userId: string, limit = 50): Promise<ICANTransaction[]> {
  const { data, error } = await supabase
    .from('ican_coin_transactions')
    .select('*')
    .or(`sender_user_id.eq.${userId},recipient_user_id.eq.${userId}`)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((tx: any) => ({
    ...tx,
    direction: tx.recipient_user_id === userId ? 'in' : 'out',
  })) as ICANTransaction[];
}

// ─── Earnings ─────────────────────────────────────────────────────────────────

/**
 * Credit ICAN to a rider when a delivery is completed.
 * Minimum payout floor: 5,000 UGX = 1 ICAN.
 * DB auto-deducts 10% tithe from gross.
 */
/**
 * Called when a rider completes a delivery.
 * Uses mbg_credit_rider_delivery which enforces:
 *  - target must be rider or chairperson in mbg_users
 *  - 5,000 UGX floor price
 *  - 10% tithe auto-deducted
 */
export async function earnFromDelivery({
  riderId,
  ugxFareAmount,
  deliveryId,
}: {
  riderId: string;
  ugxFareAmount: number;
  deliveryId: string;
  riderName?: string;
}): Promise<EarnResult> {
  const { data, error } = await supabase.rpc('mbg_credit_rider_delivery', {
    p_rider_user_id: riderId,
    p_ugx_fare: ugxFareAmount,
    p_delivery_id: deliveryId,
  });
  if (error) throw error;
  if (!data.success) throw new Error(data.error ?? 'Earning credit failed');
  return data as EarnResult;
}

/**
 * Credit ICAN to a chairperson from their group's delivery volume.
 */
/**
 * Developer credits a chairperson's group bonus.
 * Uses mbg_credit_chairperson_bonus which enforces:
 *  - caller must be developer in mbg_users
 *  - target must be in committee_members
 */
export async function earnChairpersonBonus({
  chairpersonId,
  ugxBonusAmount,
  periodId,
}: {
  chairpersonId: string;
  ugxBonusAmount: number;
  periodId: string;
}): Promise<EarnResult> {
  const { data, error } = await supabase.rpc('mbg_credit_chairperson_bonus', {
    p_chairperson_user_id: chairpersonId,
    p_ugx_bonus: ugxBonusAmount,
    p_period_ref: periodId,
  });
  if (error) throw error;
  if (!data.success) throw new Error(data.error ?? 'Bonus credit failed');
  return data as EarnResult;
}

// ─── Transfer ─────────────────────────────────────────────────────────────────

export async function sendICAN({
  fromUserId,
  toUserId,
  amount,
  note = '',
  referenceId = null,
}: {
  fromUserId: string;
  toUserId: string;
  amount: number;
  note?: string;
  referenceId?: string | null;
}): Promise<TransferResult> {
  const { data, error } = await supabase.rpc('transfer_ican', {
    p_from_user: fromUserId,
    p_to_user: toUserId,
    p_amount: amount,
    p_note: note,
    p_source_app: SOURCE_APP,
    p_reference_id: referenceId,
  });
  if (error) throw error;
  if (!data.success) throw new Error(data.error);
  return data as TransferResult;
}

// ─── Buy / Sell ───────────────────────────────────────────────────────────────

/**
 * Buy ICAN coins — user pays UGX (notional), ICAN is credited to their wallet.
 * 1 ICAN = 5,000 UGX floor price. No tithe on purchases.
 */
export async function buyICAN({
  userId,
  icanAmount,
  paymentRef = null,
}: {
  userId: string;
  icanAmount: number;
  paymentRef?: string | null;
}): Promise<BuyResult> {
  const { data, error } = await supabase.rpc('buy_ican_coins', {
    p_user_id: userId,
    p_ican_amount: icanAmount,
    p_source_app: SOURCE_APP,
    p_payment_ref: paymentRef,
  });
  if (error) throw error;
  if (!data.success) throw new Error(data.error ?? 'Buy failed');
  return data as BuyResult;
}

/**
 * Sell ICAN coins — ICAN is debited, UGX payout is handled offline by cashier/admin.
 */
export async function sellICAN({
  userId,
  icanAmount,
  reference = null,
}: {
  userId: string;
  icanAmount: number;
  reference?: string | null;
}): Promise<SellResult> {
  const { data, error } = await supabase.rpc('sell_ican_coins', {
    p_user_id: userId,
    p_ican_amount: icanAmount,
    p_source_app: SOURCE_APP,
    p_reference: reference,
  });
  if (error) throw error;
  if (!data.success) throw new Error(data.error ?? 'Sell failed');
  return data as SellResult;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function ugxToICAN(ugx: number): number {
  return Math.floor((ugx / ICAN_TO_UGX) * 1e8) / 1e8;
}

export function icanToUGX(ican: number): number {
  return ican * ICAN_TO_UGX;
}

export function formatICAN(amount: number): string {
  return Number(amount).toFixed(4);
}
