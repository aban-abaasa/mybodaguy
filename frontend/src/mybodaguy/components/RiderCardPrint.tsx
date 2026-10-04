import { createRoot, type Root } from 'react-dom/client';
import { toast } from 'sonner';
import { CardBack, CardFront, cardColourStyle } from './RiderIdCard';
import type { RiderCard } from '../services/riderCardService';
import './riderCard.css';

// Only a paid card of a rider who is still active is worth printing: an unpaid
// card has no QR yet, and a suspended rider's card must not go back into use.
export const isPrintableCard = (card: Pick<RiderCard, 'status' | 'rider_status'>) =>
  card.status === 'active' && card.rider_status === 'active';

let mounted: { el: HTMLElement; root: Root } | null = null;

function cleanup() {
  window.removeEventListener('afterprint', cleanup);
  if (!mounted) return;
  const { el, root } = mounted;
  mounted = null;
  root.unmount();
  el.remove();
}

// Front and back of each card side by side, at real card size, one row per rider.
function PrintSheet({ cards }: { cards: RiderCard[] }) {
  return (
    <>
      {cards.map((card, i) => (
        <div className="rc-print-row" key={card.card_id}>
          <p className="rc-print-caption">
            {card.full_name} · {card.card_number} · {[card.stage, card.division].filter(Boolean).join(', ')}
          </p>
          <div className="rc-print-faces">
            <div className="rc rc-print-card" style={cardColourStyle(card.accent_color)}>
              <div className="rc-flip is-static">
                <CardFront data={card} status="active" uid={`print-${i}`} />
              </div>
            </div>
            <div className="rc rc-print-card" style={cardColourStyle(card.accent_color)}>
              <div className="rc-flip is-static">
                <CardBack data={card} status="active" />
              </div>
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

// Wait for the sheet to be drawn (QR codes paint on mount) and for rider photos to load.
async function sheetReady(el: HTMLElement) {
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  const images = Array.from(el.querySelectorAll('img')).map(
    (img) => (img.complete ? Promise.resolve() : new Promise<void>((resolve) => { img.onload = img.onerror = () => resolve(); }))
  );
  await Promise.race([Promise.all(images), new Promise((resolve) => setTimeout(resolve, 2500))]);
}

// Opens the browser's print dialog with the given riders' cards laid out as a
// sheet (on a phone, choose "Save as PDF" or a printer). Returns how many cards
// went on the sheet.
export async function printRiderCards(cards: RiderCard[]): Promise<number> {
  const printable = cards.filter(isPrintableCard);
  if (printable.length === 0) {
    toast.error(cards.length > 0 ? 'Only paid cards of active riders can be printed.' : 'There are no cards to print.');
    return 0;
  }

  cleanup(); // never leave a previous sheet behind
  const el = document.createElement('div');
  el.className = 'rc-print-root';
  document.body.appendChild(el);
  const root = createRoot(el);
  mounted = { el, root };
  root.render(<PrintSheet cards={printable} />);

  await sheetReady(el);
  window.addEventListener('afterprint', cleanup, { once: true });
  window.print();
  return printable.length;
}
