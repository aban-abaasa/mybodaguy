import type { jsPDF } from 'jspdf';
import { PRODUCT_OWNER, PRODUCT_OWNER_URL } from '../../constants/brand.ts';

/**
 * Draws "A product of GODMINDERA ORGANISATION (U) LTD" on a jsPDF page, with the company name as a clickable link to
 * icanera.space/godmindera-organisation-u-ltd (underlined so it reads as one on paper too).
 *
 * Uses the font, size and colour already set on the doc. `x`/`y` are where `doc.text(..., { align })` would put the line:
 *   align 'left' (default): x is the left edge; 'center': x is the middle; 'right': x is the right edge.
 * `lead` is text drawn in front on the same line (e.g. "Generated 1 Jan 2026  |  ").
 * Returns the width of the whole line.
 */
export function drawProductOf(
  doc: jsPDF,
  x: number,
  y: number,
  { align = 'left', lead = '' }: { align?: 'left' | 'center' | 'right'; lead?: string } = {},
): number {
  const prefix = `${lead}A product of `;
  // Measured with a trailing character, because a trailing space is not counted by getTextWidth.
  const prefixWidth = doc.getTextWidth(`${prefix}x`) - doc.getTextWidth('x');
  const nameWidth = doc.getTextWidth(PRODUCT_OWNER);
  const total = prefixWidth + nameWidth;
  const left = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;

  doc.text(prefix, left, y);
  doc.textWithLink(PRODUCT_OWNER, left + prefixWidth, y, { url: PRODUCT_OWNER_URL });

  // Underline in the text colour, a hair under the baseline.
  doc.setDrawColor(doc.getTextColor());
  const lineY = y + Math.max(0.4, doc.getFontSize() * 0.045);
  doc.line(left + prefixWidth, lineY, left + total, lineY);
  return total;
}
