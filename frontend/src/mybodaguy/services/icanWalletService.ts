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
  wallet_balance: number;
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

/**
 * The number people give each other to be paid: the 16-digit account number,
 * the same one the ICAN app shows. Digits only — the legacy "ICA-…" hex
 * wallet_address is kept as a last resort so Receive never disappears.
 */
async function getAccountNumber(userId: string): Promise<string | null> {
  const { data } = await supabase.from('user_accounts').select('account_number').eq('user_id', userId).maybeSingle();
  return (data as { account_number?: string } | null)?.account_number ?? null;
}

export async function getBalance(userId: string): Promise<ICANBalance> {
  const [wallet, accountNumber] = await Promise.all([getWallet(userId), getAccountNumber(userId)]);
  return {
    ican: wallet?.ican_balance ?? 0,
    ugx: (wallet?.ican_balance ?? 0) * ICAN_TO_UGX,
    address: accountNumber ?? wallet?.wallet_address ?? null,
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
  localAmount = null,
  localCurrency = 'UGX',
  merchantName = null,
  counterpartyType = null,
  expenseClassification = null,
  businessProfileId = null,
}: {
  fromUserId: string;
  toUserId: string;
  amount: number;
  note?: string;
  referenceId?: string | null;
  localAmount?: number | null;
  localCurrency?: string;
  merchantName?: string | null;
  counterpartyType?: string | null;
  expenseClassification?: string | null;
  businessProfileId?: string | null;
}): Promise<TransferResult> {
  const { data, error } = await supabase.rpc('transfer_ican', {
    p_from_user: fromUserId,
    p_to_user: toUserId,
    p_amount: amount,
    p_note: note,
    p_source_app: SOURCE_APP,
    p_reference_id: referenceId,
    p_local_amount: localAmount ?? Number(amount) * ICAN_TO_UGX,
    p_local_currency: localCurrency,
    p_merchant_name: merchantName,
    p_counterparty_type: counterpartyType,
    p_expense_classification: expenseClassification,
    p_business_profile_id: businessProfileId,
  });
  if (error) throw error;
  if (!data.success) throw new Error(data.error);
  return data as TransferResult;
}

// ─── Recipients (same rules as Send in the ICAN app) ──────────────────────────

export interface ResolvedRecipient {
  kind: 'user' | 'business';
  userId?: string;
  businessProfileId?: string;
  name: string;
  identifier: string;
}

/**
 * Finds who a typed recipient is. Numbers only, like ICAN: a 16-digit account
 * number, or a 16-digit business wallet number (starts with 3), or a phone
 * number; an email also works. Returns null when nobody matches.
 */
export async function resolveRecipient(input: string): Promise<ResolvedRecipient | null> {
  const value = input.trim();
  if (!value) return null;

  if (/^3\d{15}$/.test(value)) {
    const { data, error } = await supabase.rpc('resolve_ican_business_wallet', { p_wallet_address: value });
    const row = Array.isArray(data) ? data[0] : data;
    if (error || !row) return null;
    return { kind: 'business', businessProfileId: row.business_profile_id, name: row.business_name || value, identifier: value };
  }

  let query = supabase.from('user_accounts').select('user_id, account_holder_name');
  if (/^\d{16}$/.test(value)) query = query.eq('account_number', value);
  else if (value.includes('@')) query = query.eq('email', value.toLowerCase());
  else query = query.eq('phone_number', value);

  const { data, error } = await query.maybeSingle();
  const row = data as { user_id: string; account_holder_name?: string } | null;
  if (error || !row) return null;
  return { kind: 'user', userId: row.user_id, name: row.account_holder_name || value, identifier: value };
}

export async function sendICANToBusiness({
  fromUserId,
  businessProfileId,
  amount,
  note = '',
}: {
  fromUserId: string;
  businessProfileId: string;
  amount: number;
  note?: string;
}): Promise<TransferResult> {
  const { data, error } = await supabase.rpc('transfer_ican_to_business', {
    p_from_user: fromUserId,
    p_business_profile_id: businessProfileId,
    p_amount: amount,
    p_note: note,
    p_source_app: SOURCE_APP,
    p_reference_id: null,
    p_pin_attempt: null,
  });
  if (error) throw error;
  if (!data?.success) throw new Error(data?.error || 'Business-wallet transfer failed');
  return data as TransferResult;
}

const UGANDA_NETWORK_PREFIXES: Record<'MTN' | 'AIRTEL', string[]> = {
  MTN: ['77', '78', '76', '39'],
  AIRTEL: ['70', '74', '75', '20'],
};

