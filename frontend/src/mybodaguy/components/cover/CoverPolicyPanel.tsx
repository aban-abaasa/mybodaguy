import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ChevronDown, FileText, MessageSquare, RefreshCw, Share2, ShieldCheck, ShieldAlert } from 'lucide-react';
import { ToneChip } from '../RiderIdCard';
import { verifyPin, validatePIN } from '../../services/pinService';
import { getRewardSummary } from '../../services/rewardsService';
import {
  coverTypeLabel,
  formatIcan,
  friendlyPayError,
  insuranceService,
  periodLabel,
  renewWindowDays,
  type LocalRate,
  type MyPolicy,
  type PolicyPayment,
  type RenewWith,
} from '../../services/insuranceService';
import CoverClaims from './CoverClaims';
import CoverMessages from './CoverMessages';
import CoverSharing from './CoverSharing';
import { Amount, Notice, Sheet, StateChip, fmtDate } from './coverCommon';

type Tab = 'overview' | 'messages' | 'claims' | 'sharing';

interface Props {
  policy: MyPolicy;
  userId: string;
  rate: LocalRate | null;
  // 'holder': the insured person (or the person who pays). 'business': a company managing cover it pays for.
  mode?: 'holder' | 'business';
  onChanged: () => void;
  defaultOpen?: boolean;
}

const PAY_LABEL: Record<RenewWith, string> = {
  wallet: 'My ICAN wallet',
  points_first: 'Reward points first, then wallet',
  points_only: 'Reward points only',
};

function RenewSheet({ policy, userId, mode, rate, onClose, onDone }: {
  policy: MyPolicy; userId: string; mode: 'holder' | 'business'; rate: LocalRate | null; onClose: () => void; onDone: () => void;
}) {
  const business = mode === 'business' || policy.payer_kind === 'business';
  const [pay, setPay] = useState<RenewWith>('wallet');
  const [pin, setPin] = useState('');
  const [points, setPoints] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (business || !policy.plan.points_enabled) return;
    getRewardSummary(userId).then((s) => setPoints(Math.floor(Number(s.points_balance ?? 0)))).catch(() => setPoints(0));
  }, [business, policy.plan.points_enabled, userId]);

  const cost = policy.renewal_points_cost ?? 0;
  const pinOk = business ? pin.length >= 4 : validatePIN(pin);

  const submit = async () => {
    setBusy(true);
    try {
      if (!business) {
        const check = await verifyPin(userId, pin);
        if (!check.success) { toast.error(check.error || 'Incorrect PIN'); setPin(''); return; }
      }
      const res = await insuranceService.renew(policy.policy_id, business
        ? { pin }
        : { usePoints: pay !== 'wallet', pointsOnly: pay === 'points_only' });
      if (res.success) { toast.success('Renewed. You are covered for another period.'); onDone(); }
      else toast.error(friendlyPayError(res.error));
    } catch {
      toast.error("We couldn't complete the payment. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title="Renew cover" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          {policy.plan.name} · {policy.insurer.name}. New cover starts when the current one ends
          {policy.state === 'active' || policy.state === 'waiting' ? ` (${fmtDate(policy.ends_at)})` : ''}.
        </p>
        <div className="rounded-xl bg-slate-50 p-3 text-sm">
          <p className="text-[11px] uppercase tracking-wider text-slate-400">Price for {periodLabel(policy.plan.period_days)}</p>
          <p className="mt-0.5"><Amount ican={policy.renewal_price_ican} rate={rate} /></p>
        </div>

        {!business && policy.plan.points_enabled && (
          <div>
            <label htmlFor="renew-pay" className="classic-label">Pay with</label>
            <select id="renew-pay" className="classic-input" value={pay} onChange={(e) => setPay(e.target.value as RenewWith)}>
              {(Object.keys(PAY_LABEL) as RenewWith[]).map((k) => <option key={k} value={k}>{PAY_LABEL[k]}</option>)}
            </select>
            <p className="mt-1 text-[11px] text-slate-500">
              You have {points === null ? '…' : points.toLocaleString()} points; this renewal is {cost.toLocaleString()} points.
            </p>
          </div>
        )}

        <div>
          <label htmlFor="renew-pin" className="classic-label">{business ? 'Business-wallet PIN' : 'Transaction PIN'}</label>
          <input
            id="renew-pin" type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} placeholder="4–6 digit PIN" disabled={busy}
            className="classic-input text-center text-lg tracking-widest"
          />
          {business && <p className="mt-1 text-[11px] text-slate-400">Paid from the business wallet.</p>}
        </div>
        <button type="button" onClick={submit} disabled={busy || !pinOk} className="classic-btn classic-btn-primary !rounded-full">
          {busy ? 'Paying…' : 'Renew now'}
        </button>
      </div>
    </Sheet>
  );
}

