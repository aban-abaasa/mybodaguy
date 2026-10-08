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

export const formatUGX = (amount: number | string | null | undefined): string =>
  `UGX ${Number(amount || 0).toLocaleString('en-UG', { maximumFractionDigits: 0 })}`;

export interface CartLine { product_id: string; quantity: number }

export interface InstallmentPlan {
  id: string; code: string; status: string; fulfilment: 'pickup' | 'delivery' | null;
  items: { product_id: string; name: string; quantity: number; unit_price: number; line_total: number }[];
  items_ugx: number; delivery_fee_ugx: number; total_ugx: number; paid_ugx: number; balance_ugx: number;
  deposit_ugx: number; n_installments: number; frequency_days: number; final_due_at: string; created_at: string;
  seller_id: string; seller_name: string | null; store_name: string; store_address: string | null;
  customer_name: string | null; customer_phone: string | null;
  pickup_code: string | null; receipt_code: string | null; verify_url: string | null;
  delivery: { address?: string; max_hours?: number } | null;
  cancel_reason: string | null; refunded_ugx: number; cancel_fee_ugx: number;
  schedule: { n: number; due_at: string; amount_ugx: number; paid_ugx: number; status: 'paid' | 'overdue' | 'upcoming' }[];
  can_cancel: boolean; in_cooling_off: boolean; cancel_fee_ugx_now: number;
  payments?: { amount_ugx: number; kind: string; method: string; at: string }[];
  events?: { kind: string; amount_ugx: number | null; note: string | null; at: string }[];
}

export interface InstallmentTerms {
  min_order_ugx: number; min_deposit_pct: number; min_payment_ugx: number; max_installments: number; max_plan_days: number;
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
  businessProfileId: string; cart: CartLine[]; installments: number; frequencyDays: number; depositUgx: number;
  payWith?: 'wallet' | 'flutterwave'; customerName?: string | null; customerPhone?: string | null;
}): Promise<{ code: string }> {
  return unwrap(await supabase.rpc('installment_create', {
    p_reseller_business_profile_id: p.businessProfileId, p_cart: p.cart, p_installments: p.installments,
    p_frequency_days: p.frequencyDays, p_deposit_ugx: p.depositUgx, p_pay_with: p.payWith ?? 'wallet',
    p_customer_name: p.customerName || null, p_customer_phone: p.customerPhone || null,
  }), 'Could not start this plan');
}

export async function payInstallmentFromWallet(code: string, amountUgx: number): Promise<Json> {
  return unwrap(await supabase.rpc('installment_pay_wallet', { p_code: code, p_amount_ugx: amountUgx }), 'Could not complete this payment');
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
  code: string, amountUgx: number, o: { name?: string | null; phone?: string | null; title?: string } = {},
): Promise<Json> {
  const start = unwrap(await supabase.rpc('installment_pay_start', { p_code: code, p_amount_ugx: amountUgx, p_dry_run: false }), 'Could not start this payment');
  writePending({ txRef: start.tx_ref, code });
  let payment;
  try {
    payment = await payWithFlutterwave({
      amount: Number(start.charge_ugx), txRef: start.tx_ref, customerName: o.name || undefined, customerPhone: o.phone || undefined,
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

export async function getMyBusinessAccounts(): Promise<{ business_profile_id: string; business_name: string; joined_at: string; plans: number; open_plans: number; paid_ugx: number; balance_ugx: number }[]> {
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

// ── Finding products to put on a plan ──────────────────────────────────────

export interface BrowseProduct { product_id: string; name: string; images: string[] | null; min_price: number; reseller_count: number; any_free_delivery: boolean; any_in_stock: boolean }
export interface BrowseOffer { listing_id: string; reseller_business_profile_id: string; reseller_name: string; listed_price: number; free_delivery: boolean; in_stock: boolean }
export interface ShelfItem { listing_id: string; product_id: string; name: string; images: string[] | null; listed_price: number; available_stock: number; in_stock: boolean; reseller_name: string; free_delivery: boolean }

export async function browseProducts(query: string): Promise<BrowseProduct[]> {
  const { data } = await supabase.rpc('get_dropship_browsable_products', { p_query: query, p_limit: 40, p_offset: 0 });
  return data || [];
}
export async function productOffers(productId: string): Promise<BrowseOffer[]> {
  const { data } = await supabase.rpc('get_dropship_product_offers', { p_product_id: productId });
  return data || [];
}
export async function resellerShelf(businessProfileId: string): Promise<ShelfItem[]> {
  const { data } = await supabase.rpc('get_dropship_storefront', { p_reseller_business_profile_id: businessProfileId });
  return data || [];
}

// ── Helpers shared by the screens ───────────────────────────────────────────

export const FREQUENCY_LABELS: Record<number, string> = { 7: 'every week', 14: 'every 2 weeks', 30: 'every month' };

export function previewSchedule(o: { itemsUgx: number; depositUgx: number; installments: number; frequencyDays: number; start?: Date }) {
  const start = o.start ?? new Date();
  const rest = o.itemsUgx - o.depositUgx;
  const per = Math.ceil(rest / o.installments / 100) * 100;
  const rows = [{ n: 0, amount: o.depositUgx, due: start }];
  for (let k = 1; k <= o.installments; k += 1) {
    const amount = k === o.installments ? rest - per * (o.installments - 1) : per;
    rows.push({ n: k, amount, due: new Date(start.getTime() + k * o.frequencyDays * 86400000) });
  }
  return rows;
}

export const STATUS_LABELS: Record<string, string> = {
  awaiting_deposit: 'Waiting for deposit', active: 'Paying', ready: 'Paid in full', pickup_ready: 'Ready to collect',
  dispatched: 'On its way', completed: 'Completed', cancelled: 'Cancelled', lapsed: 'Lapsed',
};
