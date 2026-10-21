import { formatMoney } from './money';

/** One paid store's receipt. A shop checkout spanning several stores has one of these per store. */
export interface StoreReceipt {
  receipt_id: string;
  receipt_number: string;
  store_id: string;
  store_name: string;
  store_location?: string | null;
  currency: string;
  purchased_at: string;
  customer_name?: string | null;
  items: Array<{
    product_id: string;
    product_name: string;
    quantity: number;
    unit_price: number;
    line_total: number;
  }>;
  subtotal: number;
  tax: number;
  total: number;
  /** Secret behind the QR code; staff scan it to approve this receipt. */
  approval_token: string | null;
  approval_status: 'pending' | 'approved';
  approved_by_name: string | null;
  approved_at: string | null;
}

/** The page staff land on when they scan a receipt's QR code. */
export function buildApprovalUrl(token: string): string {
  return `${window.location.origin}/receipt-approve/${token}`;
}

// jsPDF's built-in fonts are Latin-1 only; anything else would print as garbage.
const latin = (s: string | null | undefined) =>
  (s ?? '')
    .replace(/ /g, ' ')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7E]/g, '?');

const fmtDateTime = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString(undefined, {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : '';

/** Safe file name, e.g. receipt-RCP-20261019-82524495.pdf */
export function receiptFileName(r: Pick<StoreReceipt, 'receipt_number'>): string {
  return `receipt-${(r.receipt_number || 'purchase').replace(/[^A-Za-z0-9_-]+/g, '-')}.pdf`;
}

/**
 * Builds the receipt as a PDF and saves it to the customer's device. It always
 * carries the store name, every product bought, a QR code for staff approval,
 * and - once a staff member has approved it - their name. jsPDF and qrcode are
 * loaded on demand so they stay out of the main bundle.
 */
export async function downloadReceiptPdf(r: StoreReceipt): Promise<void> {
  const [{ jsPDF }, QRCode] = await Promise.all([import('jspdf'), import('qrcode')]);
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const M = 16;
  const fmt = (n: number) => latin(formatMoney(n, r.currency));
  let y = 0;

  const text = (
    s: string, x: number, yy: number,
    opts: { size?: number; bold?: boolean; color?: [number, number, number]; align?: 'left' | 'right' | 'center'; maxWidth?: number } = {},
  ) => {
    doc.setFont('helvetica', opts.bold ? 'bold' : 'normal');
    doc.setFontSize(opts.size ?? 10);
    const [cr, cg, cb] = opts.color ?? [30, 41, 59];
    doc.setTextColor(cr, cg, cb);
    doc.text(latin(s), x, yy, { align: opts.align ?? 'left', maxWidth: opts.maxWidth });
  };
  const ensureRoom = (needed: number) => {
    if (y + needed > 280) { doc.addPage(); y = 20; }
  };

  // Header band: the store the products were bought from
  doc.setFillColor(20, 83, 45);
  doc.rect(0, 0, W, 34, 'F');
  text(r.store_name || 'Store', M, 15, { size: 20, bold: true, color: [255, 255, 255], maxWidth: W - M * 2 });
  text(r.store_location || 'Purchase receipt', M, 23, { size: 10, color: [187, 247, 208], maxWidth: W - M * 2 });
  text('PURCHASE RECEIPT', M, 29.5, { size: 8, bold: true, color: [187, 247, 208] });
  y = 46;

  // Receipt facts
  const fact = (label: string, value: string, x: number, yy: number) => {
    text(label.toUpperCase(), x, yy, { size: 7.5, color: [120, 113, 108] });
    text(value, x, yy + 5, { size: 10.5, bold: true, maxWidth: (W - M * 2) / 2 - 4 });
  };
  fact('Receipt no.', r.receipt_number, M, y);
  fact('Date', fmtDateTime(r.purchased_at), W / 2, y);
  y += 13;
  fact('Store', r.store_name, M, y);
  fact('Customer', r.customer_name || 'Customer', W / 2, y);
  y += 15;

  // Products table
  doc.setDrawColor(226, 232, 240);
  doc.setFillColor(241, 245, 249);
  doc.rect(M, y - 5, W - M * 2, 8, 'F');
  text('PRODUCT', M + 2, y, { size: 8, bold: true, color: [71, 85, 105] });
  text('QTY', W - M - 62, y, { size: 8, bold: true, color: [71, 85, 105], align: 'right' });
  text('PRICE', W - M - 34, y, { size: 8, bold: true, color: [71, 85, 105], align: 'right' });
  text('AMOUNT', W - M - 2, y, { size: 8, bold: true, color: [71, 85, 105], align: 'right' });
  y += 8;

  for (const item of r.items) {
    ensureRoom(10);
    text(item.product_name || 'Product', M + 2, y, { size: 10, maxWidth: W - M * 2 - 80 });
    text(String(item.quantity), W - M - 62, y, { size: 10, align: 'right' });
    text(fmt(item.unit_price), W - M - 34, y, { size: 10, align: 'right' });
    text(fmt(item.line_total), W - M - 2, y, { size: 10, bold: true, align: 'right' });
    y += 3.5;
    doc.line(M, y, W - M, y);
    y += 5;
  }

  // Totals
  ensureRoom(30);
  y += 2;
  text('Tax (included)', W - M - 40, y, { size: 9.5, color: [100, 116, 139], align: 'right' });
  text(fmt(r.tax), W - M - 2, y, { size: 9.5, align: 'right' });
  y += 8;
  text('Total paid', W - M - 40, y, { size: 12, bold: true, align: 'right' });
  text(fmt(r.total), W - M - 2, y, { size: 12, bold: true, color: [194, 65, 12], align: 'right' });
  y += 14;

  // Approval block: QR for staff + who approved
  ensureRoom(52);
  const approved = r.approval_status === 'approved';
  const boxH = 46;
  doc.setDrawColor(approved ? 34 : 217, approved ? 197 : 119, approved ? 94 : 6);
  doc.setFillColor(approved ? 240 : 255, approved ? 253 : 251, approved ? 244 : 235);
  doc.roundedRect(M, y, W - M * 2, boxH, 3, 3, 'FD');

  const qrSize = 36;
  if (r.approval_token) {
    try {
      const qr = await QRCode.toDataURL(buildApprovalUrl(r.approval_token), { margin: 1, width: 360 });
      doc.addImage(qr, 'PNG', M + 5, y + 5, qrSize, qrSize);
    } catch (err) {
      console.warn('Could not add QR code to receipt PDF:', err);
    }
  }
  const tx = M + 5 + qrSize + 8;
  if (approved) {
    text('APPROVED', tx, y + 13, { size: 15, bold: true, color: [21, 128, 61] });
    text('Approved by', tx, y + 22, { size: 8, color: [100, 116, 139] });
    text(r.approved_by_name || 'Store staff', tx, y + 28, { size: 12, bold: true, maxWidth: W - tx - M - 4 });
    text(fmtDateTime(r.approved_at), tx, y + 34, { size: 9, color: [100, 116, 139] });
  } else {
    text('AWAITING STAFF APPROVAL', tx, y + 13, { size: 12, bold: true, color: [180, 83, 9] });
    text('Show this QR code to a staff member of', tx, y + 21, { size: 9, color: [100, 116, 139], maxWidth: W - tx - M - 4 });
    text(r.store_name, tx, y + 27, { size: 10, bold: true, maxWidth: W - tx - M - 4 });
    text('so they can scan and approve this receipt.', tx, y + 33, { size: 9, color: [100, 116, 139], maxWidth: W - tx - M - 4 });
  }
  y += boxH + 10;

  text('Paid with your IcanEra Wallet.', W / 2, y, {
    size: 8.5, color: [120, 113, 108], align: 'center', maxWidth: W - M * 2,
  });
  text('Thank you for shopping with ' + (r.store_name || 'us') + '.', W / 2, y + 6, {
    size: 8.5, color: [120, 113, 108], align: 'center', maxWidth: W - M * 2,
  });

  doc.save(receiptFileName(r));
}
