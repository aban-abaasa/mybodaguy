import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Building2, RefreshCw, ShieldCheck, Users } from 'lucide-react';
import { supabase } from '../../services/supabaseClient';
import { InsuranceChip } from '../RiderIdCard';
import {
  coverTypeLabel,
  formatIcan,
  friendlyPayError,
  insuranceService,
  looksNotSetUp,
  periodLabel,
  renewWindowDays,
  type CardInsurance,
  type CoverPlan,
  type LocalRate,
  type MyPolicy,
} from '../../services/insuranceService';
import CoverPolicyPanel from './CoverPolicyPanel';
import { Amount, Notice, Sheet, useLocalRate } from './coverCommon';

interface DriverRow {
  id: string;
  user_id: string;
  full_name: string;
  vehicle_type: string;
  plate_number: string | null;
  status: string;
}

const vehicle = (d: DriverRow) =>
  `${d.vehicle_type.charAt(0).toUpperCase()}${d.vehicle_type.slice(1)}${d.plate_number && d.plate_number !== 'PENDING' ? ` · ${d.plate_number.toUpperCase()}` : ''}`;

const isLive = (c?: CardInsurance) => !!c && (c.state === 'active' || c.state === 'waiting' || c.state === 'grace');

// ── Buy cover for drivers, or for the company itself, from the business wallet ──────────────
function GroupCoverSheet({ businessId, kind, drivers, cover, rate, onClose, onDone }: {
  businessId: string; kind: 'rider' | 'business'; drivers: DriverRow[]; cover: Map<string, CardInsurance>;
  rate: LocalRate | null; onClose: () => void; onDone: () => void;
}) {
  const [plans, setPlans] = useState<CoverPlan[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [planId, setPlanId] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [quote, setQuote] = useState<{ per: number; total: number; group: boolean } | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    insuranceService.listPlans(kind).then(({ data, error: err }) => {
      if (cancelled) return;
      setError(err ?? null);
      setPlans(data ?? []);
      if (data?.[0]) setPlanId(data[0].plan_id);
    });
    supabase.from('ican_business_wallets').select('ican_balance').eq('business_profile_id', businessId).maybeSingle()
      .then(({ data }) => { if (!cancelled) setBalance(Number(data?.ican_balance ?? 0)); });
    return () => { cancelled = true; };
  }, [kind, businessId]);

  const plan = plans?.find((p) => p.plan_id === planId) ?? null;

  // Drivers this plan can cover (vehicle type) and who do not already have it.
  const eligible = useMemo(() => drivers.filter((d) => !plan?.vehicle_types || plan.vehicle_types.includes(d.vehicle_type)), [drivers, plan]);

  // Start with every eligible driver who has no live cover; the owner can tick or untick.
  useEffect(() => {
    if (kind !== 'rider') return;
    setPicked(new Set(eligible.filter((d) => !isLive(cover.get(d.id))).map((d) => d.id)));
  }, [kind, eligible, cover]);

  const count = kind === 'business' ? 1 : picked.size;

  useEffect(() => {
    if (!plan || count < 1) { setQuote(null); return; }
    let cancelled = false;
    insuranceService.quote(plan.plan_id, count, []).then(({ data }) => {
      if (!cancelled && data?.success) setQuote({ per: Number(data.per_member_ican), total: Number(data.total_ican), group: data.group_discount_applied });
    });
    return () => { cancelled = true; };
  }, [plan, count]);

  const short = quote && balance !== null && balance + 1e-9 < quote.total;

  const toggle = (id: string) => setPicked((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const submit = async () => {
    if (!plan) return;
    setBusy(true);
    const res = await insuranceService.subscribeBusiness({
      planId: plan.plan_id, businessId, kind, riderIds: Array.from(picked), pin,
    });
    setBusy(false);
    if (res.success) {
      const skipped = Number(res.skipped ?? 0);
      toast.success(kind === 'business' ? 'The company is covered.' : `${res.insured} driver${Number(res.insured) === 1 ? '' : 's'} covered${skipped ? ` (${skipped} already had it)` : ''}.`);
      onDone();
    } else {
      toast.error(friendlyPayError(res.error));
      setPin('');
    }
  };

  return (
    <Sheet title={kind === 'business' ? 'Insure the company' : 'Insure drivers'} onClose={onClose}>
      <div className="space-y-4">
        {plans === null ? (
          <p className="text-sm text-slate-500" role="status">Loading plans…</p>
        ) : error ? (
          <Notice tone="bad">{looksNotSetUp(error) ? 'Insurance is not switched on yet.' : error}</Notice>
        ) : plans.length === 0 ? (
          <Notice>No insurance company has a plan for {kind === 'business' ? 'businesses' : 'drivers'} yet.</Notice>
        ) : (
          <>
            <div>
              <label htmlFor="grp-plan" className="classic-label">Plan</label>
              <select id="grp-plan" className="classic-input" value={planId} onChange={(e) => setPlanId(e.target.value)}>
                {plans.map((p) => (
                  <option key={p.plan_id} value={p.plan_id}>
                    {p.name} · {p.insurer.name} · {formatIcan(p.price_ican)} ICAN / {periodLabel(p.period_days)}
                  </option>
                ))}
              </select>
              {plan && (
                <p className="mt-1 text-[11px] text-slate-500">
                  {coverTypeLabel(plan.cover_type)} · covers up to {formatIcan(plan.cover_limit_ican)} ICAN each
                  {plan.group_discount_pct > 0 && ` · ${plan.group_discount_pct}% off for ${plan.group_min_members}+ ${kind === 'rider' ? 'drivers' : 'insured'}`}
                </p>
              )}
            </div>

            {kind === 'rider' && (
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <p className="classic-label !mb-0">Drivers ({picked.size} chosen)</p>
                  <button type="button" className="text-[11px] text-slate-500 underline" onClick={() => setPicked(new Set(eligible.map((d) => d.id)))}>All</button>
                </div>
                <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-xl ring-1 ring-black/5">
                  {drivers.map((d) => {
                    const ok = eligible.some((e) => e.id === d.id);
                    const live = isLive(cover.get(d.id));
                    return (
                      <li key={d.id}>
                        <label className={`flex items-center gap-2.5 px-3 py-2 text-xs ${ok ? 'cursor-pointer' : 'opacity-40'}`}>
                          <input type="checkbox" disabled={!ok} checked={picked.has(d.id)} onChange={() => toggle(d.id)} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-semibold text-slate-800">{d.full_name}</span>
                            <span className="block truncate text-slate-500">{vehicle(d)}{!ok ? ' · not covered by this plan' : ''}</span>
                          </span>
                          {live && <span className="flex-shrink-0 text-[10px] font-semibold text-emerald-700">Has cover</span>}
                        </label>
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-1 text-[11px] text-slate-400">A driver who already has this cover is skipped and not charged.</p>
              </div>
            )}

            {quote && (
              <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
                <p className="font-semibold text-slate-800">The business pays</p>
                <p className="mt-0.5"><Amount ican={quote.total} rate={rate} /></p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  {formatIcan(quote.per)} ICAN × {count}{quote.group ? ' · group discount applied' : ''}. Business wallet: {formatIcan(balance)} ICAN.
                </p>
              </div>
            )}
            {short && <Notice tone="warn">The business wallet does not have enough IcanEra for this. Top it up first, or insure fewer drivers.</Notice>}

            <div>
              <label htmlFor="grp-pin" className="classic-label">Business-wallet PIN</label>
              <input
                id="grp-pin" type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={pin} disabled={busy}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} placeholder="4–6 digit PIN"
                className="classic-input text-center text-lg tracking-widest"
              />
              <p className="mt-1 text-[11px] text-slate-400">Only an owner or administrator can pay from the business wallet.</p>
            </div>
            <button type="button" onClick={submit} disabled={busy || !plan || count < 1 || pin.length < 4 || !!short} className="classic-btn classic-btn-primary !rounded-full disabled:opacity-50">
              {busy ? 'Paying…' : 'Pay and insure'}
            </button>
          </>
        )}
      </div>
    </Sheet>
  );
}

// ── Renew everything that is due, with one PIN ──────────────────────────────────────────────
function BulkRenewSheet({ due, onClose, onDone }: { due: MyPolicy[]; onClose: () => void; onDone: () => void }) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const total = due.reduce((sum, p) => sum + p.renewal_price_ican, 0);

  const run = async () => {
    setBusy(true);
    let done = 0;
    for (const p of due) {
      const res = await insuranceService.renew(p.policy_id, { pin });
      if (!res.success) {
        toast.error(`${p.insured_label ?? p.policy_number}: ${friendlyPayError(res.error)}`);
        break;
      }
      done += 1;
      setProgress(done);
    }
    setBusy(false);
    if (done > 0) toast.success(`${done} of ${due.length} renewed`);
    if (done > 0 || due.length === 0) onDone();
  };

  return (
    <Sheet title="Renew what is due" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">{due.length} {due.length === 1 ? 'policy is' : 'policies are'} expiring or lapsed. Renewing them costs {formatIcan(total)} ICAN in total from the business wallet.</p>
        <div>
          <label htmlFor="bulk-pin" className="classic-label">Business-wallet PIN</label>
          <input
            id="bulk-pin" type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={pin} disabled={busy}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} placeholder="4–6 digit PIN"
            className="classic-input text-center text-lg tracking-widest"
          />
        </div>
        <button type="button" onClick={run} disabled={busy || pin.length < 4} className="classic-btn classic-btn-primary !rounded-full disabled:opacity-50">
          {busy ? `Renewing… ${progress}/${due.length}` : 'Renew all'}
        </button>
      </div>
    </Sheet>
  );
}

// ── The company's insurance: cover for its drivers and for itself ───────────────────────────
export default function BusinessCover({ businessProfileId, category }: { businessProfileId: string; category: 'transport_company' | 'security_escort' }) {
  const [userId, setUserId] = useState('');
  const rate = useLocalRate(userId);
  const [policies, setPolicies] = useState<MyPolicy[] | null>(null);
  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [cover, setCover] = useState<Map<string, CardInsurance>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'rider' | 'business' | 'renew' | null>(null);

  useEffect(() => { supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? '')); }, []);

  const load = useCallback(async () => {
    const [pol, drv, cov] = await Promise.all([
      insuranceService.businessPolicies(businessProfileId),
      supabase.rpc('mbg_business_list_drivers', { p_business_profile_id: businessProfileId }),
      insuranceService.driverCover(businessProfileId),
    ]);
    setError(pol.error ?? null);
    setPolicies(pol.data ?? []);
    setDrivers((drv.data ?? []) as DriverRow[]);
    setCover(new Map((cov.data ?? []).map((c) => [c.rider_id, c.insurance])));
  }, [businessProfileId]);

  useEffect(() => { load(); }, [load]);

  const stats = useMemo(() => {
    const list = policies ?? [];
    const live = list.filter((p) => p.state === 'active' || p.state === 'waiting');
    const due = list.filter((p) => p.state !== 'cancelled' && p.plan.active && (p.state === 'grace' || p.state === 'expired' || (p.state === 'active' && p.days_left <= Math.min(7, renewWindowDays(p.plan.period_days)))));
    const uninsured = drivers.filter((d) => !isLive(cover.get(d.id))).length;
    return { live: live.length, due, uninsured };
  }, [policies, drivers, cover]);

  const ordered = useMemo(() => {
    const rank: Record<string, number> = { expired: 0, grace: 1, waiting: 2, active: 3, cancelled: 4 };
    return [...(policies ?? [])].sort((a, b) => (rank[a.state] - rank[b.state]) || a.days_left - b.days_left);
  }, [policies]);

  if (error && looksNotSetUp(error)) {
    return <Notice>Insurance is not switched on yet. It will appear here once it is.</Notice>;
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-slate-600">
          Cover for {category === 'security_escort' ? 'your escort team' : 'your drivers'} and for the company. Every insured driver&apos;s cover shows on their live rider card.
        </p>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-emerald-50 p-2.5"><p className="text-lg font-bold text-emerald-700">{stats.live}</p><p className="text-[10px] uppercase tracking-wider text-emerald-600">Covered</p></div>
          <div className="rounded-xl bg-amber-50 p-2.5"><p className="text-lg font-bold text-amber-700">{stats.due.length}</p><p className="text-[10px] uppercase tracking-wider text-amber-600">Due</p></div>
          <div className="rounded-xl bg-slate-50 p-2.5"><p className="text-lg font-bold text-slate-700">{stats.uninsured}</p><p className="text-[10px] uppercase tracking-wider text-slate-500">Drivers uncovered</p></div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setSheet('rider')} disabled={drivers.length === 0} className="classic-btn classic-btn-primary !w-auto !gap-1.5 !rounded-full !px-4 disabled:opacity-50">
          <Users size={15} /> Insure drivers
        </button>
        <button type="button" onClick={() => setSheet('business')} className="classic-btn classic-btn-outline !w-auto !gap-1.5 !rounded-full !px-4">
          <Building2 size={15} /> Insure the company
        </button>
        {stats.due.length > 0 && (
          <button type="button" onClick={() => setSheet('renew')} className="classic-btn classic-btn-outline !w-auto !gap-1.5 !rounded-full !px-4">
            <RefreshCw size={15} /> Renew what is due ({stats.due.length})
          </button>
        )}
      </div>

      {drivers.length > 0 && (
        <div>
          <p className="classic-label">Drivers</p>
          <ul className="divide-y divide-slate-100 rounded-xl ring-1 ring-black/5">
            {drivers.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-slate-800">{d.full_name}</span>
                  <span className="block truncate text-slate-500">{vehicle(d)}</span>
                </span>
                <InsuranceChip insurance={cover.get(d.id) ?? { state: 'none', policies: [] }} />
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <p className="classic-label flex items-center gap-1"><ShieldCheck size={12} /> Policies the company pays for</p>
        {policies === null ? (
          <p className="text-xs text-slate-400" role="status">Loading…</p>
        ) : ordered.length === 0 ? (
          <p className="text-xs text-slate-400">None yet.</p>
        ) : (
          <div className="space-y-3">
            {ordered.map((p) => (
              <CoverPolicyPanel key={p.policy_id} policy={p} userId={userId} rate={rate} mode="business" onChanged={load} />
            ))}
          </div>
        )}
      </div>

      {sheet === 'rider' && (
        <GroupCoverSheet businessId={businessProfileId} kind="rider" drivers={drivers} cover={cover} rate={rate}
          onClose={() => setSheet(null)} onDone={() => { setSheet(null); load(); }} />
      )}
      {sheet === 'business' && (
        <GroupCoverSheet businessId={businessProfileId} kind="business" drivers={drivers} cover={cover} rate={rate}
          onClose={() => setSheet(null)} onDone={() => { setSheet(null); load(); }} />
      )}
      {sheet === 'renew' && (
        <BulkRenewSheet due={stats.due} onClose={() => setSheet(null)} onDone={() => { setSheet(null); load(); }} />
      )}
    </div>
  );
}
