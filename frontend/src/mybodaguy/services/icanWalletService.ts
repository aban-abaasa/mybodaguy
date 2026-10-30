/**
 * ICAN Wallet Service — My Boda Guy (TypeScript)
 * 1 ICAN = 5,000 UGX floor price.
 * Earnings are credited in full — the wallet takes no tithe (tithe lives only in the ICAN app's church Tithe tab).
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
}

export interface ICANTransaction {
  id: string;
  sender_user_id: string | null;
  recipient_user_id: string | null;
  ican_amount: number;
  ugx_equivalent: number;
  transaction_type: 'earn' | 'transfer_in' | 'transfer_out' | 'purchase' | 'sale' | 'cashback' | 'refund';
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
  net_credited: number;
}

export interface TransferResult {
  success: boolean;
  tx_id: string;
  amount_sent: number;
  recipient_received: number;
}

export interface BuyResult {
  success: boolean;
  tx_id: string;
  ican_bought: number;
  /** The user's own currency, and what the purchase cost in it. */
  currency: string;
  paid: number;
  price_per_ican: number;
  wallet_balance: number;
}

export interface SellResult {
  success: boolean;
  tx_id: string;
  ican_sold: number;
  /** The user's own currency, and what landed in their wallet in it (after the fee). */
  currency: string;
  payout: number;
  price_per_ican: number;
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
 * Credited in full.
 */
/**
 * Called when a rider completes a delivery.
 * Uses mbg_credit_rider_delivery which enforces:
 *  - target must be rider or chairperson in mbg_users
 *  - 5,000 UGX floor price
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

/**
 * True when what was typed is a Ugandan mobile number (0770123456, +256 770 123 456, 770123456) rather
 * than a bank account number, so one box can take either and the app works out the channel itself.
 * A bank account number is longer or doesn't start with 7 once the country/trunk prefix is dropped.
 */
export function looksLikeUgandaMobileNumber(input: string): boolean {
  const digits = String(input || '').replace(/[^\d]/g, '');
  const national = digits.startsWith('256') ? digits.slice(3) : digits.startsWith('0') ? digits.slice(1) : digits;
  return national.length === 9 && national.startsWith('7');
}

// ─── Buy / Sell ───────────────────────────────────────────────────────────────

/**
 * Buy ICAN coins — user pays UGX (notional), ICAN is credited to their wallet.
 * 1 ICAN = 5,000 UGX floor price.
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
}): Promise<BuyResult> {
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

export interface TradingInfo {
  /** The user's own currency (the country they chose at sign-up — the one the wallet badge shows). */
  currency: string;
  /** The LIVE price of one icaneracoin in that currency. */
  price: number;
  /** The money they hold in that currency in their IcanEra Wallet. */
  walletBalance: number;
}

/**
 * What the Buy / Sell screens need, in the USER'S OWN currency. `price` is the same figure the
 * database buys and sells with, so the number shown is the number paid. Returns null if the price
 * engine can't be reached, so callers refuse to quote a figure rather than show a wrong one.
 */
export async function getMyTradingInfo(): Promise<TradingInfo | null> {
  const { data, error } = await supabase.rpc('get_my_ican_trading_info');
  if (error || !data) return null;
  const price = Number(data.price_per_ican);
  if (!data.currency || !Number.isFinite(price) || price <= 0) return null;
  return { currency: data.currency, price, walletBalance: Number(data.wallet_balance) || 0 };
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
  if (error) throw await payoutFailure(error, 'Payout failed');
  if (!data?.success) throw icanEraFallbackError(friendlyPayoutError(data?.error ?? 'Payout failed'));
  return data as PayoutResult;
}

export interface UgandaBank {
  code: string;
  name: string;
}

/** Banks Flutterwave can pay into in Uganda, for the bank picker (mobile-money networks are left out — they're picked by number). */
export async function listUgandaBanks(): Promise<UgandaBank[]> {
  const { data, error } = await supabase.functions.invoke('flutterwave-banks', { method: 'GET' });
  if (error || !data?.success) throw new Error('Could not load the bank list. Check your connection and try again.');
  return ((data.banks || []) as UgandaBank[])
    .filter((b) => b.code && b.name && !/^(MTN|AIRTEL)\b/i.test(b.name))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export const ICANERA_WALLET_URL = 'https://icanera.space/#wallet';
export const ICANERA_FALLBACK_HINT = 'You can still send IcanEra to any IcanEra wallet instantly, with no fee.';
// Problems the person fixes themselves (balance, PIN, a typo): another way of paying would not help.
const NOT_A_PAYOUT_FAULT = /insufficient|not enough|own (registered )?phone number|\bpin\b|\bvalid\b|required|enter |choose |too small/i;

export interface PayoutError extends Error {
  /** The server's own wording, without our advice. */
  rawMessage?: string;
  /** The payout was refused (and refunded): sending to an IcanEra wallet is the way forward. */
  suggestIcanEra?: boolean;
  icanEraWalletUrl?: string;
}

/**
 * An Error for a refused mobile-money / bank payout that recommends sending to an IcanEra wallet instead:
 * wallet-to-wallet is instant, free and never touches the payment provider.
 */
export function icanEraFallbackError(message: string): PayoutError {
  const text = String(message || '').trim();
  if (!text || NOT_A_PAYOUT_FAULT.test(text)) return Object.assign(new Error(text || 'Transfer failed'), { rawMessage: text });
  const sentence = /[.!?]$/.test(text) ? text : `${text}.`;
  return Object.assign(new Error(`${sentence} ${ICANERA_FALLBACK_HINT}`), {
    rawMessage: text,
    suggestIcanEra: true,
    icanEraWalletUrl: ICANERA_WALLET_URL,
  });
}

/**
 * supabase.functions.invoke() only says "Edge Function returned a non-2xx status code" for an HTTP error;
 * the function's own {error: "..."} reply sits on error.context and has to be read out. When the function
 * ANSWERED, its refusal is final (anything debited was refunded) and IcanEra is recommended. When nothing
 * answered (connection lost) the payout may still have gone through, so nothing is recommended — sending
 * again could pay twice.
 */
async function payoutFailure(error: any, fallback: string): Promise<PayoutError> {
  const response = error?.context;
  if (response && typeof response.json === 'function') {
    try {
      const parsed = await (typeof response.clone === 'function' ? response.clone() : response).json();
      if (parsed?.error) return icanEraFallbackError(friendlyPayoutError(String(parsed.error)));
    } catch {
      // The reply wasn't JSON (e.g. a gateway error page): nothing of ours answered.
    }
  }
  return new Error(`${error?.message || fallback}. If your connection dropped, check your balance and history before trying again — the payout may have gone through.`);
}

/** Turn the provider's raw refusal into something a rider or customer can act on. The wallet is refunded in every case. */
function friendlyPayoutError(message: string): string {
  if (/ip whitelist/i.test(message)) {
    return "Cash-out isn't available right now — the payment provider hasn't approved our server yet. Your IcanEra has been refunded.";
  }
  if (/insufficient/i.test(message) && /balance|fund/i.test(message)) return message;
  if (/unrecognized bank_code/i.test(message)) return 'Choose your bank from the list.';
  return message;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** The platform's cut of a sale, as a share of what is sold (mirrors sell_ican_coins in SQL). */
export const SELL_FEE_RATE = 0.03;

export function ugxToICAN(ugx: number): number {
  return Math.floor((ugx / ICAN_TO_UGX) * 1e8) / 1e8;
}

export function icanToUGX(ican: number): number {
  return ican * ICAN_TO_UGX;
}

export function formatICAN(amount: number): string {
  return Number(amount).toFixed(4);
}