/** MTN or Airtel from a Ugandan number, or null when the prefix is not recognised. */
export function detectUgandaMobileNetwork(phoneNumber: string): 'MTN' | 'AIRTEL' | null {
  const digits = String(phoneNumber || '').replace(/[^\d]/g, '');
  const national = digits.startsWith('256') ? digits.slice(3) : digits.startsWith('0') ? digits.slice(1) : digits;
  const prefix = national.slice(0, 2);
  for (const network of ['MTN', 'AIRTEL'] as const) {
    if (UGANDA_NETWORK_PREFIXES[network].includes(prefix)) return network;
  }
  return null;
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
 * Buy ICAN coins with the money in the user's own IcanEra Wallet (wallet_accounts), at the
 * coin's LIVE value — no payment window: it is an exchange between two balances they already
 * hold. Flutterwave is only for money entering or leaving the platform.
 */
export async function buyICANFromWallet({
  userId,
  icanAmount,
  reference = null,
}: {
  userId: string;
  icanAmount: number;
  reference?: string | null;
}): Promise<{ success: boolean; ican_bought: number; ugx_paid: number; price_per_ican: number; wallet_balance: number }> {
  const { data, error } = await supabase.rpc('buy_ican_coins_from_wallet', {
    p_user_id: userId,
    p_ican_amount: icanAmount,
    p_source_app: SOURCE_APP,
    p_reference: reference,
  });
  if (error) throw new Error(/buy_ican_coins_from_wallet/.test(error.message) ? 'Buying IcanEra is not switched on yet.' : error.message);
  if (!data.success) throw new Error(data.error ?? 'Buy failed');
  return data;
}

/** The money (UGX) in the user's own IcanEra Wallet — what a purchase is paid from. */
export async function getWalletUgxBalance(): Promise<number> {
  const { data, error } = await supabase.rpc('get_my_wallet_ugx_balance');
  if (error) throw error;
  return Number(data) || 0;
}

/**
 * Sell ICAN coins into the app's own ICANera Wallet balance (wallet_accounts)
 * — instant, fee only. For an external cash-out to mobile money/bank instead,
 * use requestIcanPayout().
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
  const { data, error } = await supabase.rpc('sell_ican_coins_to_wallet', {
    p_user_id: userId,
    p_ican_amount: icanAmount,
    p_source_app: SOURCE_APP,
    p_reference: reference,
  });
  if (error) throw error;
  if (!data.success) throw new Error(data.error ?? 'Sell failed');
  return data as SellResult;
}

// ─── Send Out (cash out via Flutterwave) ───────────────────────────────────────

export interface PayoutResult {
  success: boolean;
  request_id: string;
  reference: string;
  status: 'processing';
  ugx_gross: number;
  fee_ugx: number;
  ugx_net: number;
  message: string;
}

/**
 * Sell ICAN and disburse the UGX directly to mobile money or a bank account
 * via Flutterwave, instead of an offline cashier payout. Debits the wallet
 * immediately; the transfer itself settles asynchronously and is refunded
 * automatically if Flutterwave rejects or fails it.
 */
export async function requestIcanPayout({
  icanAmount,
  channel,
  phoneNumber,
  network,
  accountNumber,
  bankCode,
  beneficiaryName,
}: {
  icanAmount: number;
  channel: 'mobilemoneyuganda' | 'bank';
  phoneNumber?: string;
  network?: 'MTN' | 'AIRTEL';
  accountNumber?: string;
  bankCode?: string;
  beneficiaryName?: string;
}): Promise<PayoutResult> {
  const { data, error } = await supabase.functions.invoke('flutterwave-payout', {
    body: {
      ican_amount: icanAmount,
      channel,
      phone_number: phoneNumber,
      network,
      account_number: accountNumber,
      bank_code: bankCode,
      beneficiary_name: beneficiaryName,
      source_app: SOURCE_APP,
    },
  });
  if (error) throw error;
  if (!data?.success) throw new Error(data?.error ?? 'Payout failed');
  return data as PayoutResult;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** The platform's cut of a sale, as a share of what is sold (mirrors sell_ican_coins in SQL). */
export const SELL_FEE_RATE = 0.03;

/**
 * The LIVE price of one icaneracoin in UGX — the same number the wallet badge shows (FX, the
 * inflation floor and network usage; never below the 5,000 launch floor). Selling pays at this,
 * not at the floor. Returns null if the price engine can't be reached, so callers can refuse
 * to quote a figure rather than show a wrong one.
 */
export async function getLiveUgxPrice(): Promise<number | null> {
  const { data, error } = await supabase.rpc('ican_get_price_in_currency', { p_currency_code: 'UGX' });
  if (error) return null;
  const row = Array.isArray(data) ? data[0] : data;
  const price = Number(row?.price_local);
  return Number.isFinite(price) && price > 0 ? price : null;
}

export function ugxToICAN(ugx: number): number {
  return Math.floor((ugx / ICAN_TO_UGX) * 1e8) / 1e8;
}

export function icanToUGX(ican: number): number {
  return ican * ICAN_TO_UGX;
}

export function formatICAN(amount: number): string {
  return Number(amount).toFixed(4);
}
