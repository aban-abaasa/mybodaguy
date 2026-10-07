import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ArrowRight, IdCard, Receipt, Shield, Sparkles } from 'lucide-react';
import RiderIdCard, { FeesChip, InsuranceChip, PermitChip, RiderCardVisual } from './RiderIdCard';
import SetPinPrompt from './SetPinPrompt';
import { supabase } from '../services/supabaseClient';
import { hasPinSet, validatePIN, verifyPin } from '../services/pinService';
import {
  DEFAULT_RIDER_CARD_FEE_ICAN,
  riderCardService,
  type RequestableRider,
  type RiderCard,
} from '../services/riderCardService';

interface Props {
  // 'page' is the "My Card" tab; 'tile' is the compact entry on the Overview.
  variant?: 'page' | 'tile';
  // The signed-in rider. Needed to check the wallet balance and the transaction PIN.
  userId?: string;
  // Called after a payment goes through so the wallet balance on screen can refresh.
  onPaid?: () => void;
  // Tile only: open the My Card tab.
  onOpen?: () => void;
  // Opens the wallet — to top up when funds are short, or to see the payment afterwards.
  onGoToWallet?: () => void;
  // Page only: opens the Insurance tab (buy, renew, claims, what is shared).
  onOpenInsurance?: () => void;
}

const vehicleLabel = (type: string) => type.charAt(0).toUpperCase() + type.slice(1);

// "The database function isn't there" — i.e. the card SQL has not been run for this feature yet.
const looksNotSetUp = (message?: string | null) =>
  !!message && /could not find the function|schema cache|does not exist|PGRST202|42883/i.test(message);

const fmtIcan = (n: number) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });

// The wallet's own wording is "Insufficient ICAN. Have: 0.45714286, Need: 2.00000000".
const friendlyPayError = (message?: string) => {
  const m = message?.match(/Insufficient ICAN\. Have: ([\d.]+), Need: ([\d.]+)/i);
  return m ? `Not enough IcanEra in your wallet: you have ${fmtIcan(Number(m[1]))}, you need ${fmtIcan(Number(m[2]))}.` : message || 'Payment failed';
};

// Paying for a card goes through the rider's ICAN wallet and needs their
// transaction PIN, like every other wallet payment in the app. The PIN is
// checked first; nothing is charged until it is right.
function PayPanel({
  card, userId, autoStart, onPaid, onGoToWallet,
}: {
  card: RiderCard;
  userId?: string;
  autoStart: boolean;
  onPaid: () => void;
  onGoToWallet?: () => void;
}) {
  const [step, setStep] = useState<'idle' | 'pin'>('idle');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [needsPin, setNeedsPin] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    supabase
      .from('ican_user_wallets')
      .select('ican_balance')
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data }) => { if (!cancelled) setBalance(Number(data?.ican_balance ?? 0)); });
    return () => { cancelled = true; };
  }, [userId]);

  const short = balance !== null && balance < card.fee_ican;

  // No PIN yet -> they set one first (same prompt as the wallet page); otherwise ask for it.
  const start = useCallback(async () => {
    if (!userId) {
      toast.error('Please sign in again to pay from your wallet');
      return;
    }
    try {
      if (!(await hasPinSet(userId))) {
        setNeedsPin(true);
        return;
      }
      setStep('pin');
    } catch {
      toast.error("We couldn't check your PIN. Please try again.");
    }
  }, [userId]);

  // A card the rider has just requested goes straight to the PIN step.
  useEffect(() => {
    if (autoStart) start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pay = async () => {
    if (!userId) return;
    setBusy(true);
    try {
      const check = await verifyPin(userId, pin);
      if (!check.success) {
        toast.error(check.error || 'Incorrect PIN');
        setPin('');
        return;
      }
      const result = await riderCardService.payCard(card.card_id);
      if (result.success) {
        toast.success('Card paid. Your QR code is ready.', {
          action: onGoToWallet ? { label: 'View in wallet', onClick: onGoToWallet } : undefined,
        });
        onPaid();
      } else {
        toast.error(friendlyPayError(result.error));
      }
    } catch {
      toast.error("We couldn't complete the payment. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {needsPin && userId && (
        <SetPinPrompt
          userId={userId}
          onDone={async () => {
            setNeedsPin(false);
            try {
              if (await hasPinSet(userId)) setStep('pin');
            } catch { /* they can tap Pay again */ }
          }}
        />
      )}

      {balance !== null && (
        <p className="text-xs text-slate-500">
          Wallet balance: <span className="font-semibold text-slate-700">{fmtIcan(balance)} ICAN</span>
        </p>
      )}

      {short ? (
        <div role="alert" className="space-y-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-900 ring-1 ring-inset ring-amber-200">
          <p className="font-semibold">Your wallet doesn't have enough IcanEra for this card.</p>
          <p>
            You have {fmtIcan(balance!)} and the card costs {card.fee_ican}. Add {fmtIcan(card.fee_ican - balance!)} more, then come back to pay.
          </p>
          {onGoToWallet && (
            <button type="button" onClick={onGoToWallet} className="classic-btn classic-btn-outline !w-auto !min-h-[36px] !rounded-full !px-5 !py-1.5 !text-[13px]">
              Open wallet
            </button>
          )}
        </div>
      ) : step === 'pin' ? (
        <form
          onSubmit={(e) => { e.preventDefault(); if (validatePIN(pin) && !busy) pay(); }}
          className="space-y-3"
        >
          <div>
            <label htmlFor={`card-pin-${card.card_id}`} className="classic-label">Transaction PIN</label>
            <input
              id={`card-pin-${card.card_id}`}
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              autoFocus
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              placeholder="4–6 digit PIN"
              disabled={busy}
              className="classic-input text-center text-lg tracking-widest"
            />
            <p className="mt-1 text-[11px] text-slate-400">Enter your PIN to pay {card.fee_ican} ICAN from your wallet.</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => { setStep('idle'); setPin(''); }} disabled={busy} className="classic-btn classic-btn-outline !w-auto !flex-none !rounded-full !px-6">
              Not now
            </button>
            <button type="submit" disabled={busy || !validatePIN(pin)} className="classic-btn classic-btn-primary !rounded-full whitespace-nowrap">
              {busy ? 'Paying…' : `Pay ${card.fee_ican} ICAN`}
            </button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={start} className="classic-btn classic-btn-primary !rounded-full">
          Pay {card.fee_ican} ICAN to activate
        </button>
      )}
    </div>
  );
}

