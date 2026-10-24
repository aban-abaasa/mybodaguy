import { useCallback, useEffect, useRef, useState } from 'react';
import { Banknote, Bike, CheckCircle, CircleAlert, CreditCard, Loader2, LogIn, MapPin, Phone, Smartphone, Wallet, XCircle } from 'lucide-react';
import { supabase } from '../services/supabaseClient';
import type { User } from '@supabase/supabase-js';
import LocationPickerMap from './LocationPickerMap';
import type { Location } from '../data/mockLocations';
import { RIDER_CARD_RETURN_KEY } from './RiderCardGatePanel';
import { getBalance, ugxToICAN } from '../services/icanWalletService';
import { formatUgx } from '../services/riderCardService';
import {
  PAY_CHANNELS,
  cardRideService,
  cardRideTotal,
  channelLabel,
  forgetCardRide,
  isOpenStatus,
  recallCardRide,
  rememberCardRide,
  type CardRideBooked,
  type CardRidePayChannel,
  type CardRideQuote,
  type CardRideStatus,
} from '../services/riderCardRideService';

const POLL_MS = 4000;

const CHANNEL_ICON: Record<CardRidePayChannel, React.ReactNode> = {
  mobile_money: <Smartphone size={16} />,
  card: <CreditCard size={16} />,
  cash: <Banknote size={16} />,
  wallet: <Wallet size={16} />,
};

const STEPS: Array<{ key: CardRideStatus['status']; label: string }> = [
  { key: 'pending', label: 'Request sent' },
  { key: 'accepted', label: 'Rider on the way' },
  { key: 'in_progress', label: 'On your trip' },
  { key: 'completed', label: 'Arrived' },
];

const firstName = (full: string) => full.trim().split(/\s+/)[0] || 'your rider';

