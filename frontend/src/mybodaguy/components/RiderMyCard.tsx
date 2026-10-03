import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ChevronDown, IdCard, Sparkles } from 'lucide-react';
import RiderIdCard, { FeesChip, PermitChip, RiderCardVisual } from './RiderIdCard';
import {
  DEFAULT_RIDER_CARD_FEE_ICAN,
  riderCardService,
  type RequestableRider,
  type RiderCard,
} from '../services/riderCardService';

interface Props {
  // Called after a payment goes through so the wallet balance on screen can refresh.
  onPaid?: () => void;
}

const vehicleLabel = (type: string) => type.charAt(0).toUpperCase() + type.slice(1);

// The rider's own ID card on their dashboard.
//  * No card yet: a rider whose account is active can request one. It is issued
//    on the spot, no approval, as an unpaid card.
//  * Unpaid card: shows what it costs and who the fee is shared with; paying it
//    from their own wallet activates the QR.
//  * Active card: the credit-card-style ID, tap to flip it for the QR.
// Renders nothing for a rider who has no card and cannot request one yet.
export default function RiderMyCard({ onPaid }: Props) {
  const [cards, setCards] = useState<RiderCard[]>([]);
  const [requestable, setRequestable] = useState<RequestableRider[]>([]);
  const [fee, setFee] = useState(DEFAULT_RIDER_CARD_FEE_ICAN);
  const [open, setOpen] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [paying, setPaying] = useState<string | null>(null);
  const [requesting, setRequesting] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ cards: mine, error }, { riders }, cardFee] = await Promise.all([
      riderCardService.getMyCards(),
      riderCardService.getRequestable(),
      riderCardService.getFee(),
    ]);
    if (error) console.error('[RiderMyCard]', error);
    setCards(mine);
    setRequestable(riders);
    setFee(cardFee);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const request = async (rider: RequestableRider) => {
    setRequesting(rider.rider_id);
    const result = await riderCardService.requestCard(rider.rider_id);
    if (result.success) {
      toast.success(`Your card is issued. Pay ${result.card?.fee_ican ?? fee} ICAN to activate it.`);
      await load();
      // Straight on to the payment step; nothing is charged until they confirm.
      if (result.card) setConfirming(result.card.card_id);
    } else {
      toast.error(result.error || 'Could not request the card');
    }
    setRequesting(null);
  };

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

  if (cards.length === 0 && requestable.length === 0) return null;

  return (
    <div className="space-y-3">
      {requestable.map((rider) => (
        <div key={rider.rider_id} className="classic-card overflow-hidden">
          <div className="flex items-center gap-3 p-4">
            <span className="grid h-12 w-12 flex-shrink-0 place-items-center rounded-full bg-violet-50 ring-1 ring-inset ring-violet-100">
              <Sparkles size={20} className="text-violet-600" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-classic-display text-lg font-semibold leading-tight text-slate-800">Get your rider ID card</p>
              <p className="mt-0.5 truncate text-xs text-slate-500">
                {requestable.length > 1 ? `${vehicleLabel(rider.vehicle_type)} · ` : ''}
                <span className="uppercase">{rider.plate_number}</span>
                {rider.stage ? ` · ${rider.stage}` : ''}
              </p>
            </div>
          </div>
          <div className="space-y-3 border-t border-[#c4a052]/25 px-4 pb-4 pt-3">
            <p className="text-sm text-slate-600">
              A credit-card-style ID with a QR code that shows your details, driving permit status and fees. It is issued the moment you ask; you pay <span className="font-semibold text-slate-800">{fee} ICAN</span> to activate it.
            </p>
            <button
              type="button"
              onClick={() => request(rider)}
              disabled={requesting === rider.rider_id}
              className="classic-btn classic-btn-primary !rounded-full"
            >
              {requesting === rider.rider_id ? 'Issuing…' : 'Request my card'}
            </button>
          </div>
        </div>
      ))}

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
                <RiderCardVisual data={card} status="pending" />
                <p className="text-sm text-slate-600">
                  {card.requested_by_rider ? 'Your QR ID card has been issued.' : 'Your district chairperson issued you a QR ID card.'}{' '}
                  Pay <span className="font-semibold text-slate-800">{card.fee_ican} ICAN</span> from your wallet to activate it.
                </p>
                <p className="text-xs text-slate-500">
                  The fee is shared equally between the chairpersons of your stage, parish, subcounty, division and district.
                </p>
                {confirming === card.card_id ? (
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setConfirming(null)} disabled={paying === card.card_id} className="classic-btn classic-btn-outline !w-auto !flex-none !rounded-full !px-6">
                      Not now
                    </button>
                    <button type="button" onClick={() => pay(card)} disabled={paying === card.card_id} className="classic-btn classic-btn-primary !rounded-full whitespace-nowrap">
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
