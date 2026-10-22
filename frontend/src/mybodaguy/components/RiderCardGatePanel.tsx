import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Banknote, CheckCircle, Clock, Loader2, LogIn, LogOut, MapPin, ShieldCheck, XCircle } from 'lucide-react';
import { supabase } from '../services/supabaseClient';
import { formatUgx } from '../services/riderCardService';
import {
  gateStaffService,
  type GatePeek,
  type GateScanResult,
  type GateVisitView,
  type GateZone,
  type IncidentKind,
} from '../services/gateStaffService';

// sessionStorage key used to find our way back to this exact /rider-card/<code> page after bouncing out to Google (or an
// email link) to sign in — see main.tsx's matching fallback, the same reason as the receipt-approve page's.
export const RIDER_CARD_RETURN_KEY = 'icanera_rider_card_return_code';

const ZONE_KEY = 'bodagoera_gate_zone';
const GATE_KEY = 'bodagoera_gate_name';
const POLL_MS = 3000;

const remembered = (key: string) => { try { return localStorage.getItem(key) || ''; } catch { return ''; } };
const remember = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* private mode: it just is not remembered */ } };

const TONE = {
  ok: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  warn: 'border-amber-300 bg-amber-50 text-amber-900',
  bad: 'border-red-300 bg-red-50 text-red-900',
  info: 'border-sky-300 bg-sky-50 text-sky-900',
} as const;
type Tone = keyof typeof TONE;

