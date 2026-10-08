/**
 * Installment plans — pay for a storefront / business-website order in
 * instalments, then collect it or have it delivered once it is paid in full.
 *
 * The plans live in the shared IcanEra database (the ICAN repo's
 * supabase/migrations/20261011100000_installment_orders.sql), so a plan started
 * here shows up on icanera.space, on a business website and on SupermartKera,
 * and the other way round. Every amount, fee and date comes from the server;
 * this file only sends the cart, the chosen terms and the amount to pay now.
 *
 * Mobile Money / card / bank goes through the installment-pay Edge Function.
 * Money paid in is held inside the plan and only reaches the seller when the
 * order is collected or delivered.
 */

import { supabase } from './supabaseClient';
import { payWithFlutterwave } from './flutterwaveClient';

const PENDING_KEY = 'icanera_installment_pending';

const readPending = (): { txRef: string; code: string } | null => {
  try { return JSON.parse(localStorage.getItem(PENDING_KEY) || 'null'); } catch { return null; }
};
const writePending = (value: { txRef: string; code: string } | null) => {
  try {
    if (value) localStorage.setItem(PENDING_KEY, JSON.stringify(value));
    else localStorage.removeItem(PENDING_KEY);
  } catch { /* private mode — resume just won't be available */ }
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const unwrap = (res: { data: Json; error: { message?: string } | null }, fallback: string): Json => {
  if (res.error) throw new Error(res.error.message || fallback);
  if (res.data && res.data.success === false) throw new Error(res.data.error || fallback);
  return res.data;
};

/** "UGX 5,000", "USD 12.50", "CNY 264.00" — any ISO currency, always with its code so it is never ambiguous. */
export const formatMoney = (amount: number | string | null | undefined, currency: string | null | undefined = 'UGX'): string => {
  const cur = String(currency || 'UGX').toUpperCase();
  const n = Number(amount || 0);
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: cur, currencyDisplay: 'code' }).format(n).replace(/\u00a0/g, ' ');
  } catch {
    return `${cur} ${n.toLocaleString('en', { maximumFractionDigits: 2 })}`;
  }
};
export const formatUGX = (amount: number | string | null | undefined): string => formatMoney(amount, 'UGX');

/** Decimals a currency's smallest sensible step ("unit") has: 100 -> 0, 1 -> 0, 0.01 -> 2. */
export const unitDecimals = (unit: number | string | null | undefined): number => {
  const u = Number(unit) || 1;
  return u >= 1 ? 0 : Math.min(4, Math.max(0, Math.ceil(-Math.log10(u) - 1e-9)));
};
/** Keep only what can be a money amount in the field: digits and (when the currency has cents) one decimal point. */
export const cleanAmountInput = (value: string, unit: number | string | null | undefined): string => {
  const dec = unitDecimals(unit);
  const raw = String(value || '').replace(dec ? /[^0-9.]/g : /[^0-9]/g, '');
  if (!dec) return raw;
  const [whole, ...rest] = raw.split('.');
  return rest.length ? `${whole}.${rest.join('').slice(0, dec)}` : whole;
};
const roundTo = (n: number, decimals: number) => Math.round((n + Number.EPSILON) * 10 ** decimals) / 10 ** decimals;

// Flutterwave channels differ by currency: Ugandan Mobile Money only exists for UGX; elsewhere offer cards, bank transfer and the local wallets it supports.
const paymentOptionsFor = (currency: string) => (String(currency).toUpperCase() === 'UGX'
  ? 'card,mobilemoneyuganda,account'
  : 'card,banktransfer,mpesa,mobilemoneyghana,mobilemoneyrwanda,mobilemoneytanzania,mobilemoneyzambia,mobilemoneyfranco');

export interface CartLine { product_id: string; quantity: number }

export interface InstallmentPlan {
  id: string; code: string; status: string; fulfilment: 'pickup' | 'delivery' | 'ship' | null;
  items: { product_id: string; name: string; quantity: number; unit_price: number; line_total: number }[];
  currency: string; unit: number; coin_price: number; held_ican: number;
  items_amount: number; delivery_fee_amount: number; total_amount: number; paid_amount: number; balance_amount: number;
  deposit_amount: number; n_installments: number; frequency_days: number; final_due_at: string; created_at: string;
  seller_id: string; seller_name: string | null; store_name: string; store_address: string | null;
  customer_name: string | null; customer_phone: string | null;
  pickup_code: string | null; receipt_code: string | null; verify_url: string | null;
  delivery: { address?: string; max_hours?: number } | null;
  cancel_reason: string | null; refunded_amount: number; cancel_fee_amount: number;
  cross_border: boolean; buyer_currency: string | null; pickup_available: boolean; delivery_available: boolean; ship_available: boolean;
  shipping: ShippingAddress | null; shipment: Shipment | null; problem: { note?: string; at?: string } | null;
  shipped_at: string | null; auto_release_at: string | null; ship_deadline_at: string | null;
  schedule: { n: number; due_at: string; amount: number; paid_amount: number; status: 'paid' | 'overdue' | 'upcoming' }[];
  can_cancel: boolean; in_cooling_off: boolean; cancel_fee_amount_now: number;
  payments?: { amount: number; kind: string; method: string; at: string }[];
  events?: { kind: string; amount: number | null; note: string | null; at: string }[];
}