// Shown on the public rider-card page (what the QR on the card opens): anyone who scanned it can ask THIS rider for a ride.
// No account is needed to pay by mobile money, card or cash; the ICAN wallet needs an account and carries no transaction fee.
export default function RiderCardRidePanel({ code, riderName }: { code: string; riderName: string }) {
  const rider = firstName(riderName);
  const [user, setUser] = useState<User | null>(null);
  const [availability, setAvailability] = useState<CardRideQuote | null>(null);

  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [pickup, setPickup] = useState<Location | null>(null);
  const [dropoff, setDropoff] = useState<Location | null>(null);
  const [mapMode, setMapMode] = useState<'pickup' | 'dropoff'>('dropoff');
  const [channel, setChannel] = useState<CardRidePayChannel>('mobile_money');
  const [quote, setQuote] = useState<CardRideQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [walletIcan, setWalletIcan] = useState<number | null>(null);

  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [booked, setBooked] = useState<{ ride: CardRideBooked; token: string } | null>(null);
  const [status, setStatus] = useState<CardRideStatus | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const [signingIn, setSigningIn] = useState(false);
  const [signInEmail, setSignInEmail] = useState('');
  const [signInNotice, setSignInNotice] = useState<string | null>(null);

  // Who is looking: a person with an account or a guest.
  useEffect(() => {
    let off = false;
    supabase.auth.getUser().then(({ data }) => { if (!off) setUser(data.user ?? null); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => setUser(session?.user ?? null));
    return () => { off = true; sub.subscription.unsubscribe(); };
  }, []);

  // Is the rider free right now? Also picks up a ride this device already asked for.
  useEffect(() => {
    let off = false;
    cardRideService.quote(code).then(({ quote: q, error: err }) => {
      if (off) return;
      setAvailability(q ?? { available: false, reason: err ?? 'Could not check this rider right now.' });
    });
    const remembered = recallCardRide(code);
    if (remembered) {
      cardRideService.status(remembered.rideId, remembered.token).then(({ status: s }) => {
        if (off || !s) return;
        if (isOpenStatus(s.status)) {
          setBooked({ ride: { ride_id: remembered.rideId, token: remembered.token } as CardRideBooked, token: remembered.token });
          setStatus(s);
        } else {
          forgetCardRide();
        }
      });
    }
    return () => { off = true; };
  }, [code]);

  // Wallet balance, for people signed in.
  useEffect(() => {
    if (!user) { setWalletIcan(null); return; }
    let off = false;
    getBalance(user.id).then((b) => { if (!off) setWalletIcan(b.ican); }).catch(() => { if (!off) setWalletIcan(null); });
    return () => { off = true; };
  }, [user]);

  // A fresh price whenever both ends of the trip are set.
  useEffect(() => {
    if (!pickup || !dropoff) { setQuote(null); return; }
    let off = false;
    setQuoting(true);
    cardRideService.quote(code, pickup.coordinates, dropoff.coordinates).then(({ quote: q, error: err }) => {
      if (off) return;
      setQuote(q);
      if (err) setError(err);
      setQuoting(false);
    });
    return () => { off = true; };
  }, [code, pickup, dropoff]);

  // Follow the request until it is over.
  const pollRef = useRef<number | null>(null);
  const refresh = useCallback(async () => {
    if (!booked) return;
    const { status: s } = await cardRideService.status(booked.ride.ride_id, booked.token);
    if (s) setStatus(s);
  }, [booked]);
  useEffect(() => {
    if (!booked) return;
    void refresh();
    pollRef.current = window.setInterval(() => { void refresh(); }, POLL_MS);
    return () => { if (pollRef.current) window.clearInterval(pollRef.current); };
  }, [booked, refresh]);
  useEffect(() => {
    if (status && !isOpenStatus(status.status)) {
      if (pollRef.current) window.clearInterval(pollRef.current);
      forgetCardRide();
    }
  }, [status]);

  const signInGoogle = async () => {
    setSigningIn(true); setError(null);
    try {
      sessionStorage.setItem(RIDER_CARD_RETURN_KEY, code);
      const { error: err } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.href, queryParams: { prompt: 'select_account' } } });
      if (err) throw err;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start Google sign-in');
      setSigningIn(false);
    }
  };

  const signInEmailLink = async () => {
    const address = signInEmail.trim();
    if (!address) return;
    setSigningIn(true); setError(null); setSignInNotice(null);
    try {
      sessionStorage.setItem(RIDER_CARD_RETURN_KEY, code);
      const { error: err } = await supabase.auth.signInWithOtp({ email: address, options: { emailRedirectTo: window.location.href } });
      if (err) throw err;
      setSignInNotice(`Sign-in link sent to ${address}. Open it on this phone.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send the sign-in link');
    } finally {
      setSigningIn(false);
    }
  };

  const fee = quote?.transaction_fee ?? 0;
  const total = quote?.fare != null ? cardRideTotal(quote.fare, fee, channel) : null;
  const walletShort = channel === 'wallet' && total != null && walletIcan != null && walletIcan < ugxToICAN(total);
  const needsAccountForChannel = channel === 'wallet' && !user;
  const guestDetailsMissing = !user && (guestName.trim().length < 2 || guestPhone.replace(/\D/g, '').length < 9);
  const canSend = !!pickup && !!dropoff && quote?.available === true && quote.fare != null && !needsAccountForChannel && !guestDetailsMissing && !walletShort && !sending;

  const send = async () => {
    if (!pickup || !dropoff || !canSend) return;
    setSending(true); setError(null);
    const { ride, error: err } = await cardRideService.request({
      code,
      pickup: { label: pickup.fullAddress || pickup.name, lat: pickup.coordinates.lat, lng: pickup.coordinates.lng },
      dropoff: { label: dropoff.fullAddress || dropoff.name, lat: dropoff.coordinates.lat, lng: dropoff.coordinates.lng },
      channel,
      guestName,
      guestPhone,
    });
    setSending(false);
    if (err || !ride) { setError(err ?? 'Could not send the request'); return; }
    rememberCardRide({ code, rideId: ride.ride_id, token: ride.token });
    setStatus(null);
    setBooked({ ride, token: ride.token });
    setOpen(false);
  };

  const cancel = async () => {
    if (!booked) return;
    setCancelling(true); setError(null);
    const { error: err } = await cardRideService.cancel(booked.ride.ride_id, booked.token, 'Cancelled by the customer');
    setCancelling(false);
    if (err) { setError(err); return; }
    await refresh();
  };

  const startOver = () => { forgetCardRide(); setBooked(null); setStatus(null); setPickup(null); setDropoff(null); setQuote(null); setError(null); };

  // ── A ride is already requested: follow it ────────────────────────────────
  if (booked) {
    const s = status;
    const channelUsed = s?.payment_channel ?? booked.ride.payment_channel ?? null;
    const cancelled = s?.status === 'cancelled' || s?.status === 'failed';
    const stepIndex = s ? STEPS.findIndex((st) => st.key === s.status) : 0;
    return (
      <section className="space-y-3 border-t border-slate-100 p-5" aria-live="polite">
        <h2 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
          <Bike size={12} /> Your ride with {rider}
        </h2>

        {!s ? (
          <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={14} className="animate-spin" /> Checking your request…</p>
        ) : cancelled ? (
          <div className="rounded-xl bg-red-50 p-3 text-sm text-red-800">
            <p className="flex items-center gap-1.5 font-semibold"><XCircle size={16} /> This request was cancelled</p>
            {s.cancellation_reason && <p className="mt-1 text-xs">{s.cancellation_reason}</p>}
          </div>
        ) : (
          <ol className="space-y-1.5">
            {STEPS.map((st, i) => (
              <li key={st.key} className={`flex items-center gap-2 text-sm ${i <= stepIndex ? 'font-semibold text-emerald-700' : 'text-slate-400'}`}>
                {i <= stepIndex ? <CheckCircle size={16} /> : <span className="inline-block h-4 w-4 rounded-full border border-slate-300" />}
                {st.label}
                {i === stepIndex && s.status === 'pending' && <Loader2 size={12} className="animate-spin text-slate-400" />}
              </li>
            ))}
          </ol>
        )}

        {s && (
          <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
            <p className="flex gap-1.5"><MapPin size={13} className="mt-0.5 shrink-0 text-emerald-600" /> {s.pickup_location}</p>
            <p className="mt-1 flex gap-1.5"><MapPin size={13} className="mt-0.5 shrink-0 text-red-500" /> {s.dropoff_location}</p>
          </div>
        )}

        {s && !cancelled && (
          <div className="rounded-xl border border-slate-200 p-3 text-sm">
            <p className="text-xs text-slate-500">
              {s.status === 'completed'
                ? 'Trip total'
                : s.fee_waived
                  ? `From your ICAN wallet when the trip ends`
                  : `Pay ${rider} by ${channelLabel(channelUsed).toLowerCase()}`}
            </p>
            <p className="text-2xl font-extrabold text-slate-900">{formatUgx(s.customer_total)}</p>
            <p className="text-[11px] text-slate-500">
              Fare {formatUgx(s.fare)}
              {s.fee_waived ? ' · no transaction fee with your ICAN wallet' : ` + transaction fee ${formatUgx(s.platform_charge)}`}
            </p>
          </div>
        )}

        {s && isOpenStatus(s.status) && s.status !== 'in_progress' && (
          <button type="button" onClick={cancel} disabled={cancelling} className="w-full rounded-xl py-2 text-sm text-slate-500 hover:text-slate-700 disabled:opacity-50">
            {cancelling ? 'Cancelling…' : 'Cancel this request'}
          </button>
        )}
        {s && !isOpenStatus(s.status) && (
          <button type="button" onClick={startOver} className="w-full rounded-xl bg-slate-900 py-3 text-sm font-semibold text-white">
            Book another ride
          </button>
        )}
        {error && <p role="alert" className="rounded-lg bg-red-50 p-2 text-xs text-red-700">{error}</p>}
      </section>
    );
  }

  // ── Not available ─────────────────────────────────────────────────────────
  if (availability && !availability.available) {
    return (
      <section className="space-y-2 border-t border-slate-100 p-5">
        <h2 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400"><Bike size={12} /> Ride with {rider}</h2>
        <p className="flex items-start gap-1.5 text-sm text-slate-600"><CircleAlert size={16} className="mt-0.5 shrink-0 text-amber-600" /> {availability.reason}</p>
      </section>
    );
  }

  // ── Not started yet: one button, the form opens under it ──────────────────
  if (!open) {
    return (
      <section className="space-y-2 border-t border-slate-100 p-5">
        <h2 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400"><Bike size={12} /> Ride with {rider}</h2>
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={!availability}
          className="w-full rounded-xl bg-amber-500 py-3 text-sm font-bold text-white hover:bg-amber-600 disabled:opacity-50"
        >
          {availability ? `Request a ride with ${rider}` : 'Checking if the rider is free…'}
        </button>
        <p className="text-center text-[11px] text-slate-500">No account needed. Pay by mobile money, card or cash, or with an ICAN wallet account and no transaction fee.</p>
      </section>
    );
  }

  // ── The request form ──────────────────────────────────────────────────────
  return (
    <section className="space-y-4 border-t border-slate-100 p-5">
      <h2 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400"><Bike size={12} /> Ride with {rider}</h2>

      {!user && (
        <div className="grid gap-2">
          <label className="text-xs font-medium text-slate-600">
            Your name
            <input value={guestName} onChange={(e) => setGuestName(e.target.value)} maxLength={80} autoComplete="name"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="So the rider knows who to look for" />
          </label>
          <label className="text-xs font-medium text-slate-600">
            Phone number
            <span className="relative mt-1 block">
              <Phone size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} inputMode="tel" autoComplete="tel" maxLength={24}
                className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm" placeholder="07XX XXX XXX" />
            </span>
          </label>
        </div>
      )}

      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 text-xs font-semibold" role="tablist" aria-label="Set on the map">
          {(['pickup', 'dropoff'] as const).map((m) => (
            <button key={m} type="button" role="tab" aria-selected={mapMode === m} onClick={() => setMapMode(m)}
              className={`rounded-md py-1.5 ${mapMode === m ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
              {m === 'pickup' ? (pickup ? 'Pickup ✓' : 'Set pickup') : (dropoff ? 'Drop-off ✓' : 'Set drop-off')}
            </button>
          ))}
        </div>
        <LocationPickerMap
          pickup={pickup}
          dropoff={dropoff}
          onPickupChange={(l) => { setPickup(l); if (!dropoff) setMapMode('dropoff'); }}
          onDropoffChange={setDropoff}
          selectionMode={mapMode}
          height={260}
        />
        {pickup && <p className="flex gap-1.5 text-xs text-slate-600"><MapPin size={13} className="mt-0.5 shrink-0 text-emerald-600" /> {pickup.fullAddress}</p>}
        {dropoff && <p className="flex gap-1.5 text-xs text-slate-600"><MapPin size={13} className="mt-0.5 shrink-0 text-red-500" /> {dropoff.fullAddress}</p>}
      </div>

      <fieldset className="space-y-2">
        <legend className="mb-1 text-xs font-medium text-slate-600">How will you pay?</legend>
        <div className="grid grid-cols-2 gap-2" role="radiogroup">
          {PAY_CHANNELS.map((c) => (
            <button key={c.id} type="button" role="radio" aria-checked={channel === c.id} onClick={() => setChannel(c.id)}
              className={`rounded-xl border p-2.5 text-left ${channel === c.id ? 'border-amber-500 bg-amber-50' : 'border-slate-200 bg-white'}`}>
              <span className={`flex items-center gap-1.5 text-sm font-semibold ${channel === c.id ? 'text-amber-800' : 'text-slate-700'}`}>{CHANNEL_ICON[c.id]} {c.label}</span>
              <span className="mt-0.5 block text-[10px] leading-snug text-slate-500">{c.id === 'wallet' && user ? 'No transaction fee' : c.hint}</span>
            </button>
          ))}
        </div>
      </fieldset>

      {needsAccountForChannel && (
        <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <p className="font-semibold">Sign in to pay from your ICAN wallet and skip the transaction fee.</p>
          <button type="button" onClick={signInGoogle} disabled={signingIn}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">
            <LogIn size={14} /> {signingIn ? 'Opening Google…' : 'Continue with Google'}
          </button>
          <div className="flex gap-2">
            <input type="email" value={signInEmail} onChange={(e) => setSignInEmail(e.target.value)} placeholder="or get a sign-in link by email"
              className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <button type="button" onClick={signInEmailLink} disabled={signingIn || !signInEmail.trim()}
              className="rounded-lg bg-slate-900 px-3 text-sm font-semibold text-white disabled:opacity-50">Send</button>
          </div>
          {signInNotice && <p className="text-emerald-800">{signInNotice}</p>}
          <p>No account yet? Signing in creates one for free. Or just choose another way to pay above.</p>
        </div>
      )}

      {pickup && dropoff && (
        <div className="rounded-xl bg-slate-50 p-3 text-sm" aria-live="polite">
          {quoting || !quote ? (
            <p className="flex items-center gap-2 text-slate-500"><Loader2 size={14} className="animate-spin" /> Working out the fare…</p>
          ) : !quote.available || quote.fare == null ? (
            <p className="text-amber-800">{quote.reason ?? 'Could not price this trip.'}</p>
          ) : (
            <>
              <p className="text-xs text-slate-500">{quote.distance_km} km · about {quote.duration_min} min</p>
              <dl className="mt-1 space-y-0.5 text-xs text-slate-600">
                <div className="flex justify-between"><dt>Fare (all goes to {rider})</dt><dd>{formatUgx(quote.fare)}</dd></div>
                <div className="flex justify-between">
                  <dt>Transaction fee{channel !== 'wallet' && quote.fee_pct != null ? ` (${quote.fee_pct}%)` : ''}</dt>
                  <dd className={channel === 'wallet' ? 'font-semibold text-emerald-700' : ''}>{channel === 'wallet' ? 'None' : formatUgx(fee)}</dd>
                </div>
              </dl>
              <p className="mt-1.5 flex items-baseline justify-between border-t border-slate-200 pt-1.5">
                <span className="text-xs text-slate-500">You pay</span>
                <span className="text-xl font-extrabold text-slate-900">{total != null ? formatUgx(total) : '—'}</span>
              </p>
              {channel !== 'wallet' && <p className="mt-1 text-[11px] text-slate-500">Pay {rider} by {channelLabel(channel).toLowerCase()} when you meet. Use an ICAN wallet account to ride without the fee.</p>}
              {channel === 'wallet' && walletIcan != null && (
                <p className={`mt-1 text-[11px] ${walletShort ? 'text-red-700' : 'text-slate-500'}`}>
                  {walletShort ? `Your wallet has ${walletIcan.toFixed(2)} ICAN, not enough for this trip. Top up or choose another way to pay.` : `Wallet balance ${walletIcan.toFixed(2)} ICAN`}
                </p>
              )}
            </>
          )}
        </div>
      )}

      <button type="button" onClick={send} disabled={!canSend}
        className="w-full rounded-xl bg-amber-500 py-3 text-sm font-bold text-white hover:bg-amber-600 disabled:opacity-50">
        {sending ? 'Sending request…' : `Send request to ${rider}`}
      </button>
      {guestDetailsMissing && pickup && dropoff && <p className="text-center text-[11px] text-slate-500">Add your name and phone number above so {rider} can reach you.</p>}
      {error && <p role="alert" className="rounded-lg bg-red-50 p-2 text-xs text-red-700">{error}</p>}
    </section>
  );
}
