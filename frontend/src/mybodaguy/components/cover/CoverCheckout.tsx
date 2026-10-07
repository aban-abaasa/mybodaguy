import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Gift, ShieldCheck, Wallet } from 'lucide-react';
import SetPinPrompt from '../SetPinPrompt';
import { supabase } from '../../services/supabaseClient';
import { hasPinSet, validatePIN, verifyPin } from '../../services/pinService';
import { getRewardSummary } from '../../services/rewardsService';
import {
  SHARE_SCOPES,
  coverTypeLabel,
  formatIcan,
  friendlyPayError,
  insuranceService,
  periodLabel,
  type CoverPlan,
  type LocalRate,
  type RenewWith,
  type ShareScope,
} from '../../services/insuranceService';
import { Amount, Notice, Sheet, fmtDate } from './coverCommon';

export interface RiderReg {
  id: string;
  vehicle_type: string;
  plate_number: string | null;
  status: string;
}

interface Props {
  plan: CoverPlan;
  userId: string;
  // The signed-in person's rider registrations (a person can have more than one vehicle).
  riders: RiderReg[];
  rate: LocalRate | null;
  // Open with reward points ticked (the Rewards tab does this).
  defaultPay?: RenewWith;
  onClose: () => void;
  onDone: () => void;
  onGoToWallet?: () => void;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const regLabel = (r: RiderReg) =>
  `${cap(r.vehicle_type)}${r.plate_number && r.plate_number !== 'PENDING' ? ` · ${r.plate_number.toUpperCase()}` : ''}`;

const PAY_OPTIONS: { id: RenewWith; label: string; hint: string }[] = [
  { id: 'wallet', label: 'ICAN wallet', hint: 'Pay it all from your wallet.' },
  { id: 'points_first', label: 'Points + wallet', hint: 'Spend your reward points first, the wallet pays the rest.' },
  { id: 'points_only', label: 'Points only', hint: 'Pay entirely with reward points.' },
];

// Buying cover for yourself (or for one of your vehicles). Nothing is charged until the
// transaction PIN is right; the price shown is the whole price.
export default function CoverCheckout({ plan, userId, riders, rate, defaultPay, onClose, onDone, onGoToWallet }: Props) {
  const forRider = plan.audience.includes('rider');
  const forPerson = plan.audience.includes('person');
  const eligible = useMemo(
    () => (forRider ? riders.filter((r) => !plan.vehicle_types || plan.vehicle_types.includes(r.vehicle_type)) : []),
    [forRider, riders, plan.vehicle_types],
  );
  const [target, setTarget] = useState<string>(eligible[0]?.id ?? 'self');
  const [scopes, setScopes] = useState<ShareScope[]>([]);
  const [pay, setPay] = useState<RenewWith>(defaultPay ?? 'wallet');
  const [autoRenew, setAutoRenew] = useState(false);
  const [quote, setQuote] = useState<{ per: number; pointsCost: number | null } | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [points, setPoints] = useState<number | null>(null);
  const [step, setStep] = useState<'review' | 'pin'>('review');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [needsPin, setNeedsPin] = useState(false);

  const canBuy = eligible.length > 0 || forPerson;

  useEffect(() => {
    let cancelled = false;
    supabase.from('ican_user_wallets').select('ican_balance').eq('user_id', userId).maybeSingle()
      .then(({ data }) => { if (!cancelled) setBalance(Number(data?.ican_balance ?? 0)); });
    getRewardSummary(userId)
      .then((s) => { if (!cancelled) setPoints(Number(s.points_balance ?? 0)); })
      .catch(() => { if (!cancelled) setPoints(0); });
    return () => { cancelled = true; };
  }, [userId]);

  // The exact price for the data the person agrees to share (the insurer may reward sharing).
  useEffect(() => {
    let cancelled = false;
    insuranceService.quote(plan.plan_id, 1, scopes).then(({ data }) => {
      if (!cancelled && data?.success) setQuote({ per: Number(data.per_member_ican), pointsCost: data.points_cost });
    });
    return () => { cancelled = true; };
  }, [plan.plan_id, scopes]);

  const price = quote?.per ?? plan.price_ican;
  const pointsCost = plan.points_enabled ? Number(quote?.pointsCost ?? plan.points_cost ?? 0) : 0;
  const pointsPerIcan = pointsCost > 0 && price > 0 ? pointsCost / price : 0;
  const pts = Math.floor(points ?? 0);
  const canPointsOnly = pointsCost > 0 && pts >= pointsCost;
  const pointsUsed = pay !== 'wallet' && plan.points_enabled ? Math.min(pts, pointsCost) : 0;
  const walletPart = pay === 'points_only' ? 0 : Math.max(0, price - (pointsPerIcan > 0 ? pointsUsed / pointsPerIcan : 0));
  const short = balance !== null && walletPart > 0 && balance + 1e-9 < walletPart;
  const payBlocked = (pay === 'points_only' && !canPointsOnly) || short || !canBuy;

  const discountOn = plan.data_discount_pct > 0 && plan.data_discount_scopes.every((s) => scopes.includes(s));
  const scopeLabel = (id: ShareScope) => SHARE_SCOPES.find((s) => s.id === id)?.label ?? id;

  const toggleScope = (id: ShareScope) =>
    setScopes((cur) => (cur.includes(id) ? cur.filter((s) => s !== id) : [...cur, id]));

  const start = useCallback(async () => {
    try {
      if (!(await hasPinSet(userId))) { setNeedsPin(true); return; }
      setStep('pin');
    } catch {
      toast.error("We couldn't check your PIN. Please try again.");
    }
  }, [userId]);

  const submit = async () => {
    setBusy(true);
    try {
      const check = await verifyPin(userId, pin);
      if (!check.success) { toast.error(check.error || 'Incorrect PIN'); setPin(''); return; }
      const res = await insuranceService.subscribePersonal({
        planId: plan.plan_id,
        riderId: target === 'self' ? null : target,
        usePoints: pay !== 'wallet',
        pointsOnly: pay === 'points_only',
        shareScopes: scopes,
        autoRenew,
        renewWith: pay,
      });
      if (res.success) {
        toast.success('You are covered. Your cover shows on your card.');
        onDone();
      } else {
        toast.error(friendlyPayError(res.error));
      }
    } catch {
      toast.error("We couldn't complete the payment. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const insurer = plan.insurer;

  return (
    <Sheet title="Get this cover" onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 flex-shrink-0 place-items-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-inset ring-emerald-100">
            <ShieldCheck size={20} />
          </span>
          <div className="min-w-0">
            <p className="font-classic-display text-lg font-semibold leading-tight text-slate-800">{plan.name}</p>
            <p className="text-xs text-slate-500">{insurer.name} · {coverTypeLabel(plan.cover_type)}</p>
            <p className="mt-1 text-[11px] text-slate-400">
              Licensed by {insurer.regulator} · No. {insurer.licence_number} · valid to {fmtDate(insurer.licence_expiry)}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-slate-50 p-2.5">
            <p className="text-[10px] uppercase tracking-wider text-slate-400">Price</p>
            <p className="mt-0.5 text-sm font-bold text-slate-800">{formatIcan(price)}</p>
            <p className="text-[10px] text-slate-400">ICAN / {periodLabel(plan.period_days)}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-2.5">
            <p className="text-[10px] uppercase tracking-wider text-slate-400">Covers up to</p>
            <p className="mt-0.5 text-sm font-bold text-slate-800">{formatIcan(plan.cover_limit_ican)}</p>
            <p className="text-[10px] text-slate-400">ICAN</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-2.5">
            <p className="text-[10px] uppercase tracking-wider text-slate-400">Starts</p>
            <p className="mt-0.5 text-sm font-bold text-slate-800">{plan.waiting_days === 0 ? 'Today' : `${plan.waiting_days} days`}</p>
            <p className="text-[10px] text-slate-400">{plan.waiting_days === 0 ? 'no waiting' : 'waiting period'}</p>
          </div>
        </div>
        {rate && <p className="-mt-2 text-center text-[11px] text-slate-400"><Amount ican={price} rate={rate} suffix={` per ${periodLabel(plan.period_days)}`} /></p>}

        {plan.benefits.length > 0 && (
          <ul className="space-y-1 text-xs text-slate-600">
            {plan.benefits.map((b) => <li key={b} className="flex gap-1.5"><span className="text-emerald-500">✓</span>{b}</li>)}
          </ul>
        )}

        {!canBuy && (
          <Notice tone="warn">
            This plan is for riders. You need an approved rider registration with a matching vehicle
            {plan.vehicle_types ? ` (${plan.vehicle_types.join(', ')})` : ''} to buy it.
          </Notice>
        )}

        {eligible.length > 0 && (forPerson || eligible.length > 1) && (
          <div>
            <label htmlFor="cover-target" className="classic-label">Who is covered</label>
            <select id="cover-target" className="classic-input" value={target} onChange={(e) => setTarget(e.target.value)}>
              {eligible.map((r) => <option key={r.id} value={r.id}>{regLabel(r)}</option>)}
              {forPerson && <option value="self">Me, as a person</option>}
            </select>
          </div>
        )}

        {/* How to pay — reward points are a real way to pay */}
        <div>
          <p className="classic-label">How to pay</p>
          <div className="grid grid-cols-3 gap-1.5">
            {PAY_OPTIONS.map((o) => {
              const disabled = o.id !== 'wallet' && !plan.points_enabled;
              return (
                <button
                  key={o.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => setPay(o.id)}
                  aria-pressed={pay === o.id}
                  className={`rounded-xl px-1.5 py-2 text-[11px] font-semibold leading-tight ring-1 ring-inset transition-all disabled:opacity-40 ${
                    pay === o.id ? 'bg-orange-500 text-white ring-orange-500' : 'bg-white text-slate-600 ring-slate-200'
                  }`}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
          <p className="mt-1.5 text-[11px] text-slate-500">
            {plan.points_enabled ? PAY_OPTIONS.find((o) => o.id === pay)?.hint : 'This insurer does not take reward points on this plan.'}
          </p>
          {plan.points_enabled && (
            <p className="mt-1 flex items-center gap-1 text-[11px] text-slate-500">
              <Gift size={12} className="text-orange-500" />
              You have <span className="font-semibold text-slate-700">{points === null ? '…' : pts.toLocaleString()}</span> points; this cover is {pointsCost.toLocaleString()} points.
            </p>
          )}
          {pay === 'points_only' && !canPointsOnly && (
            <p className="mt-1 text-[11px] text-amber-700">You need {Math.max(0, pointsCost - pts).toLocaleString()} more points to pay with points only.</p>
          )}
        </div>

        {/* Data sharing — optional, and it can earn a discount */}
        <div>
          <p className="classic-label">Share with {insurer.name} (optional)</p>
          {plan.data_discount_pct > 0 && (
            <button
              type="button"
              onClick={() => setScopes((cur) => Array.from(new Set([...cur, ...plan.data_discount_scopes])))}
              className={`mb-2 w-full rounded-xl px-3 py-2 text-left text-xs ring-1 ring-inset ${discountOn ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : 'bg-amber-50 text-amber-900 ring-amber-200'}`}
            >
              {discountOn
                ? `Discount on: you save ${plan.data_discount_pct}% by sharing ${plan.data_discount_scopes.map(scopeLabel).join(' and ').toLowerCase()}.`
                : `Share ${plan.data_discount_scopes.map(scopeLabel).join(' and ').toLowerCase()} and save ${plan.data_discount_pct}%. Tap to turn it on.`}
            </button>
          )}
          <ul className="space-y-1.5">
            {SHARE_SCOPES.map((s) => (
              <li key={s.id}>
                <label className="flex cursor-pointer items-start gap-2 text-xs text-slate-700">
                  <input type="checkbox" className="mt-0.5" checked={scopes.includes(s.id)} onChange={() => toggleScope(s.id)} />
                  <span><span className="font-semibold">{s.label}</span><span className="block text-[11px] text-slate-500">{s.help}</span></span>
                </label>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[11px] text-slate-400">The insurer sees only what you tick. Change it any time, and see every time they look.</p>
        </div>

        <label className="flex cursor-pointer items-start gap-2 text-xs text-slate-700">
          <input type="checkbox" className="mt-0.5" checked={autoRenew} onChange={(e) => setAutoRenew(e.target.checked)} />
          <span>
            <span className="font-semibold">Renew automatically</span>
            <span className="block text-[11px] text-slate-500">
              One day before it ends, the same way you chose to pay. If the money or points are short, nothing is charged and we tell you.
            </span>
          </span>
        </label>

        {plan.terms_url && (
          <a href={plan.terms_url} target="_blank" rel="noopener noreferrer" className="block text-[11px] text-slate-500 underline">Read the policy terms</a>
        )}

        {/* Summary + pay */}
        <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
          <p className="font-semibold text-slate-800">You pay</p>
          <p className="mt-0.5">
            {pointsUsed > 0 && <span>{pointsUsed.toLocaleString()} points</span>}
            {pointsUsed > 0 && walletPart > 0 && <span> + </span>}
            {(walletPart > 0 || pointsUsed === 0) && <Amount ican={walletPart > 0 ? walletPart : price} rate={rate} />}
          </p>
        </div>

        {needsPin && (
          <SetPinPrompt
            userId={userId}
            onDone={async () => {
              setNeedsPin(false);
              try { if (await hasPinSet(userId)) setStep('pin'); } catch { /* they can tap Continue again */ }
            }}
          />
        )}

        {short && (
          <Notice tone="warn">
            <p className="font-semibold">Your wallet doesn't have enough IcanEra for this.</p>
            <p className="mt-0.5">You have {formatIcan(balance)} and need {formatIcan(walletPart)}. Add some, or pay with reward points.</p>
            {onGoToWallet && (
              <button type="button" onClick={onGoToWallet} className="classic-btn classic-btn-outline mt-2 !w-auto !min-h-[34px] !rounded-full !px-4 !py-1 !text-[12px]">Open wallet</button>
            )}
          </Notice>
        )}

        {step === 'pin' ? (
          <form onSubmit={(e) => { e.preventDefault(); if (validatePIN(pin) && !busy && !payBlocked) submit(); }} className="space-y-3">
            <div>
              <label htmlFor="cover-pin" className="classic-label">Transaction PIN</label>
              <input
                id="cover-pin" type="password" inputMode="numeric" autoComplete="off" maxLength={6} autoFocus
                value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                placeholder="4–6 digit PIN" disabled={busy}
                className="classic-input text-center text-lg tracking-widest"
              />
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => { setStep('review'); setPin(''); }} disabled={busy} className="classic-btn classic-btn-outline !w-auto !flex-none !rounded-full !px-6">Back</button>
              <button type="submit" disabled={busy || !validatePIN(pin) || payBlocked} className="classic-btn classic-btn-primary !rounded-full whitespace-nowrap">
                {busy ? 'Paying…' : pay === 'points_only' ? 'Pay with points' : 'Pay and get covered'}
              </button>
            </div>
          </form>
        ) : (
          <button type="button" onClick={start} disabled={payBlocked} className="classic-btn classic-btn-primary !rounded-full disabled:opacity-50">
            <Wallet size={15} /> Continue
          </button>
        )}
      </div>
    </Sheet>
  );
}
