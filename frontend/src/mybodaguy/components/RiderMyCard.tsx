import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ArrowRight, IdCard, Sparkles } from 'lucide-react';
import RiderIdCard, { FeesChip, PermitChip, RiderCardVisual } from './RiderIdCard';
import {
  DEFAULT_RIDER_CARD_FEE_ICAN,
  riderCardService,
  type RequestableRider,
  type RiderCard,
} from '../services/riderCardService';

interface Props {
  // 'page' is the "My Card" tab; 'tile' is the compact entry on the Overview.
  variant?: 'page' | 'tile';
  // Called after a payment goes through so the wallet balance on screen can refresh.
  onPaid?: () => void;
  // Tile only: open the My Card tab.
  onOpen?: () => void;
}

const vehicleLabel = (type: string) => type.charAt(0).toUpperCase() + type.slice(1);

// "The database function isn't there" — i.e. the card SQL has not been run for this feature yet.
const looksNotSetUp = (message?: string | null) =>
  !!message && /could not find the function|schema cache|does not exist|PGRST202|42883/i.test(message);

function useMyCards() {
  const [cards, setCards] = useState<RiderCard[]>([]);
  const [requestable, setRequestable] = useState<RequestableRider[]>([]);
  const [fee, setFee] = useState(DEFAULT_RIDER_CARD_FEE_ICAN);
  const [loading, setLoading] = useState(true);
  const [cardsError, setCardsError] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [mine, can, cardFee] = await Promise.all([
      riderCardService.getMyCards(),
      riderCardService.getRequestable(),
      riderCardService.getFee(),
    ]);
    setCards(mine.cards);
    setCardsError(mine.error ?? null);
    setRequestable(can.riders);
    setRequestError(can.error ?? null);
    setFee(cardFee);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { cards, requestable, fee, loading, cardsError, requestError, reload: load };
}

// The rider's own ID card.
//  * No card yet: a rider whose account is active can request one. It is issued
//    on the spot, no approval, as an unpaid card.
//  * Unpaid card: shows the card, what it costs and who the fee is shared with;
//    paying it from their own wallet activates the QR.
//  * Active card: the credit-card-style ID, tap to flip it for the QR.
export default function RiderMyCard({ variant = 'page', onPaid, onOpen }: Props) {
  const { cards, requestable, fee, loading, cardsError, requestError, reload } = useMyCards();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [paying, setPaying] = useState<string | null>(null);
  const [requesting, setRequesting] = useState<string | null>(null);

  // ── Compact entry on the Overview ───────────────────────────────────────
  if (variant === 'tile') {
    if (loading || (cards.length === 0 && requestable.length === 0)) return null;
    const pending = cards.some((c) => c.status === 'pending_payment');
    const active = cards.find((c) => c.status === 'active');
    const title = pending ? 'Your rider ID card is ready' : active ? 'My rider ID card' : 'Get your rider ID card';
    const caption = pending
      ? `Pay ${fee} ICAN to activate it`
      : active
        ? 'Tap to show your QR card'
        : 'Issued instantly when you ask';
    return (
      <button
        type="button"
        onClick={onOpen}
        className={`classic-card flex w-full items-center gap-4 p-4 text-left transition-all hover:border-orange-300 active:scale-[0.99] ${
          pending ? '!border-orange-400 ring-2 ring-orange-200/70' : ''
        }`}
      >
        <span className="grid h-12 w-12 flex-shrink-0 place-items-center rounded-full bg-orange-50 ring-1 ring-inset ring-orange-100">
          <IdCard size={21} className="text-orange-500" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-classic-display text-lg font-semibold leading-tight text-slate-800">{title}</span>
          <span className="mt-0.5 block text-xs text-slate-500">{caption}</span>
          {active && (
            <span className="mt-1.5 flex flex-wrap gap-1.5">
              <PermitChip status={active.permit_status} />
              <FeesChip status={active.fees_status} />
            </span>
          )}
        </span>
        <span className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-full bg-gradient-to-br from-orange-500 to-amber-400 text-white shadow-md shadow-orange-500/30">
          <ArrowRight size={15} />
        </span>
      </button>
    );
  }

  // ── The My Card tab ─────────────────────────────────────────────────────
  const request = async (rider: RequestableRider) => {
    setRequesting(rider.rider_id);
    const result = await riderCardService.requestCard(rider.rider_id);
    if (result.success) {
      toast.success(`Your card is issued. Pay ${result.card?.fee_ican ?? fee} ICAN to activate it.`);
      await reload();
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
      onPaid?.();
      await reload();
    } else {
      toast.error(result.error || 'Payment failed');
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <p className="classic-eyebrow">Identity</p>
        <h2 className="mt-1 font-classic-display text-[28px] font-bold leading-tight tracking-tight text-slate-900">My Card</h2>
        <p className="mt-1 text-sm text-slate-500">
          Your BodaGoEra rider ID. The QR code shows your details, driving permit status and fees to anyone who scans it.
        </p>
        <div className="landing-classic-divider mt-4" />
      </div>

      {loading ? (
        <div className="classic-card px-6 py-10 text-center text-sm text-slate-500" role="status">Loading your card…</div>
      ) : cardsError ? (
        <div role="alert" className="classic-card space-y-3 !border-amber-300 p-5 text-sm text-amber-900">
          <p className="font-semibold">
            {looksNotSetUp(cardsError) ? "Rider cards aren't switched on yet." : "We couldn't load your card."}
          </p>
          <p className="text-xs">
            {looksNotSetUp(cardsError)
              ? 'Please try again later, or ask your administrator.'
              : 'This looks like a connection problem. Check your internet and try again.'}
          </p>
          <button type="button" onClick={reload} className="classic-btn classic-btn-outline !w-auto !rounded-full !px-6">Try again</button>
        </div>
      ) : (
        <>
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
                  A credit-card-style ID with a QR code. It is issued the moment you ask; you pay <span className="font-semibold text-slate-800">{fee} ICAN</span> to activate it.
                </p>
                <p className="text-xs text-slate-500">
                  The fee is shared equally between the chairpersons of your stage, parish, subcounty, division and district.
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
            if (!pending) return <RiderIdCard key={card.card_id} card={card} />;
            return (
              <div key={card.card_id} className="classic-card space-y-3 !border-orange-400 p-4 ring-2 ring-orange-200/70">
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
            );
          })}

          {cards.length === 0 && requestable.length === 0 && (
            <div className="classic-card px-6 py-9 text-center">
              <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[#faf8f3] ring-1 ring-[#c4a052]/50">
                <IdCard className="text-[#c4a052]" size={28} strokeWidth={1.6} />
              </span>
              <h3 className="mt-4 font-classic-display text-xl font-semibold text-slate-800">No card yet</h3>
              <div className="landing-classic-divider mx-auto my-3 max-w-[140px]" />
              {requestError ? (
                <p className="text-sm text-slate-500">
                  {looksNotSetUp(requestError)
                    ? "Requesting a card isn't switched on yet. Please try again later."
                    : "We couldn't check whether you can request a card. Check your internet and try again."}
                </p>
              ) : (
                <>
                  <p className="text-sm text-slate-500">You can request your card once your rider account is approved and linked to a stage.</p>
                  <p className="mt-1 text-sm text-slate-500">Ask your stage chairperson if you're still waiting.</p>
                </>
              )}
              <button type="button" onClick={reload} className="classic-btn classic-btn-outline mx-auto mt-5 !w-auto !rounded-full !px-6">Check again</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
