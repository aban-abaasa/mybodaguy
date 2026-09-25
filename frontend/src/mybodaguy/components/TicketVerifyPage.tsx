import { useEffect, useState } from 'react';
import { CheckCircle, XCircle, AlertTriangle, Clock, Plane, ShieldCheck } from 'lucide-react';
import { supabase } from '../services/supabaseClient';

interface TicketProof {
  is_valid: boolean;
  state?: 'valid' | 'flown' | 'cancelled' | 'pending';
  flight_status?: string;
  passengers?: string[];
  booking_reference_masked?: string;
  carrier?: string | null;
  flight_number?: string | null;
  origin_iata?: string | null;
  destination_iata?: string | null;
  departs_at?: string | null;
  arrives_at?: string | null;
  is_rescheduled?: boolean;
  paid?: boolean;
  booked_at?: string;
}

const fmt = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'To be confirmed';

// Public, unauthenticated page for https://bodagoera.icanera.space/ticket/<code>
// — what scanning the QR on an air ticket PDF opens. It asks the database
// live (mbg_verify_air_ticket, GRANT'd to anon), so a cancelled booking stops
// verifying and a rescheduled flight shows its new time. Only masked details
// come back: never passport data, the full booking reference or payment ids.
export default function TicketVerifyPage({ code }: { code: string }) {
  const [result, setResult] = useState<TicketProof | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc('mbg_verify_air_ticket', { p_code: code });
      if (cancelled) return;
      // A server error is not the same as "no such ticket" — say which it is.
      if (error) setLoadError(error.message);
      else setResult((data as TicketProof) ?? { is_valid: false });
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  const state = result?.state;
  const tone =
    state === 'valid' ? { icon: <CheckCircle size={44} />, cls: 'text-emerald-600', title: 'Genuine ticket', sub: 'This air ticket is confirmed in the BodaGoEra booking record.' }
    : state === 'flown' ? { icon: <CheckCircle size={44} />, cls: 'text-slate-600', title: 'Genuine ticket — flight completed', sub: 'This ticket was valid and the flight has been flown.' }
    : state === 'cancelled' ? { icon: <XCircle size={44} />, cls: 'text-red-600', title: 'Ticket cancelled', sub: 'This booking was cancelled. Do not accept it as a valid ticket.' }
    : state === 'pending' ? { icon: <Clock size={44} />, cls: 'text-amber-600', title: 'Awaiting airline confirmation', sub: 'The booking exists but the airline has not confirmed it yet.' }
    : { icon: <XCircle size={44} />, cls: 'text-red-600', title: 'Not a valid ticket', sub: 'No ticket matches this code. It may be forged or mistyped.' };

  return (
    <div className="min-h-screen bg-[#f7f1e3] px-4 py-8">
      <div className="mx-auto max-w-md space-y-4">
        <div className="flex items-center justify-center gap-2 text-sm font-semibold text-[#5c4410]">
          <ShieldCheck size={18} /> BodaGoEra ticket check
        </div>

        {loadError ? (
          <div role="alert" className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-center text-sm text-amber-900">
            <AlertTriangle className="mx-auto mb-2" size={28} />
            <p className="font-semibold">We couldn't check this ticket right now.</p>
            <p className="mt-1">This is a connection problem, not a verdict on the ticket. Please try again in a moment.</p>
          </div>
        ) : !result ? (
          <div role="status" className="rounded-2xl bg-white p-8 text-center text-sm text-slate-500 shadow-sm">Checking ticket…</div>
        ) : (
          <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
            <div className={`flex flex-col items-center gap-1 px-5 py-6 text-center ${tone.cls}`}>
              {tone.icon}
              <h1 className="text-xl font-bold">{tone.title}</h1>
              <p className="text-sm text-slate-600">{tone.sub}</p>
            </div>

            {result.origin_iata && (
              <div className="space-y-4 border-t border-slate-100 p-5 text-sm text-slate-700">
                <div className="flex items-center justify-between">
                  <span className="text-3xl font-bold tracking-wide text-slate-800">{result.origin_iata}</span>
                  <Plane className="text-slate-400" size={22} />
                  <span className="text-3xl font-bold tracking-wide text-slate-800">{result.destination_iata}</span>
                </div>
                <div className="text-center text-xs text-slate-500">
                  {[result.carrier, result.flight_number].filter(Boolean).join(' · ')}
                </div>

                {result.is_rescheduled && (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                    The airline has changed this flight's time. The times below are the latest.
                  </div>
                )}

                <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <div>
                    <dt className="text-[11px] font-semibold uppercase text-slate-400">Departs</dt>
                    <dd className="font-medium">{fmt(result.departs_at)}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-semibold uppercase text-slate-400">Arrives</dt>
                    <dd className="font-medium">{fmt(result.arrives_at)}</dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-[11px] font-semibold uppercase text-slate-400">{(result.passengers?.length ?? 0) > 1 ? 'Passengers' : 'Passenger'}</dt>
                    <dd className="font-medium">{result.passengers?.join(', ') || '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-semibold uppercase text-slate-400">Booking ref</dt>
                    <dd className="font-mono font-medium">{result.booking_reference_masked || '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-semibold uppercase text-slate-400">Payment</dt>
                    <dd className="font-medium">{result.paid ? 'Paid' : 'Not recorded'}</dd>
                  </div>
                </dl>

                <p className="border-t border-slate-100 pt-3 text-[11px] text-slate-400">
                  Booked {fmt(result.booked_at)}. Checked live just now. Match the passenger name against their passport;
                  the full booking reference is only shown on the ticket itself.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
