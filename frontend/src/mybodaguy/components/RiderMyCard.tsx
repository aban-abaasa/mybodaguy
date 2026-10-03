import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ChevronDown, IdCard } from 'lucide-react';
import RiderIdCard, { FeesChip, PermitChip } from './RiderIdCard';
import { riderCardService, type RiderCard } from '../services/riderCardService';

interface Props {
  // Called after a payment goes through so the wallet balance on screen can refresh.
  onPaid?: () => void;
}

// The rider's own ID card on their dashboard. Renders nothing until a district
// chairperson has issued them one. An unpaid card shows what it costs and who
// the fee is shared with; paying it from their own wallet activates the QR.
export default function RiderMyCard({ onPaid }: Props) {
  const [cards, setCards] = useState<RiderCard[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [paying, setPaying] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { cards: mine, error } = await riderCardService.getMyCards();
    if (error) console.error('[RiderMyCard]', error);
    setCards(mine);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const pay = async (card: RiderCard) => {
    setPaying(card.card_id);
    const result = await riderCardService.payCard(card.card_id);
    setPaying(null);
    setConfirming(null);
    if (result.success) {
      toast.success('Card paid. Your QR code is ready.');
      setOpen(card.card_id);
      onPaid?.();
      await load();
    } else {
      toast.error(result.error || 'Payment failed');
    }
  };

  if (cards.length === 0) return null;

  return (
    <div className="space-y-3">
      {cards.map((card) => {
        const pending = card.status === 'pending_payment';
        const expanded = open === card.card_id;
        return (
          <div key={card.card_id} className={`classic-card overflow-hidden ${pending ? '!border-orange-400 ring-2 ring-orange-200/70' : ''}`}>
            <div className="flex items-center gap-3 p-4">
              <span className="grid h-12 w-12 flex-shrink-0 place-items-center rounded-full bg-orange-50 ring-1 ring-inset ring-orange-100">
                <IdCard size={21} className="text-orange-500" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-classic-display text-lg font-semibold leading-tight text-slate-800">
                  {pending ? 'Your rider ID card is ready' : 'My rider ID card'}
                </p>
                <p className="mt-0.5 truncate text-xs text-slate-500">
                  {card.card_number} · <span className="uppercase">{card.plate_number}</span>
                </p>
                {!pending && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <PermitChip status={card.permit_status} />
                    <FeesChip status={card.fees_status} />
                  </div>
                )}
              </div>
              {!pending && (
                <button
                  type="button"
                  onClick={() => setOpen(expanded ? null : card.card_id)}
                  aria-expanded={expanded}
                  aria-label={expanded ? 'Hide card' : 'Show card'}
                  className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-full bg-gradient-to-br from-orange-500 to-amber-400 text-white shadow-md shadow-orange-500/30"
                >
                  <ChevronDown size={16} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
                </button>
              )}
            </div>

            {pending && (
              <div className="space-y-3 border-t border-[#c4a052]/25 px-4 pb-4 pt-3">
                <p className="text-sm text-slate-600">
                  Your district chairperson issued you a QR ID card. Pay <span className="font-semibold text-slate-800">{card.fee_ican} ICAN</span> from your wallet to activate it.
                </p>
                <p className="text-xs text-slate-500">
                  The fee is shared equally between the chairpersons of your stage, parish, subcounty, division and district.
                </p>
                {confirming === card.card_id ? (
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setConfirming(null)} disabled={paying === card.card_id} className="classic-btn classic-btn-outline !rounded-full">
                      Not now
                    </button>
                    <button type="button" onClick={() => pay(card)} disabled={paying === card.card_id} className="classic-btn classic-btn-primary !rounded-full">
                      {paying === card.card_id ? 'Paying…' : `Confirm ${card.fee_ican} ICAN`}
                    </button>
                  </div>
                ) : (
                  <button type="button" onClick={() => setConfirming(card.card_id)} className="classic-btn classic-btn-primary !rounded-full">
                    Pay {card.fee_ican} ICAN to activate
                  </button>
                )}
              </div>
            )}

            {expanded && !pending && (
              <div className="border-t border-[#c4a052]/25 p-4">
                <RiderIdCard card={card} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
