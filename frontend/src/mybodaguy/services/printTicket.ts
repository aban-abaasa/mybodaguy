/**
 * Opens a new tab with a clean, print-ready ticket/waybill and triggers the
 * browser's own print dialog — no PDF library needed, the browser's native
 * "Save as PDF" print target already covers that. Self-contained inline CSS
 * so nothing from the app's own stylesheet leaks into the printed page.
 */
/** Escapes user-supplied text (names, addresses, cargo notes) before it is written into the print page. */
const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

/**
 * Opens the print tab. Call it straight from the click: a tab opened later (after a
 * network request) is treated as a popup and blocked, especially on phones.
 */
export function openPrintWindow(): Window | null {
  const win = window.open('', '_blank', 'width=480,height=720');
  if (!win) return null; // popup blocked — nothing we can do without a user gesture retry
  win.document.write('<!DOCTYPE html><title>Preparing…</title><p style="font-family:sans-serif;padding:24px;color:#64748b">Preparing your ticket…</p>');
  return win;
}

function writePrintPage(win: Window, title: string, bodyHtml: string) {
  win.document.open();
  win.document.write(`<!DOCTYPE html>
<html>
<head>
<title>${esc(title)}</title>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; margin: 0; padding: 24px; color: #1e293b; }
  .ticket { max-width: 420px; margin: 0 auto; border: 2px dashed #f97316; border-radius: 12px; padding: 20px; }
  .header { text-align: center; margin-bottom: 16px; }
  .header h1 { font-size: 20px; margin: 0 0 4px; color: #ea580c; }
  .header p { margin: 0; font-size: 12px; color: #64748b; }
  .row { display: flex; justify-content: space-between; gap: 12px; padding: 6px 0; border-bottom: 1px solid #f1f5f9; font-size: 13px; }
  .row .label { color: #64748b; min-width: 0; overflow-wrap: anywhere; }
  .row .value { font-weight: 600; text-align: right; min-width: 0; overflow-wrap: anywhere; }
  .leg { padding: 6px 0; border-bottom: 1px solid #f1f5f9; font-size: 13px; overflow-wrap: anywhere; }
  .leg .route { font-weight: 600; }
  .leg .who { color: #64748b; font-size: 12px; margin-top: 2px; }
  .big { font-size: 16px; }
  .code { font-family: monospace; letter-spacing: 1px; background: #fff7ed; padding: 2px 8px; border-radius: 4px; }
  .section-title { font-size: 11px; text-transform: uppercase; color: #ea580c; font-weight: 700; margin: 16px 0 6px; }
  .footer { text-align: center; margin-top: 16px; font-size: 11px; color: #94a3b8; }
  .badge { display: inline-block; margin: 0 auto 4px; padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 700; }
  .paid { background: #dcfce7; color: #166534; }
  .unpaid { background: #fee2e2; color: #991b1b; }
  .qr { text-align: center; margin-top: 16px; padding: 12px; border: 1px solid #fed7aa; border-radius: 8px; background: #fffbf5; }
  .qr img { width: 150px; height: 150px; }
  .qr small { display: block; margin-top: 6px; color: #64748b; font-size: 10.5px; line-height: 1.4; overflow-wrap: anywhere; }
  .note { margin-top: 12px; font-size: 10.5px; color: #64748b; line-height: 1.45; }
  @media print { body { padding: 0; } .ticket { border-style: solid; } }
</style>
</head>
<body>
  <div class="ticket">${bodyHtml}</div>
  <div class="footer">Generated ${esc(new Date().toLocaleString())}</div>
  <script>window.onload = () => window.print();</script>
</body>
</html>`);
  win.document.close();
}

function openAndPrint(title: string, bodyHtml: string) {
  const win = openPrintWindow();
  if (!win) return;
  writePrintPage(win, title, bodyHtml);
}

export function printFlightTicket(params: {
  passengerName: string;
  pnr: string | null;
  carrier: string;
  originLabel: string;
  destinationLabel: string;
  departureAt: string | null;
  arrivalAt: string | null;
  totalIcan: number;
  totalUgx: number;
}) {
  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : 'TBD');
  openAndPrint('Air Ticket', `
    <div class="header">
      <h1>✈️ Boarding Pass</h1>
      <p>BodaGoEra Journey — real flight, booked via Duffel</p>
    </div>
    <div class="row"><span class="label">Passenger</span><span class="value">${esc(params.passengerName)}</span></div>
    <div class="row"><span class="label">Carrier</span><span class="value">${esc(params.carrier)}</span></div>
    <div class="row"><span class="label">Booking ref (PNR)</span><span class="value code">${esc(params.pnr || 'Pending')}</span></div>
    <div class="section-title">Route</div>
    <div class="row"><span class="label">From</span><span class="value">${esc(params.originLabel)}</span></div>
    <div class="row"><span class="label">To</span><span class="value">${esc(params.destinationLabel)}</span></div>
    <div class="row"><span class="label">Departure</span><span class="value">${fmt(params.departureAt)}</span></div>
    <div class="row"><span class="label">Arrival</span><span class="value">${fmt(params.arrivalAt)}</span></div>
    <div class="section-title">Payment</div>
    <div class="row big"><span class="label">Total paid</span><span class="value">${params.totalIcan.toFixed(4)} ICAN (UGX ${params.totalUgx.toLocaleString()})</span></div>
  `);
}

