/**
 * ICAN Payment Request Service — My Boda Guy
 * Real, working "Receive" requests denominated in icaneracoin — reuses the
 * same shared payment_requests table ICAN app already uses for local
 * currency requests (see ALLOW_ICAN_PAYMENT_REQUESTS.sql, which adds 'ICAN'
 * as a valid currency). A request generates a real scannable QR value
 * (`ICANPAY:<code>`); paying it calls sendICAN() (0% fee, same as any
 * wallet-to-wallet send) and marks the request completed.
 */

import { supabase } from '../../services/supabaseClient';
import { sendICAN } from './icanWalletService';

const TABLE = 'payment_requests';

export interface IcanPaymentRequest {
  id: number;
  user_id: string;
  payment_code: string;
  amount: number;
  currency: string;
  description: string | null;
  status: 'pending' | 'completed' | 'expired';
  payer_user_id: string | null;
  ican_tx_id: string | null;
  created_at: string;
  expires_at: string;
  completed_at: string | null;
}

function generatePaymentCode(): string {
  const baseId = (globalThis.crypto?.randomUUID?.() || `${Date.now()}${Math.random()}`)
    .replace(/-/g, '')
    .toUpperCase();
  return `ICANPAY_${baseId.substring(0, 12)}`;
}

export async function createIcanPaymentRequest({
  userId,
  icanAmount,
  description = '',
}: {
  userId: string;
  icanAmount: number;
  description?: string;
}): Promise<IcanPaymentRequest & { qrValue: string }> {
  if (!(icanAmount > 0)) throw new Error('Enter a valid ICAN amount');
  const paymentCode = generatePaymentCode();

  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      user_id: userId,
      payment_code: paymentCode,
      amount: icanAmount,
      currency: 'ICAN',
      description,
      status: 'pending',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    })
    .select()
    .single();

  if (error) throw error;
  return { ...(data as IcanPaymentRequest), qrValue: `ICANPAY:${paymentCode}` };
}

export async function getIcanPaymentRequest(paymentCode: string): Promise<IcanPaymentRequest> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('payment_code', paymentCode)
    .eq('currency', 'ICAN')
    .single();

  if (error || !data) throw new Error('Payment request not found');
  const request = data as IcanPaymentRequest;
  if (request.status !== 'pending') throw new Error(`This payment request was already ${request.status}`);
  if (new Date(request.expires_at) < new Date()) throw new Error('This payment request has expired');
  return request;
}

/** Parses a scanned QR value; returns the payment code, or null if not an ICAN payment request. */
export function parseIcanPayCode(scannedText: string): string | null {
  const match = /^ICANPAY:(.+)$/.exec((scannedText || '').trim());
  return match ? match[1] : null;
}

export async function payIcanRequest({
  paymentCode,
  payerUserId,
}: {
  paymentCode: string;
  payerUserId: string;
}) {
  const request = await getIcanPaymentRequest(paymentCode);
  if (request.user_id === payerUserId) throw new Error('You cannot pay your own request');

  const transfer = await sendICAN({
    fromUserId: payerUserId,
    toUserId: request.user_id,
    amount: Number(request.amount),
    note: request.description || 'QR payment',
    referenceId: request.id,
  });

  const { error: completionError } = await supabase
    .from(TABLE)
    .update({
      status: 'completed',
      payer_user_id: payerUserId,
      // transfer_ican() returns out_tx_id/in_tx_id, not tx_id — TransferResult's
      // `tx_id` field doesn't match the RPC's real shape, so read it directly.
      ican_tx_id: (transfer as unknown as { out_tx_id: string }).out_tx_id,
      completed_at: new Date().toISOString(),
    })
    .eq('payment_code', paymentCode)
    .eq('status', 'pending');

  if (completionError) {
    throw new Error(`Payment transferred, but the request could not be closed: ${completionError.message}`);
  }

  return { request, transfer };
}

export async function getActiveIcanPaymentRequests(userId: string): Promise<IcanPaymentRequest[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('user_id', userId)
    .eq('currency', 'ICAN')
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data as IcanPaymentRequest[]) || [];
}

export async function deleteIcanPaymentRequest(paymentCode: string): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq('payment_code', paymentCode);
  if (error) throw error;
}
