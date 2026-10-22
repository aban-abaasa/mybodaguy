import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle, Clock, MapPin, ScanLine, ShieldCheck, Wallet } from 'lucide-react';
import SetPinPrompt from './SetPinPrompt';
import { supabase } from '../services/supabaseClient';
import { hasPinSet, validatePIN, verifyPin } from '../services/pinService';
import { formatUgx } from '../services/riderCardService';
import {
  EMPTY_GATE_OVERVIEW,
  GATE_STATE_TEXT,
  ZONE_KIND_LABEL,
  gateNotInstalled,
  zoneAccessService,
  type GateInside,
  type GateOverview,
  type GatePass,
  type GateRequest,
  type GateVisit,
} from '../services/zoneAccessService';

interface Props {
  // 'page' is the "Gate passes" tab; 'tile' is the compact entry on the Overview (shown only when a gate is waiting for you).
  variant?: 'page' | 'tile';
  userId?: string;
  // Called after a fee is paid so the wallet balance on screen can refresh.
  onPaid?: () => void;
  onOpen?: () => void;
  onGoToWallet?: () => void;
}

const fmtIcan = (n: number) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 4 });
const vehicleLabel = (type?: string | null) => (type ? type.charAt(0).toUpperCase() + type.slice(1) : 'Vehicle');
const clock = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');
const stamp = (iso?: string | null) => (iso ? new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const minutesText = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`);

// The wallet's own wording is "Insufficient ICAN. Have: 0.45714286, Need: 2.00000000".
const friendlyPayError = (message?: string) => {
  const m = message?.match(/Insufficient ICAN\. Have: ([\d.]+), Need: ([\d.]+)/i);
  return m ? `Not enough IcanEra in your wallet: you have ${fmtIcan(Number(m[1]))}, you need ${fmtIcan(Number(m[2]))}.` : message || 'Payment failed';
};

// Loads the rider's gate screen and keeps it fresh while the app is open and visible: a request appears within seconds
// of the gate scanning the card, and a paid one disappears just as fast.
function useGatePasses(pollMs: number) {
  const [overview, setOverview] = useState<GateOverview>(EMPTY_GATE_OVERVIEW);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  const load = useCallback(async () => {
    const res = await zoneAccessService.getMyPasses();
    if (!alive.current) return;
    setOverview(res.overview);
    setError(res.error ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    alive.current = true;
    load();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') load(); }, pollMs);
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { alive.current = false; clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [load, pollMs]);

  return { overview, loading, error, reload: load };
}

function TimeLeft({ until }: { until: string | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  if (!until) return null;
  const secs = Math.max(0, Math.round((new Date(until).getTime() - now) / 1000));
  if (secs === 0) return <span className="text-red-600">expired</span>;
  return <span>{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')} left</span>;
}

// One fee the gate is waiting for. Approving it goes through the rider's ICAN wallet and needs their transaction PIN,
// like every other wallet payment in the app. The PIN is checked first; nothing is charged until it is right.
function RequestCard({
  request, userId, balance, onDone, onGoToWallet,
}: {
  request: GateRequest;
  userId?: string;
  balance: number | null;
  onDone: () => void;
  onGoToWallet?: () => void;
}) {
  const [step, setStep] = useState<'idle' | 'pin'>('idle');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [needsPin, setNeedsPin] = useState(false);
  const entry = request.kind === 'entry';
  const short = balance !== null && balance < request.fee_ican;

  const start = async () => {
    if (!userId) { toast.error('Please sign in again to pay from your wallet'); return; }
    try {
      if (!(await hasPinSet(userId))) { setNeedsPin(true); return; }
      setStep('pin');
    } catch {
      toast.error("We couldn't check your PIN. Please try again.");
    }
  };

  const pay = async () => {
    if (!userId) return;
    setBusy(true);
    try {
      const check = await verifyPin(userId, pin);
      if (!check.success) { toast.error(check.error || 'Incorrect PIN'); setPin(''); return; }
      const result = await zoneAccessService.payFee(request.id);
      if (result.success) {
        toast.success(entry ? `Paid. You can enter ${request.zone_name}.` : `Paid. You can leave ${request.zone_name}.`, {
          action: onGoToWallet ? { label: 'View in wallet', onClick: onGoToWallet } : undefined,
        });
        setStep('idle'); setPin('');
        onDone();
      } else {
        toast.error(friendlyPayError(result.error));
        onDone();   // the request may have lapsed: show what is true now
      }
    } catch {
      toast.error("We couldn't complete the payment. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const decline = async () => {
    setBusy(true);
    const result = await zoneAccessService.declineFee(request.id);
    setBusy(false);
    if (result.success) { toast('Declined. The vehicle will not be let in.'); onDone(); }
    else { toast.error(result.error || 'Could not decline'); onDone(); }
  };

  return (
    <div className="classic-card space-y-3 !border-amber-300 p-4 ring-2 ring-amber-100">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-full bg-amber-50 ring-1 ring-inset ring-amber-100">
          <ScanLine size={17} className="text-amber-600" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-classic-display text-base font-semibold leading-tight text-slate-800">
            {entry ? `${request.zone_name} is asking for an entry fee` : `Pay before you leave ${request.zone_name}`}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {request.plate_number} · {vehicleLabel(request.vehicle_type)}
            {entry && request.pay_by ? <> · <TimeLeft until={request.pay_by} /></> : null}
          </p>
          {!entry && request.overstay_ugx > 0 && (
            <p className="mt-0.5 text-xs text-slate-500">Includes {formatUgx(request.overstay_ugx)} for staying past the time limit.</p>
          )}
        </div>
        <div className="text-right">
          <p className="text-lg font-bold tabular-nums text-slate-900">{formatUgx(request.balance_ugx)}</p>
          <p className="text-[11px] text-slate-500">{fmtIcan(request.fee_ican)} ICAN</p>
        </div>
      </div>

      {needsPin && userId && (
        <SetPinPrompt
          userId={userId}
          onDone={async () => {
            setNeedsPin(false);
            try { if (await hasPinSet(userId)) setStep('pin'); } catch { /* they can tap Approve again */ }
          }}
        />
      )}

      {short ? (
        <div role="alert" className="space-y-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-900 ring-1 ring-inset ring-amber-200">
          <p className="font-semibold">Your wallet doesn't have enough IcanEra for this.</p>
          <p>You have {fmtIcan(balance!)} and it costs {fmtIcan(request.fee_ican)}. Add {fmtIcan(request.fee_ican - balance!)} more, or pay the gate in cash if it takes cash.</p>
          {onGoToWallet && (
            <button type="button" onClick={onGoToWallet} className="classic-btn classic-btn-outline !w-auto !min-h-[36px] !rounded-full !px-5 !py-1.5 !text-[13px]">Open wallet</button>
          )}
        </div>
      ) : step === 'pin' ? (
        <form onSubmit={(e) => { e.preventDefault(); if (validatePIN(pin) && !busy) pay(); }} className="space-y-3">
          <div>
            <label htmlFor={`gate-pin-${request.id}`} className="classic-label">Transaction PIN</label>
            <input
              id={`gate-pin-${request.id}`}
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
            <p className="mt-1 text-[11px] text-slate-400">Enter your PIN to pay {formatUgx(request.balance_ugx)} ({fmtIcan(request.fee_ican)} ICAN) from your wallet.</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => { setStep('idle'); setPin(''); }} disabled={busy} className="classic-btn classic-btn-outline !w-auto !flex-none !rounded-full !px-6">Not now</button>
            <button type="submit" disabled={busy || !validatePIN(pin)} className="classic-btn classic-btn-primary !rounded-full whitespace-nowrap">
              {busy ? 'Paying…' : `Pay ${formatUgx(request.balance_ugx)}`}
            </button>
          </div>
        </form>
      ) : (
        <div className="flex gap-2">
          {entry && (
            <button type="button" onClick={decline} disabled={busy} className="classic-btn classic-btn-outline !w-auto !flex-none !rounded-full !px-6">Decline</button>
          )}
          <button type="button" onClick={start} disabled={busy} className="classic-btn classic-btn-primary !rounded-full">
            {entry ? `Approve and pay ${formatUgx(request.balance_ugx)}` : `Pay ${formatUgx(request.balance_ugx)} to leave`}
          </button>
        </div>
      )}
    </div>
  );
}

function InsideCard({ visit }: { visit: GateInside }) {
  const free = visit.access_basis === 'member';
  const limit = visit.max_stay_minutes;
  const over = limit != null && visit.minutes_inside > limit;
  return (
    <div className="classic-card flex items-start gap-3 p-4">
      <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-full bg-emerald-50 ring-1 ring-inset ring-emerald-100">
        <CheckCircle size={17} className="text-emerald-600" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-classic-display text-base font-semibold leading-tight text-slate-800">You are inside {visit.zone_name}</p>
        <p className="mt-0.5 text-xs text-slate-500">
          {visit.plate_number} · since {clock(visit.entered_at)} ({minutesText(visit.minutes_inside)})
          {limit != null ? ` · time limit ${minutesText(limit)}` : ''}
        </p>
        {free
          ? <p className="mt-0.5 text-xs text-emerald-700">Approved vehicle: you pay nothing here.</p>
          : <p className="mt-0.5 text-xs text-slate-500">Paid {formatUgx(visit.fee_paid_ugx)}. The gate scans your card on the way out and checks nothing is left to pay.</p>}
        {over && !free && visit.overstay_ugx === 0 && <p className="mt-0.5 text-xs text-amber-700">You are past the time limit; an overstay fee may be due when you leave.</p>}
      </div>
    </div>
  );
}

function PassCard({ pass }: { pass: GatePass }) {
  const ok = pass.state === 'ok';
  return (
    <div className="flex items-start gap-3 rounded-xl bg-white p-3 ring-1 ring-black/5">
      <span className={`grid h-9 w-9 flex-shrink-0 place-items-center rounded-full ring-1 ring-inset ${ok ? 'bg-emerald-50 text-emerald-600 ring-emerald-100' : 'bg-amber-50 text-amber-600 ring-amber-100'}`}>
        {ok ? <ShieldCheck size={16} /> : <Clock size={16} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-800">{pass.zone_name}</p>
        <p className="text-xs text-slate-500">
          {[ZONE_KIND_LABEL[pass.zone_kind] ?? 'Restricted area', pass.organisation, pass.location].filter(Boolean).join(' · ')}
        </p>
        <p className="mt-0.5 text-xs text-slate-500">
          {pass.plate_number} · {vehicleLabel(pass.vehicle_type)} · {pass.member_kind}
          {pass.valid_until ? ` · until ${new Date(pass.valid_until).toLocaleDateString()}` : ''}
          {pass.daily_start_time && pass.daily_end_time ? ` · ${pass.daily_start_time.slice(0, 5)}–${pass.daily_end_time.slice(0, 5)}` : ''}
        </p>
        <p className={`mt-0.5 text-xs ${ok ? 'text-emerald-700' : 'text-amber-700'}`}>{GATE_STATE_TEXT[pass.state] ?? pass.state}</p>
      </div>
    </div>
  );
}

const RECENT_TEXT: Record<string, string> = { exited: 'Left', denied: 'Refused', cancelled: 'Not paid' };

function RecentRow({ visit }: { visit: GateVisit }) {
  return (
    <li className="flex items-center justify-between gap-3 py-2 text-xs">
      <span className="min-w-0">
        <span className="font-semibold text-slate-700">{visit.zone_name}</span>
        <span className="text-slate-400"> · {visit.plate_number ?? 'card'} · {stamp(visit.entered_at || visit.requested_at)}</span>
        {visit.status !== 'exited' && visit.reason ? <span className="block truncate text-slate-400">{visit.reason}</span> : null}
      </span>
      <span className="flex-shrink-0 text-right text-slate-500">
        {RECENT_TEXT[visit.status] ?? visit.status}
        {visit.fee_paid_ugx > 0 ? <span className="block font-semibold text-slate-700">{formatUgx(visit.fee_paid_ugx)}</span> : null}
      </span>
    </li>
  );
}

export default function RiderGatePasses({ variant = 'page', userId, onPaid, onOpen, onGoToWallet }: Props) {
  const { overview, loading, error, reload } = useGatePasses(variant === 'tile' ? 15000 : 6000);
  const [balance, setBalance] = useState<number | null>(null);

  const loadBalance = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase.from('ican_user_wallets').select('ican_balance').eq('user_id', userId).maybeSingle();
    setBalance(Number(data?.ican_balance ?? 0));
  }, [userId]);

  useEffect(() => { if (variant === 'page') loadBalance(); }, [variant, loadBalance]);

  const { requests, inside, passes, recent } = overview;

  if (variant === 'tile') {
    // Only worth the space when a gate is waiting for you, or you are inside somewhere.
    if (loading || error || (requests.length === 0 && inside.length === 0)) return null;
    const waiting = requests.length > 0;
    return (
      <button type="button" onClick={onOpen} className={`classic-card flex w-full items-center gap-3 p-4 text-left ${waiting ? '!border-amber-300 ring-2 ring-amber-100' : ''}`}>
        <span className={`grid h-10 w-10 flex-shrink-0 place-items-center rounded-full ring-1 ring-inset ${waiting ? 'bg-amber-50 ring-amber-100' : 'bg-emerald-50 ring-emerald-100'}`}>
          {waiting ? <ScanLine size={17} className="text-amber-600" /> : <MapPin size={17} className="text-emerald-600" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-classic-display text-base font-semibold leading-tight text-slate-800">
            {waiting ? `${requests[0].zone_name} is waiting for you` : `Inside ${inside[0].zone_name}`}
          </span>
          <span className="mt-0.5 block text-xs text-slate-500">
            {waiting
              ? `${requests[0].kind === 'entry' ? 'Approve the entry fee' : 'Pay to leave'}: ${formatUgx(requests[0].balance_ugx)}`
              : 'Tap to see your gate pass'}
          </span>
        </span>
      </button>
    );
  }

  const done = () => { reload(); loadBalance(); onPaid?.(); };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="font-classic-display text-xl font-semibold text-slate-800">Gate passes</h2>
        <p className="text-xs text-slate-500">
          Some areas (estates, campuses, hospitals, markets, ports) control which vehicles may enter. Show your rider ID card QR at the gate.
          If the area has approved your vehicle you enter free; if not, you approve the entry fee here with your PIN.
        </p>
      </div>

      {error && (
        <div role="alert" className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900 ring-1 ring-inset ring-amber-200">
          <p className="flex items-center gap-1.5 font-semibold"><AlertTriangle size={14} /> {gateNotInstalled(error) ? 'Gate passes are not switched on yet.' : "We couldn't load your gate passes."}</p>
          {!gateNotInstalled(error) && <p className="mt-1">{error}</p>}
        </div>
      )}

      {requests.map((request) => (
        <RequestCard key={request.id} request={request} userId={userId} balance={balance} onDone={done} onGoToWallet={onGoToWallet} />
      ))}

      {inside.map((visit) => <InsideCard key={visit.id} visit={visit} />)}

      {balance !== null && (requests.length > 0) && (
        <p className="flex items-center gap-1.5 text-xs text-slate-500">
          <Wallet size={13} /> Wallet balance: <span className="font-semibold text-slate-700">{fmtIcan(balance)} ICAN</span>
        </p>
      )}

      <section className="space-y-2">
        <h3 className="classic-eyebrow">Where you are approved</h3>
        {loading ? (
          <p className="text-xs text-slate-400">Loading…</p>
        ) : passes.length === 0 ? (
          <p className="rounded-xl bg-white p-3 text-xs text-slate-500 ring-1 ring-black/5">
            No area has approved your vehicle yet. Anywhere that controls entry will ask you for its fee at the gate, and you will see the request here.
          </p>
        ) : (
          <div className="space-y-2">{passes.map((p) => <PassCard key={p.member_id} pass={p} />)}</div>
        )}
      </section>

      {recent.length > 0 && (
        <section className="space-y-1">
          <h3 className="classic-eyebrow">Recent</h3>
          <ul className="divide-y divide-slate-100 rounded-xl bg-white px-3 ring-1 ring-black/5">
            {recent.map((v) => <RecentRow key={v.id} visit={v} />)}
          </ul>
        </section>
      )}
    </div>
  );
}
