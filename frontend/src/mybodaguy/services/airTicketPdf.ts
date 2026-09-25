import { airTicketVerifyUrl, type AirTicket } from './journeyService';

const fmtDateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'TBC';

// jsPDF's built-in fonts are Latin-1 only; anything else would print as garbage.
const latin = (s: string | null | undefined) => (s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E]/g, '?');

/**
 * Builds the air ticket (itinerary receipt) as a PDF and saves it to the
 * customer's device. jsPDF is loaded on demand so it stays out of the main bundle.
 */
export async function downloadAirTicketPdf(ticket: AirTicket): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const M = 16;
  let y = 0;

  const ensureRoom = (needed: number) => {
    if (y + needed > 282) {
      doc.addPage();
      y = 20;
    }
  };
  const label = (text: string, x: number, yy: number) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(120, 113, 108);
    doc.text(text.toUpperCase(), x, yy);
  };
  const value = (text: string, x: number, yy: number, size = 11, bold = true, maxWidth?: number) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(30, 41, 59);
    doc.text(latin(text), x, yy, maxWidth ? { maxWidth } : undefined);
  };

  // Header band
  doc.setFillColor(35, 27, 18);
  doc.rect(0, 0, W, 34, 'F');
  doc.setTextColor(246, 231, 189);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text('AIR TICKET', M, 16);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text('BodaGoEra Journey  |  E-ticket itinerary receipt', M, 23);
  doc.text(latin(ticket.airline || ''), W - M, 16, { align: 'right' });
  y = 46;

  // Booking reference + e-ticket numbers
  label('Booking reference (PNR)', M, y);
  value(ticket.bookingReference || 'PENDING', M, y + 9, 24);
  label('E-ticket number(s)', W / 2, y);
  if (ticket.eTickets.length > 0) {
    ticket.eTickets.forEach((n, i) => value(n, W / 2, y + 7 + i * 6, 11));
  } else {
    value('Being issued by the airline - download again shortly', W / 2, y + 7, 9, false, W / 2 - M);
  }
  y += 22 + Math.max(0, ticket.eTickets.length - 1) * 6;

  // Passengers
  doc.setDrawColor(226, 232, 240);
  doc.line(M, y, W - M, y);
  y += 8;
  label(ticket.passengers.length > 1 ? 'Passengers' : 'Passenger', M, y);
  y += 6;
  ticket.passengers.forEach((p) => {
    value(`${[p.title, p.givenName, p.familyName].filter(Boolean).join(' ').toUpperCase()}  (${p.type})`, M, y, 12);
    y += 7;
  });

  // Flights
  y += 4;
  ticket.segments.forEach((seg, i) => {
    ensureRoom(52);
    doc.setDrawColor(226, 232, 240);
    doc.line(M, y, W - M, y);
    y += 8;
    label(`Flight ${i + 1}${seg.flightNumber ? '  -  ' + seg.flightNumber : ''}${seg.carrier ? '  -  ' + seg.carrier : ''}`, M, y);
    y += 10;

    value(seg.origin.iata || '---', M, y, 22);
    value(seg.destination.iata || '---', W - M, y, 22);
    doc.setFontSize(22);
    doc.text('>', W / 2, y, { align: 'center' });
    y += 7;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(71, 85, 105);
    doc.text(latin([seg.origin.name || seg.origin.city, seg.origin.terminal && `Terminal ${seg.origin.terminal}`].filter(Boolean).join(' - ')), M, y, { maxWidth: 80 });
    doc.text(latin([seg.destination.name || seg.destination.city, seg.destination.terminal && `Terminal ${seg.destination.terminal}`].filter(Boolean).join(' - ')), W - M, y, { align: 'right', maxWidth: 80 });
    y += 11;

    label('Departs', M, y);
    label('Arrives', W / 2, y);
    y += 5;
    value(fmtDateTime(seg.departingAt), M, y, 10);
    value(fmtDateTime(seg.arrivingAt), W / 2, y, 10);
    y += 8;

    const extras = [
      seg.cabin && `Cabin: ${seg.cabin}`,
      seg.aircraft && `Aircraft: ${seg.aircraft}`,
      seg.operatedBy && `Operated by ${seg.operatedBy}`,
      seg.baggages.length > 0 && `Baggage: ${seg.baggages.map((b) => `${b.quantity} x ${b.type.replace(/_/g, ' ')}`).join(', ')}`,
    ].filter(Boolean) as string[];
    if (extras.length) {
      value(extras.join('   |   '), M, y, 8.5, false, W - 2 * M);
      y += 8;
    }
  });

  // Payment
  ensureRoom(40);
  y += 2;
  doc.setDrawColor(226, 232, 240);
  doc.line(M, y, W - M, y);
  y += 8;
  label('Fare paid to the airline', M, y);
  value(`${ticket.totalCurrency} ${ticket.totalAmount}`, M, y + 6, 11);
  if (ticket.totalPaidIcan != null) {
    label('Journey total paid (icaneracoin wallet)', W / 2, y);
    value(`${Number(ticket.totalPaidIcan).toFixed(4)} icaneracoin${ticket.totalPaidUgx ? `  (UGX ${Number(ticket.totalPaidUgx).toLocaleString()})` : ''}`, W / 2, y + 6, 10);
  }
  y += 18;

  // Proof-of-authenticity QR. It holds only a link to a random 128-bit code;
  // the check itself runs live on the server (mbg_verify_air_ticket), so it
  // can't be forged and stops verifying if the booking is cancelled.
  if (ticket.verifyCode) {
    const QR = 34;
    ensureRoom(QR + 12);
    const url = airTicketVerifyUrl(ticket.verifyCode);
    try {
      const QRCode = (await import('qrcode')).default;
      const qrPng = await QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 1, width: 400 });
      doc.setDrawColor(226, 232, 240);
      doc.line(M, y, W - M, y);
      y += 6;
      doc.addImage(qrPng, 'PNG', W - M - QR, y, QR, QR);
      label('Proof of authenticity', M, y + 3);
      value('Scan to verify this ticket', M, y + 11, 13);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(71, 85, 105);
      const how = doc.splitTextToSize(
        'The QR code checks this ticket live against the BodaGoEra booking record: it confirms the passenger, flight and payment, and shows if the booking has since been cancelled or the flight rescheduled.',
        W - 2 * M - QR - 8,
      ) as string[];
      doc.text(how, M, y + 18);
      doc.setFontSize(7.5);
      doc.setTextColor(120, 113, 108);
      doc.text(`Verification code ${ticket.verifyCode.slice(0, 8).toUpperCase()}`, M, y + QR - 5);
      doc.text(url.replace(/^https?:\/\//, ''), M, y + QR - 1);
      y += QR + 8;
    } catch (qrError) {
      // A QR failure must never block the ticket download itself.
      console.error('Air ticket QR could not be generated:', qrError);
    }
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(120, 113, 108);
  const notes = [
    'Present this ticket and a valid passport / travel document at check-in. Passenger names must match the travel document exactly.',
    'Arrive at the airport in good time - international flights usually close check-in 60 minutes before departure.',
    `Booking reference ${ticket.bookingReference || ''} can be used on the airline website or app to manage the booking. Journey ref: ${ticket.journeyId}.`,
  ];
  notes.forEach((n) => {
    const lines = doc.splitTextToSize(latin(n), W - 2 * M) as string[];
    ensureRoom(lines.length * 4 + 2);
    doc.text(lines, M, y);
    y += lines.length * 4 + 2;
  });
  doc.text(`Generated ${new Date().toLocaleString()}`, M, Math.max(y + 4, 286));

  doc.save(`Air-Ticket-${ticket.bookingReference || ticket.journeyId.slice(0, 8)}.pdf`);
}
