import { useEffect, useMemo, useState } from 'react';
import { Bike, CheckCircle, Clock, MapPin, Package, ShieldCheck, XCircle } from 'lucide-react';
import { supabase } from '../services/supabaseClient';
import {
  canBook, findRidersArgs, minutesLeft, rideRequestArgs, statusLine,
  type BookingIntent, type PaymentMethod,
} from '../services/eraBooking';

// Where we come back to after Google sign-in (see the matching fallback in main.tsx).
export const BOOK_RETURN_CODE_KEY = 'icanera_book_return_code';

const ugx = (n?: number) => (n == null ? 'n/a' : `UGX ${Math.round(n).toLocaleString('en-UG')}`);

/**
 * https://bodagoera.icanera.space/book/<code>
 *
 * A business asked for a ride or delivery through the Era API. Nothing has been dispatched and nothing has been
 * charged: the CUSTOMER opens this link, signs in, reviews the quote and books it with their own session, wallet
 * and rider matching, exactly as if they had used the app. The price comes from the app's own fare maths when the
 * ride is created; the business cannot set it. Database side: era_api_booking_intent_get / _link / _cancel
 * (ICAN/supabase/migrations/20261006100000_era_api_business.sql).
 */
export default function BookingConfirmPage({ code }: { code: string }) {
  const [intent, setIntent] = useState<BookingIntent | null>(null);
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'book' | 'cancel' | 'google' | null>(null);
  const [payment, setPayment] = useState<PaymentMethod>('wallet');
  const [fare, setFare] = useState<number | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const load = async () => {
    const { data, error: err } = await supabase.rpc('era_api_booking_intent_get', { p_code: code });
    if (err) {
      if (err.code === '42501') { setNeedsSignIn(true); setIntent(null); setError(null); }
      else { setError(err.code === 'P0002' ? 'That booking link is not valid.' : err.message); setIntent(null); }
    } else { setNeedsSignIn(false); setError(null); setIntent(data as BookingIntent); }
    setLoading(false);
  };

  useEffect(() => {
    let off = false;
    supabase.auth.getUser().then(({ data }) => { if (!off) setSignedIn(!!data.user); });
    void load();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => { setSignedIn(!!session?.user); window.setTimeout(() => { void load(); }, 0); });
    const t = window.setInterval(() => setTick((n) => n + 1), 30000);
    return () => { off = true; sub.subscription.unsubscribe(); window.clearInterval(t); };
  }, [code]);

  const open = useMemo(() => canBook(intent), [intent, tick]);

  const signIn = async () => {
    setBusy('google');
    try {
      sessionStorage.setItem(BOOK_RETURN_CODE_KEY, code);
      const { error: err } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.href } });
      if (err) throw err;
    } catch (e: any) { setError(e.message || 'Could not start Google sign-in'); setBusy(null); }
  };

  const book = async () => {
    if (!intent || !open) return;
    setBusy('book'); setError(null); setWarning(null);
    try {
      const found = await supabase.rpc('mbg_find_available_riders', findRidersArgs(intent));
      if (found.error) throw found.error;
      const riders = (found.data || []) as Array<{ rider_id: string }>;
      if (!riders.length) throw new Error('No riders are available right now. Please try again in a few minutes; this link stays open until it expires.');

      const made = await supabase.rpc('mbg_request_ride', rideRequestArgs(intent, riders[0].rider_id, payment));
      if (made.error) throw made.error;
      if (!made.data?.success) throw new Error(made.data?.error || 'Could not create the request');
      const rideId = made.data.ride_id as string;
      setFare(typeof made.data.fare === 'number' ? made.data.fare : null);

      // Same server-owned dispatch cascade the app's "Just Send" uses.
      void supabase.rpc('mbg_mark_ride_auto_dispatch', { p_ride_id: rideId, p_vehicle_types: null });

      // Tell the business its request was booked. The ride exists either way, so a failure here is a note, not an error.
      const linked = await supabase.rpc('era_api_booking_intent_link', { p_code: code, p_ride_id: rideId });
      if (linked.error) setWarning('Your ride is booked, but we could not update the business. They can still see it from you.');
      await load();
    } catch (e: any) {
      setError(e?.message || 'Could not book this right now');
    } finally { setBusy(null); }
  };

  const cancel = async () => {
    setBusy('cancel'); setError(null);
    const { error: err } = await supabase.rpc('era_api_booking_intent_cancel', { p_code: code });
    if (err) setError(err.message);
    await load();
    setBusy(null);
  };

  const Icon = intent?.kind === 'delivery' ? Package : Bike;
  const q = intent?.quote || null;

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-6 max-w-md w-full text-slate-800">
        {loading ? (
          <p className="text-slate-500 py-10 text-center">Opening your booking request…</p>
        ) : needsSignIn || (!intent && !error) ? (
          <div className="text-center">
            <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4"><ShieldCheck className="text-amber-600" size={32} /></div>
            <h1 className="text-xl font-bold mb-1">Sign in to see this request</h1>
            <p className="text-slate-500 text-sm">A business asked for a ride or delivery. Sign in to review it. Nothing is booked or charged until you confirm.</p>
            <button onClick={signIn} disabled={busy === 'google' || signedIn} className="mt-4 w-full py-3 bg-white border-2 border-slate-300 text-slate-700 font-semibold rounded-xl hover:bg-slate-50 disabled:opacity-50">
              {busy === 'google' ? 'Redirecting to Google…' : 'Continue with Google'}
            </button>
          </div>
        ) : !intent ? (
          <div className="text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4"><XCircle className="text-red-500" size={32} /></div>
            <h1 className="text-xl font-bold mb-1">Can't open this request</h1>
            <p className="text-slate-500 text-sm">{error}</p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center"><Icon className="text-amber-600" size={26} /></div>
              <div>
                <h1 className="text-lg font-bold leading-tight">{intent.kind === 'delivery' ? 'Delivery' : 'Ride'} request</h1>
                <p className="text-xs text-slate-500">from {intent.requested_by || 'a business'} · code {intent.code.slice(0, 6)}…</p>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 p-3 text-sm space-y-2 mb-3">
              <div className="flex gap-2"><MapPin size={16} className="text-emerald-600 mt-0.5 shrink-0" /><div><span className="text-slate-400 text-xs block">Pickup</span>{intent.pickup.label || 'Pickup point'}</div></div>
              <div className="flex gap-2"><MapPin size={16} className="text-red-500 mt-0.5 shrink-0" /><div><span className="text-slate-400 text-xs block">Drop-off</span>{intent.dropoff.label || 'Drop-off point'}</div></div>
              {intent.notes && <p className="text-slate-500 text-xs border-t pt-2">Note: {intent.notes}</p>}
            </div>

            <div className="rounded-xl bg-slate-50 p-3 mb-3 text-center">
              <p className="text-xs text-slate-500">Estimated fare{q?.time_multiplier && q.time_multiplier > 1 ? ` (includes ${q.multiplier_reason || 'peak time'})` : ''}</p>
              <p className="text-2xl font-extrabold">{ugx(fare ?? q?.total_ugx)}</p>
              <p className="text-xs text-slate-400">{q?.distance_km ? `${q.distance_km} km · about ${q.duration_min} min` : ''}</p>
              <p className="text-[11px] text-slate-400 mt-1">The final fare is set by BodaGoEra when you book, never by the business.</p>
            </div>

            <p className={`text-sm flex items-center gap-2 mb-3 ${intent.status === 'booked' ? 'text-emerald-700' : 'text-slate-600'}`}>
              {intent.status === 'booked' ? <CheckCircle size={16} /> : intent.status === 'awaiting_confirmation' ? <Clock size={16} /> : <XCircle size={16} />}
              {statusLine(intent)}
            </p>

            {open && (
              <>
                <div className="grid grid-cols-2 gap-2 mb-3" role="radiogroup" aria-label="How will you pay?">
                  {(['wallet', 'cash'] as PaymentMethod[]).map((m) => (
                    <button key={m} role="radio" aria-checked={payment === m} onClick={() => setPayment(m)} className={`py-2 rounded-lg border text-sm font-medium ${payment === m ? 'border-amber-500 bg-amber-50 text-amber-800' : 'border-slate-200 text-slate-600'}`}>
                      {m === 'wallet' ? 'ICAN wallet' : 'Cash'}
                    </button>
                  ))}
                </div>
                <button onClick={book} disabled={!!busy} className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl disabled:opacity-50">
                  {busy === 'book' ? 'Finding your rider…' : `Book it · ${minutesLeft(intent.expires_at)} min left`}
                </button>
                <button onClick={cancel} disabled={!!busy} className="w-full mt-2 py-2 text-sm text-slate-500 hover:text-slate-700 disabled:opacity-50">Not now, cancel this request</button>
              </>
            )}

            {intent.status === 'booked' && <a href="/" className="block mt-2 text-center w-full py-3 bg-slate-900 text-white font-semibold rounded-xl">Open BodaGoEra</a>}
            {warning && <p className="mt-3 text-xs text-amber-700 bg-amber-50 rounded-lg p-2">{warning}</p>}
            {error && <p className="mt-3 text-xs text-red-700 bg-red-50 rounded-lg p-2" role="alert">{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}