export interface ShippingAddress { name?: string; phone?: string; line1?: string; line2?: string; city?: string; region?: string; postal_code?: string; country?: string; note?: string }
export interface Shipment { carrier?: string; tracking_no?: string; tracking_url?: string; eta_days?: number; shipped_at?: string }

export interface InstallmentTerms {
  currency: string; coin_price: number; unit: number; delivery_available: boolean;
  min_order_amount: number; min_deposit_pct: number; min_payment_amount: number; max_installments: number; max_plan_days: number;
  grace_days: number; cancel_fee_pct: number; cooling_off_hours: number; frequencies_days: number[]; gateway_fee_pct: number;
}

// ── Before signing in ───────────────────────────────────────────────────────

export async function quoteInstallments(businessProfileId: string, cart: CartLine[]): Promise<Json> {
  const { data, error } = await supabase.rpc('installment_quote', { p_reseller_business_profile_id: businessProfileId, p_cart: cart });
  if (error) return { success: false, error: error.message };
  return data;
}

export async function getBusinessSiteInfo(businessProfileId: string): Promise<{ found: boolean; accounts_enabled: boolean; business_name?: string }> {
  const { data, error } = await supabase.rpc('business_site_info', { p_business_profile_id: businessProfileId });
  if (error || !data) return { found: false, accounts_enabled: false };
  return data;
}

// ── Starting and paying a plan ──────────────────────────────────────────────

export async function createInstallmentPlan(p: {
  businessProfileId: string; cart: CartLine[]; installments: number; frequencyDays: number; depositAmount: number;
  payWith?: 'wallet' | 'flutterwave'; customerName?: string | null; customerPhone?: string | null;
}): Promise<{ code: string }> {
  return unwrap(await supabase.rpc('installment_create', {
    p_reseller_business_profile_id: p.businessProfileId, p_cart: p.cart, p_installments: p.installments,
    p_frequency_days: p.frequencyDays, p_deposit_amount: p.depositAmount, p_pay_with: p.payWith ?? 'wallet',
    p_customer_name: p.customerName || null, p_customer_phone: p.customerPhone || null,
  }), 'Could not start this plan');
}

export async function payInstallmentFromWallet(code: string, amount: number): Promise<Json> {
  return unwrap(await supabase.rpc('installment_pay_wallet', { p_code: code, p_amount: amount }), 'Could not complete this payment');
}

async function confirmFlutterwavePayment(txRef: string, transactionId: string | null | undefined): Promise<Json> {
  const { data, error } = await supabase.functions.invoke('installment-pay', {
    body: { tx_ref: txRef, transaction_id: transactionId || null },
  });
  if (error) {
    let body: Json = null;
    try { body = await (error as Json).context.json(); } catch { /* no body — network failure */ }
    const err = new Error(body?.error || 'We could not reach the server to confirm your payment. Check your connection and reopen this page — your payment is saved.') as Error & { retryable?: boolean };
    err.retryable = !body;
    throw err;
  }
  if (!data?.success) {
    const err = new Error(data?.error || 'Payment could not be confirmed') as Error & { retryable?: boolean };
    err.retryable = false;
    throw err;
  }
  return data;
}

/** Mobile Money / card / bank: record the pending payment, take it with Flutterwave, confirm it on the server. */
export async function payInstallmentWithFlutterwave(
  code: string, amount: number, o: { name?: string | null; phone?: string | null; title?: string } = {},
): Promise<Json> {
  const start = unwrap(await supabase.rpc('installment_pay_start', { p_code: code, p_amount: amount, p_dry_run: false }), 'Could not start this payment');
  writePending({ txRef: start.tx_ref, code });
  let payment;
  try {
    payment = await payWithFlutterwave({
      amount: Number(start.charge_amount), currency: start.currency, paymentOptions: paymentOptionsFor(start.currency), txRef: start.tx_ref, customerName: o.name || undefined, customerPhone: o.phone || undefined,
      title: o.title || 'IcanEra instalment', description: `Instalment on plan ${code}`,
    });
  } catch (err) {
    writePending(null);
    throw err;
  }
  if (payment.status !== 'successful') {
    writePending(null);
    throw new Error(payment.status === 'cancelled' ? 'Payment cancelled — you have not been charged.' : 'The payment did not go through. You have not been charged.');
  }
  try {
    const result = await confirmFlutterwavePayment(start.tx_ref, payment.transaction_id);
    writePending(null);
    return result;
  } catch (err) {
    if (!(err as { retryable?: boolean }).retryable) writePending(null);
    throw err;
  }
}

