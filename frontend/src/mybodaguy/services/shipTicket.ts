import { supabase } from '../../services/supabaseClient';
import { airTicketVerifyUrl, type Journey } from './journeyService';
import { openPrintWindow, printShipTicket, type ShipTicketProof } from './printTicket';

export type { ShipTicketProof } from './printTicket';

/** Asks the database what it can prove about a shipment — the same live check the QR opens. */
export async function fetchShipTicketProof(code: string): Promise<ShipTicketProof> {
  const { data, error } = await supabase.rpc('mbg_verify_ship_ticket', { p_code: code });
  if (error) {
    throw new Error(/mbg_verify_ship_ticket/.test(error.message) ? 'Ship ticket checking is not switched on yet.' : error.message);
  }
  return (data as ShipTicketProof) ?? { is_valid: false };
}

/**
 * Prints the ship waybill for a booked shipment. Must be called straight from a click
 * (the print tab is opened first so phones don't block it as a popup). What it prints —
 * PAID or not, the payment reference, the carrier of each leg — is the server's proof,
 * and the QR on it opens the live check, so the paper can be verified by whoever holds it.
 */
export async function printVerifiedShipTicket(journey: Pick<Journey, 'id'> & { ticket_verify_code?: string | null }, shipperName: string): Promise<void> {
  const win = openPrintWindow();
  if (!win) throw new Error('Allow pop-ups for this site to print your ship ticket.');
  try {
    if (!journey.ticket_verify_code) throw new Error('This shipment has no verification code yet — please refresh and try again.');
    const proof = await fetchShipTicketProof(journey.ticket_verify_code);
    if (!proof.is_ship) throw new Error('This booking is not a shipment.');
    const verifyUrl = airTicketVerifyUrl(journey.ticket_verify_code);
    const QRCode = (await import('qrcode')).default;
    const qrDataUrl = await QRCode.toDataURL(verifyUrl, { errorCorrectionLevel: 'M', margin: 1, width: 400 });
    printShipTicket(win, { shipperName, proof, verifyUrl, qrDataUrl });
  } catch (err) {
    win.close();
    throw err;
  }
}