// Proof that the payment went through the wallet, once the card is active.
function PaidReceipt({ card, onGoToWallet }: { card: RiderCard; onGoToWallet?: () => void }) {
  if (!card.paid_at) return null;
  const when = new Date(card.paid_at).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
  return (
    <div className="flex items-center gap-3 rounded-xl bg-white p-3 ring-1 ring-black/5">
      <span className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-inset ring-emerald-100">
        <Receipt size={16} />
      </span>
      <p className="min-w-0 flex-1 text-xs text-slate-600">
        <span className="font-semibold text-slate-800">Paid {card.fee_ican} ICAN</span> from your wallet on {when}. It is in your wallet history as “Rider ID card”.
      </p>
      {onGoToWallet && (
        <button type="button" onClick={onGoToWallet} className="flex-shrink-0 text-xs font-semibold text-[#7a5a12] underline decoration-dotted">
          View
        </button>
      )}
    </div>
  );
}

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
export default function RiderMyCard({ variant = 'page', userId, onPaid, onOpen, onGoToWallet, onOpenInsurance }: Props) {
  const { cards, requestable, fee, loading, cardsError, requestError, reload } = useMyCards();
  const [autoStartId, setAutoStartId] = useState<string | null>(null);
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
              <InsuranceChip insurance={active.insurance} />
            </span>
          )}
          {active?.insurance?.state === 'active' && active.insurance.policies[0] && (
            <span className="mt-1 block truncate text-xs font-semibold text-emerald-700">
              🛡️ {active.insurance.policies[0].plan} · {active.insurance.policies[0].insurer}
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
      // Straight on to the payment step (the PIN); nothing is charged until it is right.
      if (result.card) setAutoStartId(result.card.card_id);
      await reload();
    } else {
      toast.error(result.error || 'Could not request the card');
    }
    setRequesting(null);
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
            if (!pending) {
              return (
                <div key={card.card_id} className="space-y-3">
                  <RiderIdCard card={card} />
                  <PaidReceipt card={card} onGoToWallet={onGoToWallet} />
                </div>
              );
            }
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
                <PayPanel
                  card={card}
                  userId={userId}
                  autoStart={autoStartId === card.card_id}
                  onPaid={() => { onPaid?.(); reload(); }}
                  onGoToWallet={onGoToWallet}
                />
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

      {/* Insurance — what the rider holds shows on the card above and on its public QR page;
          buying, renewing, claims and sharing live on the Insurance tab. */}
      {!loading && onOpenInsurance && (
        <button
          type="button"
          onClick={onOpenInsurance}
          className="classic-card flex w-full items-center gap-4 p-4 text-left transition-all hover:border-orange-300 active:scale-[0.99]"
        >
          <span className="grid h-12 w-12 flex-shrink-0 place-items-center rounded-full bg-emerald-50 ring-1 ring-inset ring-emerald-100">
            <Shield size={21} className="text-emerald-600" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-classic-display text-lg font-semibold leading-tight text-slate-800">Insurance cover</span>
            <span className="mt-0.5 block text-xs text-slate-500">
              Get insured with ICAN or reward points. Your cover shows on this card.
            </span>
          </span>
          <ArrowRight size={18} className="flex-shrink-0 text-[#c4a052]" />
        </button>
      )}
    </div>
  );
}