/** Paid but closed the tab before it was confirmed? Finish it on the next visit to the same plan. */
export async function resumePendingInstallmentPayment(code: string): Promise<Json | null> {
  const pending = readPending();
  if (!pending?.txRef || pending.code !== code) return null;
  try {
    const result = await confirmFlutterwavePayment(pending.txRef, null);
    writePending(null);
    return result;
  } catch (err) {
    if (!(err as { retryable?: boolean }).retryable) writePending(null);
    return null;
  }
}

// ── Reading plans ───────────────────────────────────────────────────────────

export async function getInstallmentPlan(code: string): Promise<{ plan: InstallmentPlan; terms: InstallmentTerms } | null> {
  const { data, error } = await supabase.rpc('installment_get', { p_code: code });
  if (error) throw new Error(error.message || 'Could not load this plan');
  return data?.success ? { plan: data.plan, terms: data.terms } : null;
}

export async function getMyInstallmentPlans(): Promise<InstallmentPlan[]> {
  const { data, error } = await supabase.rpc('installment_my_plans');
  if (error) throw new Error(error.message || 'Could not load your plans');
  return data || [];
}

export async function getMyBusinessAccounts(): Promise<{ business_profile_id: string; business_name: string; joined_at: string; plans: number; open_plans: number; totals: { currency: string; paid_amount: number; balance_amount: number }[] }[]> {
  const { data, error } = await supabase.rpc('business_site_my_accounts');
  if (error) return [];
  return data || [];
}

// ── Collect or deliver ──────────────────────────────────────────────────────

export async function chooseInstallmentPickup(code: string): Promise<Json> {
  return unwrap(await supabase.rpc('installment_choose_pickup', { p_code: code }), 'Could not arrange collection');
}

export async function quoteInstallmentDelivery(code: string, lat: number, lng: number, vehicleTypes: string[] | null = null): Promise<Json> {
  return unwrap(await supabase.rpc('installment_delivery_quote', {
    p_code: code, p_lat: lat, p_lng: lng, p_vehicle_types: vehicleTypes && vehicleTypes.length ? vehicleTypes : null,
  }), 'Could not price this delivery');
}

export async function chooseInstallmentDelivery(
  code: string, o: { address?: string; lat: number; lng: number; maxHours: number; vehicleTypes?: string[] | null },
): Promise<Json> {
  return unwrap(await supabase.rpc('installment_choose_delivery', {
    p_code: code, p_address: o.address || null, p_lat: o.lat, p_lng: o.lng, p_max_hours: o.maxHours,
    p_vehicle_types: o.vehicleTypes && o.vehicleTypes.length ? o.vehicleTypes : null,
  }), 'Could not arrange delivery');
}

export async function clearInstallmentDelivery(code: string): Promise<Json> {
  return unwrap(await supabase.rpc('installment_clear_delivery', { p_code: code }), 'Could not change delivery');
}

export async function cancelInstallmentPlan(code: string): Promise<Json> {
  return unwrap(await supabase.rpc('installment_cancel', { p_code: code }), 'Could not cancel this plan');
}

// ── Finding products to put on a plan (any shop in the world) ───────────────

export interface BrowseProduct { product_id: string; name: string; images: string[] | null; currency: string; store_country: string | null; cross_border: boolean | null; min_price: number; reseller_count: number; any_free_delivery: boolean; any_in_stock: boolean }
export interface BrowseOffer { listing_id: string; reseller_business_profile_id: string; reseller_name: string; listed_price: number; currency: string; free_delivery: boolean; in_stock: boolean }
export interface ShelfItem { listing_id: string; product_id: string; name: string; images: string[] | null; listed_price: number; tax_rate: number; currency: string; store_country: string | null; cross_border: boolean | null; available_stock: number; in_stock: boolean; reseller_name: string; free_delivery: boolean }