export default function CoverPolicyPanel({ policy, userId, rate, mode = 'holder', onChanged, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const [tab, setTab] = useState<Tab>('overview');
  const [renewing, setRenewing] = useState(false);
  const [payments, setPayments] = useState<PolicyPayment[] | null>(null);
  const [auto, setAuto] = useState(policy.auto_renew);
  const [autoWith, setAutoWith] = useState<RenewWith>(policy.renew_with);
  const [savingAuto, setSavingAuto] = useState(false);

  const isBusinessMode = mode === 'business';
  const isPayer = isBusinessMode || policy.role === 'payer' || policy.role === 'both';
  const personalPayer = isPayer && policy.payer_kind === 'user';
  const lapsed = policy.state === 'expired' || policy.state === 'grace';
  const canRenew = isPayer && policy.state !== 'cancelled' && policy.plan.active && policy.days_left <= renewWindowDays(policy.plan.period_days);
  const limit = policy.plan.cover_limit_ican;

  useEffect(() => { setAuto(policy.auto_renew); setAutoWith(policy.renew_with); }, [policy.auto_renew, policy.renew_with]);

  useEffect(() => {
    if (!open || tab !== 'overview' || !isPayer || payments !== null) return;
    insuranceService.payments(policy.policy_id).then(({ data }) => setPayments(data ?? []));
  }, [open, tab, isPayer, payments, policy.policy_id]);

  const saveAuto = async () => {
    setSavingAuto(true);
    const res = await insuranceService.setAutoRenew(policy.policy_id, auto, autoWith);
    setSavingAuto(false);
    if (res.success) { toast.success(auto ? 'Automatic renewal is on' : 'Automatic renewal is off'); onChanged(); }
    else toast.error(res.error || 'Could not change renewal');
  };

  const stopRenewing = async () => {
    if (!window.confirm(`Stop renewing this cover? It keeps protecting you until ${fmtDate(policy.ends_at)}.`)) return;
    const res = await insuranceService.stopRenewing(policy.policy_id);
    if (res.success) { toast.success(`Renewal stopped. Your cover runs until ${fmtDate(policy.ends_at)}.`); onChanged(); }
    else toast.error(res.error || 'Could not stop renewal');
  };

  const tabs: { id: Tab; label: string; icon: typeof FileText; badge?: number }[] = [
    { id: 'overview', label: 'Cover', icon: FileText },
    { id: 'messages', label: 'Messages', icon: MessageSquare, badge: policy.unread_from_insurer },
    { id: 'claims', label: 'Claims', icon: ShieldAlert, badge: policy.open_claims },
    { id: 'sharing', label: 'Sharing', icon: Share2 },
  ];

  const sharingAllowed = isBusinessMode ? true : policy.role === 'insured' || policy.role === 'both';

  return (
    <div className="classic-card overflow-hidden">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-3 p-4 text-left">
        <span className={`grid h-11 w-11 flex-shrink-0 place-items-center rounded-full ring-1 ring-inset ${
          lapsed ? 'bg-amber-50 text-amber-600 ring-amber-100' : 'bg-emerald-50 text-emerald-600 ring-emerald-100'}`}>
          {lapsed ? <ShieldAlert size={20} /> : <ShieldCheck size={20} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-classic-display text-lg font-semibold leading-tight text-slate-800">{policy.plan.name}</span>
          <span className="block truncate text-xs text-slate-500">
            {policy.insurer.name} · {coverTypeLabel(policy.cover_type)}{policy.insured_label ? ` · ${policy.insured_label}` : ''}
          </span>
          <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <StateChip state={policy.state} />
            <span className="text-[11px] text-slate-500">
              {policy.state === 'waiting' ? `Starts ${fmtDate(policy.cover_starts_at)}`
                : policy.state === 'expired' ? `Ended ${fmtDate(policy.ends_at)}`
                : `Until ${fmtDate(policy.ends_at)}${policy.days_left <= 30 ? ` · ${policy.days_left} day${policy.days_left === 1 ? '' : 's'} left` : ''}`}
            </span>
            {policy.unread_from_insurer > 0 && <ToneChip tone="warn">{policy.unread_from_insurer} new</ToneChip>}
          </span>
        </span>
        <ChevronDown size={18} className={`flex-shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="space-y-4 border-t border-[#c4a052]/25 px-4 pb-4 pt-3">
          <div className="flex gap-1 overflow-x-auto" role="tablist">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={`flex flex-none items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                  tab === t.id ? 'bg-orange-500 text-white' : 'bg-slate-100 text-slate-600'}`}
              >
                <t.icon size={12} /> {t.label}
                {t.badge ? <span className={`ml-0.5 rounded-full px-1.5 text-[10px] ${tab === t.id ? 'bg-white/25' : 'bg-orange-500 text-white'}`}>{t.badge}</span> : null}
              </button>
            ))}
          </div>

          {tab === 'overview' && (
            <div className="space-y-4">
              {isBusinessMode || policy.payer_kind === 'business' ? (
                <p className="text-xs text-slate-500">Paid by <span className="font-semibold text-slate-700">{policy.payer_name}</span>{policy.group_size > 1 ? ` as part of a group of ${policy.group_size}` : ''}.</p>
              ) : null}

              <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                <div><dt className="text-[10px] text-slate-400">Policy number</dt><dd className="font-mono font-semibold text-slate-800">{policy.policy_number}</dd></div>
                <div><dt className="text-[10px] text-slate-400">Covers up to</dt><dd><Amount ican={limit} rate={rate} /></dd></div>
                <div><dt className="text-[10px] text-slate-400">Cover began</dt><dd className="text-slate-700">{fmtDate(policy.cover_starts_at)}</dd></div>
                <div><dt className="text-[10px] text-slate-400">Ends</dt><dd className="text-slate-700">{fmtDate(policy.ends_at)}</dd></div>
                {policy.insured_label && <div className="col-span-2"><dt className="text-[10px] text-slate-400">Insured</dt><dd className="text-slate-700">{policy.insured_name} · {policy.insured_label}</dd></div>}
              </dl>

              {policy.plan.benefits.length > 0 && (
                <ul className="space-y-1 text-xs text-slate-600">
                  {policy.plan.benefits.map((b) => <li key={b} className="flex gap-1.5"><span className="text-emerald-500">✓</span>{b}</li>)}
                </ul>
              )}
              {policy.plan.terms_url && <a href={policy.plan.terms_url} target="_blank" rel="noopener noreferrer" className="block text-[11px] text-slate-500 underline">Read the policy terms</a>}

              {policy.last_renewal_error && personalPayer && (
                <Notice tone="warn">Your last automatic renewal did not go through: {policy.last_renewal_error}</Notice>
              )}

              {canRenew && (
                <div className="space-y-2">
                  <button type="button" onClick={() => setRenewing(true)} className={`classic-btn !gap-1.5 !rounded-full ${lapsed ? 'classic-btn-primary' : 'classic-btn-outline'}`}>
                    <RefreshCw size={15} /> Renew for {formatIcan(policy.renewal_price_ican)} ICAN
                  </button>
                  {!policy.plan.active && <p className="text-[11px] text-amber-700">This plan is no longer on sale, so it cannot be renewed.</p>}
                </div>
              )}
              {isPayer && !policy.plan.active && !canRenew && policy.state !== 'cancelled' && (
                <Notice tone="warn">This plan is no longer on sale, so it cannot be renewed. Your cover runs until {fmtDate(policy.ends_at)}.</Notice>
              )}

              {personalPayer && policy.state !== 'cancelled' && (
                <div className="space-y-2 rounded-xl bg-slate-50 p-3">
                  <label className="flex cursor-pointer items-start gap-2 text-xs text-slate-700">
                    <input type="checkbox" className="mt-0.5" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
                    <span><span className="font-semibold">Renew automatically</span><span className="block text-[11px] text-slate-500">One day before it ends. Nothing is charged if the money or points are short.</span></span>
                  </label>
                  {auto && (
                    <select className="classic-input" value={autoWith} onChange={(e) => setAutoWith(e.target.value as RenewWith)} aria-label="Renew with">
                      {(Object.keys(PAY_LABEL) as RenewWith[])
                        .filter((k) => k === 'wallet' || policy.plan.points_enabled)
                        .map((k) => <option key={k} value={k}>{PAY_LABEL[k]}</option>)}
                    </select>
                  )}
                  <div className="flex gap-2">
                    <button type="button" onClick={saveAuto} disabled={savingAuto || (auto === policy.auto_renew && autoWith === policy.renew_with)} className="classic-btn classic-btn-outline !w-auto !min-h-[34px] !rounded-full !px-4 !py-1 !text-[12px] disabled:opacity-50">
                      {savingAuto ? 'Saving…' : 'Save'}
                    </button>
                    {policy.auto_renew && (
                      <button type="button" onClick={stopRenewing} className="text-[11px] text-slate-500 underline">Stop renewing</button>
                    )}
                  </div>
                </div>
              )}
              {isBusinessMode && policy.state !== 'cancelled' && (
                <p className="text-[11px] text-slate-500">
                  A company renews with its business-wallet PIN each time, so nothing is ever charged without an administrator.
                </p>
              )}

              {isPayer && payments && payments.length > 0 && (
                <div>
                  <p className="classic-label">Payments</p>
                  <ul className="divide-y divide-slate-100 rounded-xl ring-1 ring-black/5">
                    {payments.map((p) => (
                      <li key={p.at} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                        <span className="text-slate-600">{fmtDate(p.at)} · {p.kind === 'purchase' ? 'Bought' : 'Renewed'}</span>
                        <span className="text-right">
                          <span className="font-semibold text-slate-800">{formatIcan(p.total_ican)} ICAN</span>
                          {p.points_used > 0 && <span className="block text-[10px] text-slate-400">{Number(p.points_used).toLocaleString()} points</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {tab === 'messages' && <CoverMessages policyId={policy.policy_id} insurerName={policy.insurer.name} onRead={onChanged} />}
          {tab === 'claims' && <CoverClaims policy={policy} rate={rate} onChanged={onChanged} />}
          {tab === 'sharing' && (sharingAllowed
            ? <CoverSharing policy={policy} mode={isBusinessMode ? 'business' : 'holder'} onChanged={onChanged} />
            : <Notice>{policy.insured_name} decides what of their own is shared with {policy.insurer.name}.</Notice>)}
        </div>
      )}

      {renewing && (
        <RenewSheet
          policy={policy} userId={userId} mode={mode} rate={rate}
          onClose={() => setRenewing(false)}
          onDone={() => { setRenewing(false); setPayments(null); onChanged(); }}
        />
      )}
    </div>
  );
}