export interface ShipTicketProofLeg {
  type: string;
  status: string;
  from: string | null;
  to: string | null;
  carrier: string | null;
  carrier_registration: string | null;
  vessel: string | null;
  /** A booking with a shipping line: who ('maersk', or 'mock' for a TEST booking), its reference and status. */
  carrier_provider?: string | null;
  carrier_booking_ref?: string | null;
  carrier_booking_status?: string | null;
}

const PROVIDER_LABEL: Record<string, string> = { maersk: 'Maersk' };

/** One line saying who carries a leg, from the server's proof. A mock booking is always labelled as a test. */
export function describeCarrier(l: ShipTicketProofLeg): string {
  if (l.carrier_booking_ref && l.carrier_provider === 'mock') {
    return `TEST booking ${l.carrier_booking_ref} — not a real shipment`;
  }
  const booked = l.carrier_booking_ref
    ? `${PROVIDER_LABEL[l.carrier_provider || ''] || l.carrier_provider || 'Carrier'} booking ${l.carrier_booking_ref}${l.carrier_booking_status ? ` (${l.carrier_booking_status.toLowerCase().replace(/_/g, ' ')})` : ''}`
    : '';
  const operator = [l.carrier, l.carrier_registration && `reg. ${l.carrier_registration}`, l.vessel && `vessel/vehicle ${l.vessel}`].filter(Boolean).join(' · ');
  return [booked, operator].filter(Boolean).join(' · ') || 'carrier being assigned';
}

/** What mbg_verify_ship_ticket proves about a shipment — the same answer the QR gives. */
export interface ShipTicketProof {
  is_valid: boolean;
  is_ship?: boolean;
  state?: 'booked' | 'in_transit' | 'delivered' | 'cancelled' | 'unpaid';
  paid?: boolean;
  paid_via?: 'wallet' | 'company' | null;
  paid_ican?: number | null;
  payment_reference?: string | null;
  waybill_no?: string;
  origin_country?: string | null;
  destination_country?: string | null;
  cargo_description?: string | null;
  cargo_weight_kg?: number | null;
  legs?: ShipTicketProofLeg[];
  carrier_assigned?: boolean;
  booked_at?: string;
}

const legTitle = (t: string) => (t === 'sea_leg' ? 'Sea' : 'Road');

/**
 * The ship waybill, printed into a tab opened by openPrintWindow(). Everything that
 * says "paid" or names a carrier comes from the server's own proof (`proof`), not from
 * what is on screen, and the QR sends whoever scans it to the live check.
 */
export function printShipTicket(win: Window, params: {
  shipperName: string;
  proof: ShipTicketProof;
  verifyUrl: string;
  qrDataUrl: string;
}) {
  const { proof } = params;
  const legs = proof.legs ?? [];
  const paidLine = proof.paid
    ? `<span class="badge paid">PAID${proof.paid_via === 'company' ? ' — by company' : ''}</span>`
    : '<span class="badge unpaid">NOT PAID</span>';
  const legRows = legs.map((l) => {
    const who = esc(describeCarrier(l));
    return `<div class="leg"><div class="route">${legTitle(l.type)}: ${esc(l.from || '')} → ${esc(l.to || '')}</div><div class="who">${who}</div></div>`;
  }).join('');
  const heading = proof.state === 'delivered' ? 'Delivered' : proof.state === 'in_transit' ? 'In transit' : proof.state === 'cancelled' ? 'Cancelled' : 'Booked';

  writePrintPage(win, 'Shipping Waybill', `
    <div class="header">
      <h1>🚢 Shipping Waybill</h1>
      <p>BodaGoEra Cargo — road → sea → road</p>
      <div style="margin-top:8px">${paidLine}</div>
    </div>
    <div class="row"><span class="label">Shipper</span><span class="value">${esc(params.shipperName)}</span></div>
    <div class="row"><span class="label">Waybill No.</span><span class="value code">${esc(proof.waybill_no || '')}</span></div>
    <div class="row"><span class="label">Status</span><span class="value">${esc(heading)}</span></div>
    <div class="section-title">Cargo</div>
    <div class="row"><span class="label">Description</span><span class="value">${esc(proof.cargo_description || 'Not specified')}</span></div>
    <div class="row"><span class="label">Weight</span><span class="value">${proof.cargo_weight_kg != null ? `${Number(proof.cargo_weight_kg).toLocaleString()} kg` : 'Not specified'}</span></div>
    <div class="section-title">Route &amp; carrier</div>
    <div class="row"><span class="label">From</span><span class="value">${esc(proof.origin_country || '')}</span></div>
    <div class="row"><span class="label">To</span><span class="value">${esc(proof.destination_country || '')}</span></div>
    ${legRows}
    <div class="section-title">Payment</div>
    <div class="row big"><span class="label">Paid</span><span class="value">${proof.paid && proof.paid_ican != null ? `${Number(proof.paid_ican).toFixed(4)} ICAN` : 'No payment recorded'}</span></div>
    ${proof.payment_reference ? `<div class="row"><span class="label">Payment ref</span><span class="value code">${esc(proof.payment_reference)}</span></div>` : ''}
    <div class="qr">
      <img src="${esc(params.qrDataUrl)}" alt="QR code to verify this waybill" />
      <small><strong>Scan to verify payment.</strong> The QR opens a live check against the BodaGoEra record, which says whether this shipment is really paid, who carries it and where it is.<br />${esc(params.verifyUrl.replace(/^https?:\/\//, ''))}</small>
    </div>
    <p class="note">This waybill is issued by BodaGoEra from its booking record. The carrier shown is the shipping line booking or the registered operator that accepted each leg; until there is one, the leg shows “carrier being assigned”. A TEST booking is not a real shipment.</p>
  `);
}
