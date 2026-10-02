import { useEffect, useState } from 'react';
import { CheckCircle, XCircle, AlertTriangle, Clock, Plane, ShieldCheck, Ship, Truck } from 'lucide-react';
import { supabase } from '../services/supabaseClient';
import { describeCarrier, type ShipTicketProof } from '../services/printTicket';

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
  const [ship, setShip] = useState<ShipTicketProof | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc('mbg_verify_air_ticket', { p_code: code });
      if (cancelled) return;
      // A server error is not the same as "no such ticket" — say which it is.
      if (error) { setLoadError(error.message); return; }
      const air = (data as TicketProof) ?? { is_valid: false };
      if (air.is_valid || air.state) { setResult(air); return; }

      // Not an air ticket — the same QR scheme is used by ship waybills.
      const { data: shipData, error: shipError } = await supabase.rpc('mbg_verify_ship_ticket', { p_code: code });
      if (cancelled) return;
      // A missing ship check (SQL not run yet) just means "not a ship ticket"; any other error is a real failure.
      if (shipError && !/mbg_verify_ship_ticket/.test(shipError.message)) { setLoadError(shipError.message); return; }
      const proof = shipError ? null : (shipData as ShipTicketProof | null);
      if (proof?.is_ship) setShip(proof);
      else setResult(air);
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
        ) : ship ? (
          <ShipProofCard proof={ship} />
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

const SHIP_TONE: Record<string, { icon: JSX.Element; cls: string; title: string; sub: string }> = {
  booked: { icon: <CheckCircle size={44} />, cls: 'text-emerald-600', title: 'Genuine waybill — paid', sub: 'This shipment is paid and recorded in the BodaGoEra booking record.' },
  in_transit: { icon: <CheckCircle size={44} />, cls: 'text-emerald-600', title: 'Genuine waybill — in transit', sub: 'This shipment is paid and on its way.' },
  delivered: { icon: <CheckCircle size={44} />, cls: 'text-slate-600', title: 'Genuine waybill — delivered', sub: 'This shipment was paid and has been delivered.' },
  cancelled: { icon: <XCircle size={44} />, cls: 'text-red-600', title: 'Waybill cancelled', sub: 'This shipment was cancelled or refunded. Do not accept it.' },
  unpaid: { icon: <AlertTriangle size={44} />, cls: 'text-amber-600', title: 'Not paid', sub: 'No payment is recorded for this shipment.' },
};

// What scanning the QR on a printed ship waybill shows: the live answer of
// mbg_verify_ship_ticket — whether the shipment is really paid, who carries each
// leg and its state. Masked: no customer details, only the last 8 characters of
// the payment reference.
function ShipProofCard({ proof }: { proof: ShipTicketProof }) {
  const tone = SHIP_TONE[proof.state || 'unpaid'] ?? SHIP_TONE.unpaid;
  const legs = proof.legs ?? [];
  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
      <div className={`flex flex-col items-center gap-1 px-5 py-6 text-center ${tone.cls}`}>
        {tone.icon}
        <h1 className="text-xl font-bold">{tone.title}</h1>
        <p className="text-sm text-slate-600">{tone.sub}</p>
      </div>
      <div className="space-y-4 border-t border-slate-100 p-5 text-sm text-slate-700">
        <div className="flex items-center justify-between">
          <span className="text-lg font-bold text-slate-800">{proof.origin_country}</span>
          <Ship className="text-slate-400" size={22} />
          <span className="text-lg font-bold text-slate-800">{proof.destination_country}</span>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <div>
            <dt className="text-[11px] font-semibold uppercase text-slate-400">Waybill no.</dt>
            <dd className="font-mono font-medium">{proof.waybill_no}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase text-slate-400">Payment</dt>
            <dd className="font-medium">
              {proof.paid ? `Paid${proof.paid_via === 'company' ? ' by company' : ''}` : 'Not recorded'}
              {proof.payment_reference && <span className="block font-mono text-xs text-slate-500">ref {proof.payment_reference}</span>}
            </dd>
          </div>
          <div className="col-span-2">
            <dt className="text-[11px] font-semibold uppercase text-slate-400">Cargo</dt>
            <dd className="font-medium">
              {proof.cargo_description || '—'}
              {proof.cargo_weight_kg != null && <span className="text-slate-500"> · {Number(proof.cargo_weight_kg).toLocaleString()} kg</span>}
            </dd>
          </div>
        </dl>

        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase text-slate-400">Carriers</p>
          <ul className="space-y-2">
            {legs.map((l, i) => (
              <li key={i} className="flex items-start gap-2 rounded-lg bg-slate-50 p-2.5 text-xs">
                {l.type === 'sea_leg' ? <Ship size={15} className="mt-0.5 shrink-0 text-slate-500" /> : <Truck size={15} className="mt-0.5 shrink-0 text-slate-500" />}
                <div className="min-w-0">
                  <p className="font-semibold text-slate-700">{l.type === 'sea_leg' ? 'Sea' : 'Road'}: {l.from} → {l.to}</p>
                  <p className="text-slate-500">
                    {describeCarrier(l)}
                    {' · '}<span className="capitalize">{l.status.replace(/_/g, ' ')}</span>
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="border-t border-slate-100 pt-3 text-[11px] text-slate-400">
          Booked {fmt(proof.booked_at)}. Checked live just now against the BodaGoEra record.
        </p>
      </div>
    </div>
  );
}
