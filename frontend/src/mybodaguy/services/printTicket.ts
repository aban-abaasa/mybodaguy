/**
 * Opens a new tab with a clean, print-ready ticket/waybill and triggers the
 * browser's own print dialog — no PDF library needed, the browser's native
 * "Save as PDF" print target already covers that. Self-contained inline CSS
 * so nothing from the app's own stylesheet leaks into the printed page.
 */
function openAndPrint(title: string, bodyHtml: string) {
  const win = window.open('', '_blank', 'width=480,height=720');
  if (!win) return; // popup blocked — nothing we can do without a user gesture retry
  win.document.write(`<!DOCTYPE html>
<html>
<head>
<title>${title}</title>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; margin: 0; padding: 24px; color: #1e293b; }
  .ticket { max-width: 420px; margin: 0 auto; border: 2px dashed #f97316; border-radius: 12px; padding: 20px; }
  .header { text-align: center; margin-bottom: 16px; }
  .header h1 { font-size: 20px; margin: 0 0 4px; color: #ea580c; }
  .header p { margin: 0; font-size: 12px; color: #64748b; }
  .row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #f1f5f9; font-size: 13px; }
  .row .label { color: #64748b; }
  .row .value { font-weight: 600; text-align: right; }
  .big { font-size: 16px; }
  .code { font-family: monospace; letter-spacing: 1px; background: #fff7ed; padding: 2px 8px; border-radius: 4px; }
  .section-title { font-size: 11px; text-transform: uppercase; color: #ea580c; font-weight: 700; margin: 16px 0 6px; }
  .footer { text-align: center; margin-top: 16px; font-size: 11px; color: #94a3b8; }
  @media print { body { padding: 0; } .ticket { border-style: solid; } }
</style>
</head>
<body>
  <div class="ticket">${bodyHtml}</div>
  <div class="footer">Generated ${new Date().toLocaleString()}</div>
  <script>window.onload = () => window.print();</script>
</body>
</html>`);
  win.document.close();
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
      <p>BodaGo Journey — real flight, booked via Duffel</p>
    </div>
    <div class="row"><span class="label">Passenger</span><span class="value">${params.passengerName}</span></div>
    <div class="row"><span class="label">Carrier</span><span class="value">${params.carrier}</span></div>
    <div class="row"><span class="label">Booking ref (PNR)</span><span class="value code">${params.pnr || 'Pending'}</span></div>
    <div class="section-title">Route</div>
    <div class="row"><span class="label">From</span><span class="value">${params.originLabel}</span></div>
    <div class="row"><span class="label">To</span><span class="value">${params.destinationLabel}</span></div>
    <div class="row"><span class="label">Departure</span><span class="value">${fmt(params.departureAt)}</span></div>
    <div class="row"><span class="label">Arrival</span><span class="value">${fmt(params.arrivalAt)}</span></div>
    <div class="section-title">Payment</div>
    <div class="row big"><span class="label">Total paid</span><span class="value">${params.totalIcan.toFixed(4)} ICAN (UGX ${params.totalUgx.toLocaleString()})</span></div>
  `);
}

export function printShipTicket(params: {
  shipperName: string;
  journeyId: string;
  cargoDescription: string | null;
  cargoWeightKg: number | null;
  pickupAddress: string;
  pickupCountry: string;
  dropoffAddress: string;
  dropoffCountry: string;
}) {
  openAndPrint('Shipping Waybill', `
    <div class="header">
      <h1>🚢 Shipping Waybill</h1>
      <p>BodaGo Cargo — road → sea → road</p>
    </div>
    <div class="row"><span class="label">Shipper</span><span class="value">${params.shipperName}</span></div>
    <div class="row"><span class="label">Waybill No.</span><span class="value code">${params.journeyId.slice(0, 8).toUpperCase()}</span></div>
    <div class="section-title">Cargo</div>
    <div class="row"><span class="label">Description</span><span class="value">${params.cargoDescription || 'Not specified'}</span></div>
    <div class="row"><span class="label">Weight</span><span class="value">${params.cargoWeightKg != null ? `${params.cargoWeightKg} kg` : 'Not specified'}</span></div>
    <div class="section-title">Route</div>
    <div class="row"><span class="label">Pickup</span><span class="value">${params.pickupAddress} (${params.pickupCountry})</span></div>
    <div class="row"><span class="label">Destination</span><span class="value">${params.dropoffAddress} (${params.dropoffCountry})</span></div>
  `);
}