export async function browseProducts(query: string): Promise<BrowseProduct[]> {
  const { data } = await supabase.rpc('installment_browse_products', { p_query: query, p_limit: 40 });
  return data || [];
}
export async function productOffers(productId: string): Promise<BrowseOffer[]> {
  const { data } = await supabase.rpc('installment_product_offers', { p_product_id: productId });
  return data || [];
}
export async function resellerShelf(businessProfileId: string): Promise<ShelfItem[]> {
  const { data } = await supabase.rpc('installment_shelf', { p_reseller_business_profile_id: businessProfileId });
  return data || [];
}

// ── Shops abroad: ship to me ────────────────────────────────────────────────

/** Paid in full on an order from abroad: tell the seller where to send it. */
export async function chooseInstallmentShipping(code: string, address: ShippingAddress): Promise<Json> {
  return unwrap(await supabase.rpc('installment_choose_shipping', { p_code: code, p_address: address }), 'Could not save your shipping address');
}
/** The parcel arrived: pays the seller. */
export async function confirmInstallmentReceived(code: string): Promise<Json> {
  return unwrap(await supabase.rpc('installment_confirm_received', { p_code: code }), 'Could not confirm delivery');
}
/** The parcel is wrong, damaged or missing: holds the payment and asks support to look. */
export async function reportInstallmentProblem(code: string, note: string): Promise<Json> {
  return unwrap(await supabase.rpc('installment_report_problem', { p_code: code, p_note: note }), 'Could not report this');
}

/** The signed-in customer's IcanEra wallet balance in icaneracoin (0 for a brand-new account with no wallet yet); null if unknown. Never throws. */
export async function getWalletCoins(): Promise<number | null> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return null;
    const { data } = await supabase.from('ican_user_wallets').select('ican_balance').eq('user_id', auth.user.id).maybeSingle();
    return Number(data?.ican_balance || 0);
  } catch {
    return null;
  }
}

// icaneracoin is one coin for the whole world. Each payment on a plan converts at the coin's price in the plan's currency
// at that moment (UGX is fixed at 5,000 per coin); the server returns that price as `coin_price`.
export const coinsFor = (amount: number | string | null | undefined, coinPrice: number | string | null | undefined): number | null =>
  (Number(coinPrice) > 0 ? Number(amount || 0) / Number(coinPrice) : null);
export const formatCoinAmount = (coins: number | null | undefined): string =>
  (coins === null || coins === undefined ? '' : `${Number(coins).toLocaleString('en', { maximumFractionDigits: 4 })} ICAN`);
/** `amount` of a currency, as icaneracoin at `coinPrice` (that currency per coin). '' when the price is unknown. */
export const formatCoins = (amount: number | string | null | undefined, coinPrice: number | string | null | undefined): string => formatCoinAmount(coinsFor(amount, coinPrice));
// Why the wallet is the recommended way to pay a plan. Worded to what is actually true: the plan is held in coins (one
// global coin, not tied to any local currency), the item's price is locked from day one, and the wallet has no payment fee.
export const COIN_RECOMMENDATION =
  'Recommended: pay in icaneracoin. What you pay into a plan is held as icaneracoin — one global coin that isn\'t tied to any local currency — and your item\'s price is locked from the day you start, so rising prices can\'t catch up with what you have set aside. The wallet has no payment fee.';

// ── Helpers shared by the screens ───────────────────────────────────────────

export const FREQUENCY_LABELS: Record<number, string> = { 7: 'every week', 14: 'every 2 weeks', 30: 'every month' };

/** Preview of the schedule the server will build (same maths as _inst_schedule). installments 0 = pay it all today. */
export function previewSchedule(o: { items: number; deposit: number; installments: number; frequencyDays: number; unit?: number; start?: Date }) {
  const start = o.start ?? new Date();
  const unit = o.unit ?? 1;
  const dec = unitDecimals(unit);
  if (!o.installments) return [{ n: 0, amount: o.items, due: start }];
  const rest = roundTo(o.items - o.deposit, dec);
  const per = roundTo(Math.ceil(roundTo(rest / o.installments / unit, 6)) * unit, dec);
  const rows = [{ n: 0, amount: o.deposit, due: start }];
  for (let k = 1; k <= o.installments; k += 1) {
    const amount = k === o.installments ? roundTo(rest - per * (o.installments - 1), dec) : per;
    rows.push({ n: k, amount, due: new Date(start.getTime() + k * o.frequencyDays * 86400000) });
  }
  return rows;
}

export const STATUS_LABELS: Record<string, string> = {
  awaiting_deposit: 'Waiting for deposit', active: 'Paying', ready: 'Paid in full', pickup_ready: 'Ready to collect',
  shipping_pending: 'Waiting for the seller to ship', shipped: 'On its way to you', disputed: 'Under review',
  dispatched: 'On its way', completed: 'Completed', cancelled: 'Cancelled', lapsed: 'Lapsed',
};
