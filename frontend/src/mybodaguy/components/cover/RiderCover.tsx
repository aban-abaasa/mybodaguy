import { useCallback, useEffect, useMemo, useState } from 'react';
import { Shield } from 'lucide-react';
import { supabase } from '../../services/supabaseClient';
import {
  insuranceService,
  looksNotSetUp,
  type CoverPlan,
  type MyPolicy,
  type RenewWith,
} from '../../services/insuranceService';
import CoverCheckout, { type RiderReg } from './CoverCheckout';
import CoverPlans from './CoverPlans';
import CoverPolicyPanel from './CoverPolicyPanel';
import { Notice, useLocalRate } from './coverCommon';

interface Props {
  userId: string;
  // 'rider' shows rider plans and plans for people; 'person' only plans for people (a passenger).
  audience: 'rider' | 'person';
  // Called after anything changes, so the live card behind this can refresh.
  onChanged?: () => void;
  onGoToWallet?: () => void;
  // Opens the rider's live card, which shows this cover.
  onOpenCard?: () => void;
  // Plans pre-selected for points (the Rewards tab).
  defaultPay?: RenewWith;
}

// "Insurance cover": the cover you hold (open one for messages, claims and what you share),
// and the plans you can buy. What you hold shows on your live rider card.
export default function RiderCover({ userId, audience, onChanged, onGoToWallet, onOpenCard, defaultPay }: Props) {
  const rate = useLocalRate(userId);
  const [policies, setPolicies] = useState<MyPolicy[] | null>(null);
  const [plans, setPlans] = useState<CoverPlan[] | null>(null);
  const [riders, setRiders] = useState<RiderReg[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<CoverPlan | null>(null);
  const [showPast, setShowPast] = useState(false);

  const load = useCallback(async () => {
    const [mine, personPlans, riderPlans, regs] = await Promise.all([
      insuranceService.myPolicies(),
      insuranceService.listPlans('person'),
      audience === 'rider' ? insuranceService.listPlans('rider') : Promise.resolve({ data: [] as CoverPlan[] }),
      audience === 'rider'
        ? supabase.from('mbg_riders').select('id, vehicle_type, plate_number, status').eq('user_id', userId)
        : Promise.resolve({ data: [] as RiderReg[] }),
    ]);
    const err = mine.error ?? personPlans.error;
    setError(err ?? null);
    setPolicies(mine.data ?? []);
    const byId = new Map<string, CoverPlan>();
    [...(riderPlans.data ?? []), ...(personPlans.data ?? [])].forEach((p) => byId.set(p.plan_id, p));
    setPlans(Array.from(byId.values()));
    setRiders(((regs as { data: RiderReg[] | null }).data ?? []) as RiderReg[]);
  }, [audience, userId]);

  useEffect(() => { load(); }, [load]);

  const changed = () => { load(); onChanged?.(); };

  const covered = useMemo(() => new Set(
    (policies ?? [])
      .filter((p) => p.state === 'active' || p.state === 'waiting' || p.state === 'grace')
      .map((p) => `${p.insured_kind}:${p.insured_rider_id ?? ''}:${p.cover_type}`),
  ), [policies]);

  // A plan stays on offer unless every way of buying it would be a duplicate.
  const buyable = useMemo(() => (plans ?? []).filter((p) => {
    const regsFor = audience === 'rider' && p.audience.includes('rider')
      ? riders.filter((r) => !p.vehicle_types || p.vehicle_types.includes(r.vehicle_type)) : [];
    const riderFree = regsFor.some((r) => !covered.has(`rider:${r.id}:${p.cover_type}`));
    const personFree = p.audience.includes('person') && !covered.has(`person::${p.cover_type}`);
    if (p.audience.includes('rider') && !p.audience.includes('person')) return riderFree;
    return riderFree || personFree;
  }), [plans, riders, covered, audience]);

  if (error && looksNotSetUp(error)) {
    return (
      <div className="classic-card px-5 py-6 text-center">
        <Shield className="mx-auto text-[#c4a052]" size={26} strokeWidth={1.6} />
        <p className="mt-2 font-classic-display text-lg font-semibold text-slate-800">Insurance cover is coming soon</p>
        <p className="mt-1 text-sm text-slate-500">It will appear here, and on your card, once it is switched on.</p>
      </div>
    );
  }

  const live = (policies ?? []).filter((p) => p.state === 'active' || p.state === 'waiting' || p.state === 'grace');
  const past = (policies ?? []).filter((p) => !live.includes(p));

  return (
    <div className="space-y-4">
      <div>
        <p className="classic-eyebrow">Protection</p>
        <h2 className="mt-1 font-classic-display text-[24px] font-bold leading-tight tracking-tight text-slate-900">Insurance cover</h2>
        <p className="mt-1 text-sm text-slate-500">
          {audience === 'rider'
            ? 'Cover from licensed insurance companies. What you hold shows on your live rider card, so anyone who scans it can see you are protected.'
            : 'Cover from licensed insurance companies, paid with your ICAN wallet or your reward points.'}
        </p>
        <div className="landing-classic-divider mt-3" />
      </div>

      {error && <Notice tone="bad">{error}</Notice>}

      {policies === null ? (
        <div className="classic-card px-6 py-8 text-center text-sm text-slate-500" role="status">Loading your cover…</div>
      ) : (
        <>
          {live.length === 0 && past.length === 0 && (
            <Notice>You do not have any insurance cover yet. Pick a plan below; you can pay with ICAN, with reward points, or both.</Notice>
          )}
          {live.map((p) => (
            <CoverPolicyPanel key={p.policy_id} policy={p} userId={userId} rate={rate} onChanged={changed} />
          ))}
          {live.length > 0 && onOpenCard && (
            <button type="button" onClick={onOpenCard} className="classic-btn classic-btn-outline !gap-1.5 !rounded-full">
              <Shield size={15} /> See it on my rider card
            </button>
          )}
          {past.length > 0 && (
            <div className="space-y-3">
              <button type="button" onClick={() => setShowPast((s) => !s)} className="text-xs font-semibold text-slate-500 underline decoration-dotted">
                {showPast ? 'Hide past cover' : `Past cover (${past.length})`}
              </button>
              {showPast && past.map((p) => (
                <CoverPolicyPanel key={p.policy_id} policy={p} userId={userId} rate={rate} onChanged={changed} />
              ))}
            </div>
          )}

          <div>
            <p className="classic-eyebrow">{live.length > 0 ? 'More cover' : 'Get covered'}</p>
          </div>
          {plans === null ? (
            <div className="classic-card px-6 py-8 text-center text-sm text-slate-500" role="status">Loading plans…</div>
          ) : (
            <CoverPlans plans={buyable} rate={rate} onPick={setPicked} emptyText={
              plans.length > 0 ? 'You already hold every kind of cover on offer. Renew from above when it is due.' : undefined} />
          )}
        </>
      )}

      {picked && (
        <CoverCheckout
          plan={picked}
          userId={userId}
          riders={riders}
          rate={rate}
          defaultPay={defaultPay}
          onGoToWallet={onGoToWallet}
          onClose={() => setPicked(null)}
          onDone={() => { setPicked(null); changed(); }}
        />
      )}
    </div>
  );
}
