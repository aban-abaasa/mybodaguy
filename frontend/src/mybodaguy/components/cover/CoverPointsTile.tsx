import { useEffect, useState } from 'react';
import { Shield } from 'lucide-react';
import { supabase } from '../../services/supabaseClient';
import { insuranceService, coverTypeLabel, periodLabel, type CoverPlan } from '../../services/insuranceService';
import CoverCheckout, { type RiderReg } from './CoverCheckout';
import { useLocalRate } from './coverCommon';

interface Props {
  userId: string;
  role: 'customer' | 'rider';
  // The reward points balance already on screen.
  points: number;
  // After a purchase, so the points balance and the live card can refresh.
  onChanged?: () => void;
  onGoToWallet?: () => void;
}

// "Get insured with your points" — on the Rewards tab. Shows the cheapest plans an insurer lets people
// pay for with points, and how close the person is to each. Says nothing at all if there are none
// (or insurance is not installed yet), so the Rewards tab never carries a dead card.
export default function CoverPointsTile({ userId, role, points, onChanged, onGoToWallet }: Props) {
  const rate = useLocalRate(userId);
  const [plans, setPlans] = useState<CoverPlan[] | null>(null);
  const [riders, setRiders] = useState<RiderReg[]>([]);
  const [picked, setPicked] = useState<CoverPlan | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [person, rider, regs] = await Promise.all([
        insuranceService.listPlans('person'),
        role === 'rider' ? insuranceService.listPlans('rider') : Promise.resolve({ data: [] as CoverPlan[] }),
        role === 'rider'
          ? supabase.from('mbg_riders').select('id, vehicle_type, plate_number, status').eq('user_id', userId)
          : Promise.resolve({ data: [] as RiderReg[] }),
      ]);
      if (cancelled) return;
      const byId = new Map<string, CoverPlan>();
      [...(rider.data ?? []), ...(person.data ?? [])].forEach((p) => { if (p.points_enabled && p.points_cost != null) byId.set(p.plan_id, p); });
      setPlans(Array.from(byId.values()).sort((a, b) => Number(a.points_cost) - Number(b.points_cost)).slice(0, 3));
      setRiders(((regs as { data: RiderReg[] | null }).data ?? []) as RiderReg[]);
    })();
    return () => { cancelled = true; };
  }, [userId, role]);

  if (!plans || plans.length === 0) return null;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
      <h4 className="font-semibold text-slate-800 mb-1 flex items-center gap-2">
        <Shield size={16} className="text-emerald-600" /> Get insured with your points
      </h4>
      <p className="text-xs text-slate-500 mb-3">Insurance companies let you pay for cover with the points you earn on rides. Your cover shows on your card.</p>
      <ul className="space-y-2.5">
        {plans.map((p) => {
          const cost = Number(p.points_cost);
          const pct = cost > 0 ? Math.min(100, Math.round((points / cost) * 100)) : 0;
          const enough = points >= cost;
          return (
            <li key={p.plan_id} className="rounded-xl border border-slate-100 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-800">{p.name}</p>
                  <p className="truncate text-[11px] text-slate-500">{p.insurer.name} · {coverTypeLabel(p.cover_type)} · per {periodLabel(p.period_days)}</p>
                </div>
                <span className="flex-shrink-0 text-xs font-bold text-orange-600">{cost.toLocaleString()} pts</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden>
                <div className={`h-full rounded-full ${enough ? 'bg-emerald-500' : 'bg-orange-400'}`} style={{ width: `${pct}%` }} />
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-[11px] text-slate-500">
                  {enough ? 'You have enough points to pay for this.' : `${(cost - Math.floor(points)).toLocaleString()} more points to pay with points only. Points + wallet works now.`}
                </span>
                <button
                  type="button"
                  onClick={() => setPicked(p)}
                  className="flex-shrink-0 rounded-lg bg-gradient-to-r from-orange-500 to-yellow-500 px-3 py-1.5 text-xs font-semibold text-white"
                >
                  Cover me
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {picked && (
        <CoverCheckout
          plan={picked}
          userId={userId}
          riders={riders}
          rate={rate}
          defaultPay={points >= Number(picked.points_cost) ? 'points_only' : 'points_first'}
          onGoToWallet={onGoToWallet}
          onClose={() => setPicked(null)}
          onDone={() => { setPicked(null); onChanged?.(); }}
        />
      )}
    </div>
  );
}
