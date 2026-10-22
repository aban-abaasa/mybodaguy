import { useEffect, useState } from 'react';
import { Loader2, ShieldAlert } from 'lucide-react';
import { supabase } from '../services/supabaseClient';
import { formatUgx } from '../services/riderCardService';
import { gateStaffService, type GateRecord, type IncidentKind, type StaffIncident } from '../services/gateStaffService';

export const INCIDENT_LABEL: Record<IncidentKind, string> = {
  forced_entry: 'Went in by force',
  left_without_clearing: 'Left without paying',
};

const fmtDay = (day: string) => {
  const d = new Date(`${day}T12:00:00`);
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
};

// A rider who goes in by force keeps it on his record, publicly. This is that record, on the page the card's QR opens: every time a
// gate reported that the vehicle went into a restricted area without paying, or left owing money, with the date, the area and the
// organisation, and whether it was settled. Paying settles it but does not remove it; only a manager of the organisation that recorded
// it can withdraw a line that was recorded in error. Never shown: who recorded it, their note, the amount. Hidden entirely for a rider
// with a clean record, and if the SQL has not been run yet.
//
// Signed-in staff of the organisation that recorded a line also get it with its private details, and the buttons they are allowed.
export default function RiderGateRecord({ code, reloadKey = 0 }: { code: string; reloadKey?: number }) {
  const [record, setRecord] = useState<GateRecord | null>(null);
  const [mine, setMine] = useState<StaffIncident[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  // a sign-in or sign-out changes what the business may see
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange(() => setVersion((n) => n + 1));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await gateStaffService.getRecord(code);
      if (!cancelled) setRecord(res.data);
    })();
    return () => { cancelled = true; };
  }, [code, reloadKey, version]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) { if (!cancelled) setMine([]); return; }
      const res = await gateStaffService.staffIncidents(code);
      if (!cancelled) setMine(res.data ?? []);
    })();
    return () => { cancelled = true; };
  }, [code, reloadKey, version]);

  const settle = async (incident: StaffIncident) => {
    if (!window.confirm('Mark this as settled?\n\nIt stays on the rider\'s record, marked settled, and the rider is told.')) return;
    setBusyId(incident.id); setError(null);
    const res = await gateStaffService.resolve(incident.id, 'settled');
    setBusyId(null);
    if (res.error) { setError(res.error); return; }
    setVersion((n) => n + 1);
  };

  const withdraw = async (incident: StaffIncident) => {
    const why = window.prompt('This takes the line off the rider\'s public record, for a report that should not have been made.\n\nWhy was it recorded in error? (Kept in your audit trail, not shown publicly.)');
    if (why === null) return;
    setBusyId(incident.id); setError(null);
    const res = await gateStaffService.resolve(incident.id, 'withdrawn', why);
    setBusyId(null);
    if (res.error) { setError(res.error); return; }
    setVersion((n) => n + 1);
  };

  const incidents = record?.incidents ?? [];
  if (incidents.length === 0 && mine.length === 0) return null;
  const open = record?.open ?? 0;
  const total = (record?.forced_entries ?? 0) + (record?.left_without_clearing ?? 0);

  return (
    <section aria-label="Gate record" className="space-y-3 border-t border-slate-100 p-5">
      {incidents.length > 0 && (
        <>
          <h2 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
            <ShieldAlert size={12} /> Gate record
          </h2>
          <div className={`space-y-0.5 rounded-xl border p-3.5 ${open > 0 ? 'border-red-300 bg-red-50 text-red-900' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>
            <p className="text-sm font-bold">
              On record: {total} {total === 1 ? 'time' : 'times'} this rider went in by force or left without paying
            </p>
            <p className="text-xs">
              {record?.forced_entries ? `Went in by force: ${record.forced_entries}. ` : ''}
              {record?.left_without_clearing ? `Left without paying: ${record.left_without_clearing}. ` : ''}
              {open > 0 ? `${open} not settled.` : 'All settled.'}
            </p>
          </div>
          <ul className="space-y-2">
            {incidents.map((incident, index) => (
              <li key={`${incident.date}-${incident.zone_name}-${index}`} className="flex items-start justify-between gap-3 text-sm">
                <span className="min-w-0">
                  <span className="block font-semibold text-slate-800">{INCIDENT_LABEL[incident.kind]}</span>
                  <span className="block text-slate-600">
                    {incident.zone_name}
                    {incident.organisation && incident.organisation.trim().toLowerCase() !== incident.zone_name.trim().toLowerCase() ? ` · ${incident.organisation}` : ''}
                  </span>
                  <span className="block text-xs text-slate-500">{fmtDay(incident.date)}</span>
                </span>
                <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
                  incident.status === 'open' ? 'border-red-300 bg-red-50 text-red-800' : 'border-emerald-300 bg-emerald-50 text-emerald-800'}`}>
                  {incident.status === 'open' ? 'Not settled' : 'Settled'}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-slate-400">
            Recorded by the gate of each area. Paying settles a line, it does not remove it. A line recorded in error can be withdrawn by that organisation.
          </p>
        </>
      )}

      {mine.length > 0 && (
        <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3.5">
          <p className="text-xs font-semibold text-slate-600">Your organisation&apos;s records on this rider (details are private to you)</p>
          {mine.map((incident) => (
            <div key={incident.id} className="space-y-1 border-t border-slate-200 pt-2 first:border-t-0 first:pt-0">
              <p className="text-sm font-semibold text-slate-800">
                {INCIDENT_LABEL[incident.kind]} · {incident.zone_name}
                <span className="ml-2 text-xs font-normal text-slate-500">{incident.status === 'open' ? 'not settled' : 'settled'}</span>
              </p>
              <p className="text-xs text-slate-500">
                {new Date(incident.reported_at).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })}{incident.reported_by ? ` · recorded by ${incident.reported_by}` : ''}
                {incident.owed_ugx > 0 ? ` · ${formatUgx(incident.owed_ugx)} avoided` : ''}
              </p>
              {incident.note && <p className="text-xs italic text-slate-600">&ldquo;{incident.note}&rdquo;</p>}
              {(incident.can_settle || incident.can_withdraw) && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {incident.can_settle && (
                    <button type="button" onClick={() => settle(incident)} disabled={busyId === incident.id}
                      className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-60">
                      {busyId === incident.id ? <Loader2 size={14} className="animate-spin" /> : 'Mark settled'}
                    </button>
                  )}
                  {incident.can_withdraw && (
                    <button type="button" onClick={() => withdraw(incident)} disabled={busyId === incident.id}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-60">
                      Withdraw: recorded in error
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
          {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
        </div>
      )}
    </section>
  );
}