const plateKey = (plate?: string | null) => (plate || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const kindLabel = (k?: string | null) => (k === 'motorcycle' ? 'Boda' : k === 'tuktuk' ? 'Tuktuk' : k ? k.charAt(0).toUpperCase() + k.slice(1) : 'Vehicle');
const clock = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');

// What the preview says, as a headline and a tone.
function headline(peek: GatePeek): { tone: Tone; title: string; icon: React.ReactElement } {
  switch (peek.outcome) {
    case 'free':
      return {
        tone: 'ok', icon: <CheckCircle size={22} />,
        title: peek.basis === 'member' ? `APPROVED ${(peek.member?.kind || 'staff').toUpperCase()} · ENTERS FREE`
          : peek.basis === 'day_pass' ? 'DAY PASS ALREADY PAID'
          : peek.basis === 'ride_pass' ? 'RIDE ALREADY PAID'
          : 'NO FEE FOR THIS VEHICLE',
      };
    case 'pay':
      return {
        tone: 'warn', icon: <Banknote size={22} />,
        title: `NOT APPROVED · ENTRY FEE ${formatUgx(peek.fee_ugx ?? 0).toUpperCase()}`,
      };
    case 'inside':
      return { tone: 'info', icon: <LogOut size={22} />, title: 'INSIDE · CHECK OUT' };
    case 'awaiting':
      return { tone: 'warn', icon: <Clock size={22} />, title: 'WAITING FOR PAYMENT' };
    default:
      return { tone: 'bad', icon: <XCircle size={22} />, title: 'NOT ALLOWED IN' };
  }
}

const RESULT_TITLE: Record<string, { tone: Tone; title: string }> = {
  granted: { tone: 'ok', title: 'CHECKED IN' },
  cleared: { tone: 'ok', title: 'CLEARED TO LEAVE' },
  pay_required: { tone: 'warn', title: 'ENTRY FEE REQUESTED' },
  balance_due: { tone: 'warn', title: 'NOT CLEARED · BALANCE DUE' },
  already_inside: { tone: 'info', title: 'ALREADY INSIDE' },
  not_checked_in: { tone: 'bad', title: 'NEVER CHECKED IN' },
  denied: { tone: 'bad', title: 'REFUSED' },
};

// The gate, run from the page the rider's card QR opens. The page stays public: this panel appears only for a signed-in person whose
// CMMS role may run the gate of a restricted zone (the database decides, not this file). They scan the card with an ordinary phone
// camera, land here, and see what will happen — approved: free; not approved: the fee, and who pays it (the rider, or the customer on
// the ride); inside: check out, which only clears when everything is paid — then tap once.
export default function RiderCardGatePanel({ code, onRecorded }: { code: string; onRecorded?: () => void }) {
  const [userId, setUserId] = useState<string | null | undefined>(undefined); // undefined = still checking
  const [email, setEmail] = useState('');
  const [zones, setZones] = useState<GateZone[] | null>(null);
  const [zoneId, setZoneId] = useState(remembered(ZONE_KEY));
  const [gate, setGate] = useState(remembered(GATE_KEY));
  const [plate, setPlate] = useState('');
  const [peek, setPeek] = useState<GatePeek | null>(null);
  const [peekError, setPeekError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  // after a vehicle has just been checked in or out the buttons go away, so a second tap cannot flip it straight back
  const [locked, setLocked] = useState(false);
  const [result, setResult] = useState<GateScanResult | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // the fee being waited on: asked for at the way in, or owed at the way out
  const [follow, setFollow] = useState<GateVisitView | null>(null);
  // reporting a vehicle that went in by force, or left without paying (goes on its public record)
  const [reporting, setReporting] = useState(false);
  const [reportNote, setReportNote] = useState('');
  const [reported, setReported] = useState<string | null>(null);
  const [signInEmail, setSignInEmail] = useState('');
  const [signInNotice, setSignInNotice] = useState<string | null>(null);
  const [signInError, setSignInError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => { setUserId(data.user?.id ?? null); setEmail(data.user?.email ?? ''); });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => { setUserId(session?.user?.id ?? null); setEmail(session?.user?.email ?? ''); });
    return () => sub.subscription.unsubscribe();
  }, []);

  // the zones this person may run the gate for (none for a customer, a rider or anyone else who is just checking the card)
  useEffect(() => {
    if (!userId) { setZones(null); return undefined; }
    let cancelled = false;
    (async () => {
      const res = await gateStaffService.myZones();
      if (cancelled) return;
      // the SQL not being run yet, or any other failure, is nothing a person checking a card needs to be told about
      if (res.error && !res.notInstalled) console.warn('Gate zones could not be loaded:', res.error);
      setZones(res.data ?? []);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const zone = zones?.find((z) => z.id === zoneId) ?? zones?.find((z) => z.status === 'active') ?? zones?.[0] ?? null;

  // what scanning this card at this zone would do
  useEffect(() => {
    if (!zone) { setPeek(null); return undefined; }
    let cancelled = false;
    (async () => {
      const res = await gateStaffService.peek(zone.id, code);
      if (cancelled) return;
      setPeekError(res.error);
      setPeek(res.data);
      // a fee asked for earlier (from another phone, or before this page was reloaded) is picked up and followed; a balance owed on the
      // way out is followed only once someone has pressed Check out on this page
      setFollow((current) => {
        const visit = res.data?.visit;
        if (res.data?.outcome === 'awaiting') return visit ?? null;
        if (res.data?.outcome === 'inside' && visit && current?.id === visit.id && visit.balance_ugx > 0) return visit;
        return null;
      });
    })();
    return () => { cancelled = true; };
  }, [zone?.id, code, refresh]);

  // while a payment is awaited, watch it
  useEffect(() => {
    if (!follow) return undefined;
    let cancelled = false;
    const timer = setInterval(async () => {
      const res = await gateStaffService.visitStatus(follow.id);
      if (cancelled || !res.data) return;
      const v = res.data.visit;
      const entry = follow.status === 'awaiting_payment';
      // an entry request is settled once it is no longer waiting (paid: inside, or lapsed / withdrawn); a balance once nothing is owed
      const settled = entry ? v.status !== 'awaiting_payment' : v.status !== 'inside' || v.balance_ugx <= 0;
      if (!settled) { setFollow(v); return; }
      setFollow(null);
      if (entry && v.status === 'inside') {
        setResult({ verdict: 'granted', message: `Paid ${formatUgx(v.fee_paid_ugx)}${v.payment_method === 'cash' ? ' in cash' : ''}. The vehicle is checked in.`, visit: v });
        setLocked(true);
      } else if (entry) {
        setResult({ verdict: 'denied', message: v.reason || 'The request was cancelled.', visit: v });
      } else {
        setResult({ verdict: 'granted', message: 'Paid. The vehicle can be checked out now.', visit: v });
      }
      setRefresh((n) => n + 1);
    }, POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [follow?.id, follow?.status]);

  const signInWithGoogle = async () => {
    setSigningIn(true); setSignInError(null);
    try {
      sessionStorage.setItem(RIDER_CARD_RETURN_KEY, code);
      const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.href, queryParams: { prompt: 'select_account' } } });
      if (error) throw error;
    } catch (e) {
      setSignInError(e instanceof Error ? e.message : 'Could not start Google sign-in');
      setSigningIn(false);
    }
  };

  const sendEmailLink = async () => {
    const address = signInEmail.trim();
    if (!address) return;
    setSigningIn(true); setSignInError(null); setSignInNotice(null);
    try {
      sessionStorage.setItem(RIDER_CARD_RETURN_KEY, code);
      const { error } = await supabase.auth.signInWithOtp({ email: address, options: { emailRedirectTo: window.location.href } });
      if (error) throw error;
      setSignInNotice(`Sign-in link sent to ${address}. Open it on this phone.`);
    } catch (e) {
      setSignInError(e instanceof Error ? e.message : 'Could not send the sign-in link');
    } finally {
      setSigningIn(false);
    }
  };

  const act = useCallback(async (direction: 'in' | 'out') => {
    if (!zone) return;
    setBusy(true); setActionError(null);
    remember(ZONE_KEY, zone.id); remember(GATE_KEY, gate);
    const res = await gateStaffService.scan(zone.id, code, direction, gate, plate);
    setBusy(false);
    if (!res.data) { setActionError(res.error || 'Could not complete the scan'); return; }
    setResult(res.data);
    setLocked(res.data.verdict === 'granted' || res.data.verdict === 'cleared');
    const v = res.data.visit;
    setFollow(v && ((res.data.verdict === 'pay_required' && v.status === 'awaiting_payment') || (res.data.verdict === 'balance_due' && v.balance_ugx > 0)) ? v : null);
    setRefresh((n) => n + 1);
  }, [zone, code, gate, plate]);

  const takeCash = async () => {
    if (!follow) return;
    setBusy(true); setActionError(null);
    const res = await gateStaffService.collectCash(follow.id);
    setBusy(false);
    if (!res.data) { setActionError(res.error || 'Could not take the cash'); return; }
    const v = res.data.visit;
    setFollow(null);
    setLocked(follow.status === 'awaiting_payment');
    setResult({ verdict: 'granted', message: `UGX ${Math.round(v.fee_paid_ugx).toLocaleString('en-UG')} taken in cash. ${follow.status === 'awaiting_payment' ? 'The vehicle is checked in.' : 'The vehicle can be checked out now.'}`, visit: v });
    setRefresh((n) => n + 1);
  };

  const withdraw = async () => {
    if (!follow) return;
    setBusy(true); setActionError(null);
    const res = await gateStaffService.withdraw(follow.id);
    setBusy(false);
    if (res.error) { setActionError(res.error); return; }
    setFollow(null);
    setResult({ verdict: 'denied', message: 'The request was withdrawn.' });
    setRefresh((n) => n + 1);
  };

  const report = async (kind: IncidentKind) => {
    if (!zone) return;
    setBusy(true); setActionError(null);
    const res = await gateStaffService.report(zone.id, code, kind, reportNote);
    setBusy(false);
    if (!res.data) { setActionError(res.error || 'Could not record it'); return; }
    setReporting(false); setReportNote(''); setFollow(null); setResult(null);
    setReported(res.data.already_recorded
      ? 'Already recorded a moment ago, so it was not added twice.'
      : 'It is now on this rider\'s public record for everyone who checks the card, and the rider has been told.');
    setRefresh((n) => n + 1);
    onRecorded?.();
  };

  const signOut = async () => { await supabase.auth.signOut(); setResult(null); setFollow(null); };

  // ── still checking who is looking ──
  if (userId === undefined) return null;

  // ── signed out: the page stays public; staff can sign in to run the gate from it ──
  if (userId === null) {
    return (
      <section aria-label="Gate staff" className="space-y-2 border-t border-dashed border-slate-200 bg-slate-50 p-5">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-600"><ShieldCheck size={14} /> Gate staff?</p>
        <p className="text-xs text-slate-500">Sign in to check this vehicle in or out of the area you guard. Everyone else can ignore this.</p>
        <button
          type="button" onClick={signInWithGoogle} disabled={signingIn}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-800 disabled:opacity-60"
        >
          {signingIn ? <Loader2 size={16} className="animate-spin" /> : null} Sign in with Google
        </button>
        <div className="flex gap-2">
          <input
            type="email" inputMode="email" autoComplete="email" value={signInEmail} onChange={(e) => setSignInEmail(e.target.value)}
            placeholder="or your work e-mail" aria-label="Work e-mail"
            className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800"
          />
          <button
            type="button" onClick={sendEmailLink} disabled={signingIn || !signInEmail.trim()}
            className="rounded-xl bg-slate-800 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            Send link
          </button>
        </div>
        {signInNotice && <p role="status" className="text-xs text-emerald-700">{signInNotice}</p>}
        {signInError && <p role="alert" className="text-xs text-red-700">{signInError}</p>}
      </section>
    );
  }

  // ── signed in, but not someone who runs a gate (a customer, a rider…): say so once, quietly ──
  if (zones === null) return null;
  if (zones.length === 0) {
    return (
      <p className="border-t border-dashed border-slate-200 px-5 py-3 text-center text-[11px] text-slate-400">
        Signed in as {email || 'you'} · no gate access on this account ·{' '}
        <button type="button" onClick={signOut} className="underline">Sign out</button>
      </p>
    );
  }
  if (!zone) return null;

  const head = peek?.found ? headline(peek) : null;
  const fee = peek?.fee_ugx ?? 0;
  const typedPlate = plateKey(plate);
  const cardPlate = plateKey(peek?.rider?.plate_number);
  const plateMismatch = !!typedPlate && !!cardPlate && typedPlate !== cardPlate;
  const closed = zone.status !== 'active';
  const canCash = !!(follow && (zone.accept_cash || peek?.can_collect_cash));

  const primary: { label: string; dir: 'in' | 'out'; icon: React.ReactElement; cls: string } | null =
    !peek ? null
    : peek.action === 'in'
      ? {
          dir: 'in', icon: <LogIn size={18} />,
          cls: peek.outcome === 'pay' ? 'bg-amber-600' : 'bg-emerald-600',
          label: peek.outcome === 'pay'
            ? (peek.payer === 'customer' ? `Check in · charge the customer ${formatUgx(fee)}` : `Check in · ask for ${formatUgx(fee)}`)
            : 'Check in · free',
        }
      : peek.action === 'out'
        ? { dir: 'out', icon: <LogOut size={18} />, cls: 'bg-sky-700', label: 'Check out' }
        : null;

  // what can be reported against this card here: it went in without paying / checking in, or it was inside, owing money, and left
  const reportKind: IncidentKind | null = !peek?.found ? null
    : peek.outcome === 'inside' ? ((peek.visit?.balance_ugx ?? 0) > 0 ? 'left_without_clearing' : null)
    : peek.outcome === 'pay' || peek.outcome === 'awaiting' || peek.outcome === 'refused' ? 'forced_entry'
    : null;

  const resultTitle = result ? RESULT_TITLE[result.verdict] ?? { tone: 'info' as Tone, title: result.verdict.toUpperCase() } : null;

  return (
    <section aria-label="Gate" className="space-y-3 border-t border-slate-100 bg-slate-50/60 p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500"><ShieldCheck size={12} /> Gate</h2>
        <button type="button" onClick={signOut} className="text-[11px] text-slate-400 underline">Sign out</button>
      </div>

      {/* which zone */}
      {zones.length > 1 ? (
        <label className="block text-xs text-slate-500">
          Zone
          <select
            value={zone.id} onChange={(e) => { setZoneId(e.target.value); remember(ZONE_KEY, e.target.value); setResult(null); setFollow(null); setLocked(false); }}
            className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800"
          >
            {zones.map((z) => (
              <option key={z.id} value={z.id}>{z.name}{z.business_name ? ` — ${z.business_name}` : ''}{z.status !== 'active' ? ' (closed)' : ''}</option>
            ))}
          </select>
        </label>
      ) : (
        <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
          <MapPin size={14} className="text-slate-400" /> {zone.name}{zone.business_name && zone.business_name.trim().toLowerCase() !== zone.name.trim().toLowerCase() ? <span className="font-normal text-slate-500"> · {zone.business_name}</span> : null}
        </p>
      )}
      {closed && <p className="text-xs text-amber-800">This zone is closed: nothing new can go in, but a vehicle already inside can still leave.</p>}

      {/* what will happen */}
      {!peek && !peekError && <p role="status" className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" /> Checking this vehicle against {zone.name}…</p>}
      {peekError && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900">{peekError}</p>}

      {peek && (
        <div className={`space-y-1.5 rounded-xl border p-3.5 ${TONE[(head?.tone ?? 'bad')]}`}>
          <p className="flex items-center gap-2 text-sm font-bold tracking-wide">{head?.icon}{head ? head.title : 'NOT A VALID CARD'}</p>
          <p className="text-sm">{peek.message}</p>
          {peek.note && <p className="text-xs font-semibold">{peek.note}</p>}
          {peek.outcome === 'pay' && peek.fee_ican != null && (
            <p className="text-xs opacity-80">= {peek.fee_ican.toFixed(4)} ICAN · {peek.can_collect_cash ? 'the gate can also take cash' : 'paid from the BodaGoEra wallet'}</p>
          )}
          {peek.rider && peek.found && (
            <p className="text-xs opacity-80">{kindLabel(peek.rider.vehicle_type)} · {peek.rider.plate_number || 'no plate'}{peek.rider.vehicle_model ? ` · ${peek.rider.vehicle_model}` : ''}{peek.rider.vehicle_color ? ` · ${peek.rider.vehicle_color}` : ''}</p>
          )}
          {peek.warnings && peek.warnings.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-5 text-xs">{peek.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          )}
        </div>
      )}

      {/* what the gate sees */}
      {peek?.found && (peek.action === 'in' || peek.action === 'out') && !follow && !locked && (
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-slate-500">
            Plate you see (optional)
            <input
              value={plate} onChange={(e) => setPlate(e.target.value)} autoCapitalize="characters" autoComplete="off" placeholder={peek.rider?.plate_number || 'UAB 123X'}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm uppercase text-slate-800"
            />
          </label>
          <label className="text-xs text-slate-500">
            Gate (optional)
            <input
              value={gate} onChange={(e) => setGate(e.target.value)} autoComplete="off" placeholder="Main gate"
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800"
            />
          </label>
        </div>
      )}
      {plateMismatch && (
        <p role="alert" className="flex items-start gap-1.5 rounded-xl border border-red-300 bg-red-50 p-3 text-xs font-semibold text-red-900">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" /> The plate you typed ({typedPlate}) does not match this card ({cardPlate}). It may be someone else&apos;s card.
        </p>
      )}

      {/* the one tap */}
      {primary && !follow && !locked && (
        <button
          type="button" onClick={() => act(primary.dir)} disabled={busy}
          className={`flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-white shadow-sm disabled:opacity-60 ${primary.cls}`}
        >
          {busy ? <Loader2 size={18} className="animate-spin" /> : primary.icon} {primary.label}
        </button>
      )}
      {peek?.found && peek.action === 'none' && !locked && (
        <button
          type="button" onClick={() => act('in')} disabled={busy}
          className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-semibold text-slate-600 disabled:opacity-60"
        >
          {busy ? 'Logging…' : 'Log this refusal'}
        </button>
      )}

      {/* a payment is being waited for */}
      {follow && (
        <div role="status" className={`space-y-2 rounded-xl border p-3.5 ${TONE.warn}`}>
          <p className="flex items-center gap-2 text-sm font-bold"><Loader2 size={16} className="animate-spin" /> Waiting for {formatUgx(follow.balance_ugx || follow.fee_due_ugx)}</p>
          <p className="text-xs">
            {follow.payer === 'customer'
              ? 'The customer on this ride pays: it is charged to them, or they pay you at the gate.'
              : follow.status === 'awaiting_payment'
                ? 'The rider has been asked to approve it with their PIN in BodaGoEra. This page updates by itself the moment it is paid.'
                : 'The rider approves it in BodaGoEra, or pays at the gate. This page updates by itself.'}
            {follow.pay_by ? ` Asked until ${clock(follow.pay_by)}.` : ''}
          </p>
          <div className="flex gap-2">
            {canCash && (
              <button type="button" onClick={takeCash} disabled={busy} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2.5 text-sm font-bold text-white disabled:opacity-60">
                <Banknote size={16} /> Took cash
              </button>
            )}
            {follow.status === 'awaiting_payment' && (
              <button type="button" onClick={withdraw} disabled={busy} className="flex-1 rounded-xl border border-amber-400 bg-white px-3 py-2.5 text-sm font-semibold text-amber-900 disabled:opacity-60">
                Withdraw request
              </button>
            )}
          </div>
        </div>
      )}

      {locked && !follow && (
        <button type="button" onClick={() => { setLocked(false); setResult(null); }} className="text-xs text-slate-500 underline">
          Not done? Show the buttons again
        </button>
      )}

      {/* it went in by force / left without paying: that goes on its public record */}
      {reportKind && !reporting && (
        <button type="button" onClick={() => { setReporting(true); setReported(null); }}
          className="w-full text-center text-xs font-semibold text-red-700 underline">
          {reportKind === 'forced_entry' ? 'It went in by force? Report it' : `It already left without paying ${formatUgx(peek?.visit?.balance_ugx ?? 0)}? Report it`}
        </button>
      )}
      {reportKind && reporting && (
        <div className="space-y-2 rounded-xl border border-red-300 bg-red-50 p-3.5 text-red-900">
          <p className="flex items-start gap-1.5 text-sm font-bold">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            {reportKind === 'forced_entry' ? 'Record that this vehicle went in by force?' : 'Record that this vehicle left without paying?'}
          </p>
          <p className="text-xs">
            It goes on {peek?.rider?.plate_number || 'this rider'}&apos;s <strong>public record</strong>, with the date and {zone.name}, for everyone who checks the card at any
            gate. The rider is told. Paying settles it, but it stays. Only report what you saw yourself.
            {reportKind === 'left_without_clearing' ? ' The vehicle is also marked as having left.' : ''}
          </p>
          <label className="block text-xs">
            Note for your business (not public)
            <textarea value={reportNote} onChange={(e) => setReportNote(e.target.value)} maxLength={300} rows={2} placeholder="What happened"
              className="mt-1 w-full rounded-xl border border-red-300 bg-white px-3 py-2 text-sm text-slate-800" />
          </label>
          <div className="flex gap-2">
            <button type="button" onClick={() => report(reportKind)} disabled={busy}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-red-700 px-3 py-2.5 text-sm font-bold text-white disabled:opacity-60">
              {busy ? <Loader2 size={16} className="animate-spin" /> : null} Record it
            </button>
            <button type="button" onClick={() => setReporting(false)} disabled={busy}
              className="flex-1 rounded-xl border border-red-300 bg-white px-3 py-2.5 text-sm font-semibold text-red-900 disabled:opacity-60">
              Cancel
            </button>
          </div>
        </div>
      )}
      {reported && (
        <div role="status" className={`space-y-1 rounded-xl border p-3.5 ${TONE.bad}`}>
          <p className="text-sm font-bold tracking-wide">RECORDED ON THE PUBLIC RECORD</p>
          <p className="text-sm">{reported}</p>
        </div>
      )}

      {actionError && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900">{actionError}</p>}

      {/* what just happened */}
      {result && resultTitle && !follow && (
        <div role="status" className={`space-y-1 rounded-xl border p-3.5 ${TONE[resultTitle.tone]}`}>
          <p className="text-sm font-bold tracking-wide">{resultTitle.title}</p>
          <p className="text-sm">{result.message}</p>
        </div>
      )}

      <p className="text-[11px] text-slate-400">Signed in as {email || 'you'}. Every scan is logged against your account.</p>
    </section>
  );
}
