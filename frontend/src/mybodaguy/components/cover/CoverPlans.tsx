import { useMemo, useState } from 'react';
import { Gift, Percent, ShieldCheck, Users } from 'lucide-react';
import {
  coverTypeLabel,
  formatIcan,
  periodLabel,
  type CoverPlan,
  type LocalRate,
} from '../../services/insuranceService';
import { Amount, fmtDate } from './coverCommon';

interface Props {
  plans: CoverPlan[];
  rate: LocalRate | null;
  actionLabel?: string;
  onPick: (plan: CoverPlan) => void;
  // Plans the person already holds this kind of cover for are hidden from "get covered".
  emptyText?: string;
}

// The plans insurance companies sell. One price per plan; what it takes to get a discount is spelled out.
export default function CoverPlans({ plans, rate, actionLabel = 'Get this cover', onPick, emptyText }: Props) {
  const [type, setType] = useState<string>('all');
  const types = useMemo(() => Array.from(new Set(plans.map((p) => p.cover_type))), [plans]);
  const visible = type === 'all' ? plans : plans.filter((p) => p.cover_type === type);

  if (plans.length === 0) {
    return (
      <div className="classic-card px-5 py-7 text-center">
        <ShieldCheck className="mx-auto text-[#c4a052]" size={28} strokeWidth={1.6} />
        <p className="mt-2 text-sm text-slate-500">{emptyText ?? 'No insurance plans are on sale for you yet. Insurance companies are being verified; check back soon.'}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {types.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {['all', ...types].map((t) => (
            <button key={t} type="button" onClick={() => setType(t)} aria-pressed={type === t} className={`classic-chip ${type === t ? 'is-active' : ''}`}>
              {t === 'all' ? 'All' : coverTypeLabel(t)}
            </button>
          ))}
        </div>
      )}

      <ul className="space-y-3">
        {visible.map((p) => (
          <li key={p.plan_id} className="classic-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-classic-display text-lg font-semibold leading-tight text-slate-800">{p.name}</p>
                <p className="mt-0.5 truncate text-xs text-slate-500">{p.insurer.name} · {coverTypeLabel(p.cover_type)}</p>
                <p className="mt-0.5 text-[10px] text-slate-400">Licensed by {p.insurer.regulator} · valid to {fmtDate(p.insurer.licence_expiry)}</p>
              </div>
              <div className="flex-shrink-0 text-right">
                <p className="font-classic-display text-xl font-bold leading-none text-slate-900">{formatIcan(p.price_ican)}</p>
                <p className="mt-0.5 text-[10px] uppercase tracking-wider text-slate-400">ICAN / {periodLabel(p.period_days)}</p>
                {rate && <p className="mt-0.5 text-[10px] text-slate-400">{`≈ ${rate.currency} ${Math.round(p.price_ican * rate.priceLocal).toLocaleString()}`}</p>}
              </div>
            </div>

            {p.summary && <p className="mt-2 text-xs text-slate-600">{p.summary}</p>}

            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {p.points_enabled && p.points_cost != null && (
                <span className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-2 py-0.5 text-[10px] font-semibold text-orange-700 ring-1 ring-inset ring-orange-200">
                  <Gift size={10} /> Pay with points · {Number(p.points_cost).toLocaleString()} pts
                </span>
              )}
              {p.data_discount_pct > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
                  <Percent size={10} /> Save {p.data_discount_pct}% when you share your record
                </span>
              )}
              {p.group_discount_pct > 0 && p.audience.includes('rider') && (
                <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700 ring-1 ring-inset ring-sky-200">
                  <Users size={10} /> {p.group_discount_pct}% off for {p.group_min_members}+ drivers
                </span>
              )}
            </div>

            {p.benefits.length > 0 && (
              <ul className="mt-2.5 space-y-1 text-xs text-slate-600">
                {p.benefits.slice(0, 3).map((b) => <li key={b} className="flex gap-1.5"><span className="text-emerald-500">✓</span>{b}</li>)}
                {p.benefits.length > 3 && <li className="text-[11px] text-slate-400">+ {p.benefits.length - 3} more</li>}
              </ul>
            )}

            <div className="mt-3 flex items-center justify-between gap-3 border-t border-[#c4a052]/20 pt-3">
              <p className="min-w-0 text-[11px] text-slate-500">
                Covers up to <Amount ican={p.cover_limit_ican} rate={rate} />
                {p.waiting_days > 0 && <span> · {p.waiting_days}-day wait</span>}
              </p>
              <button type="button" onClick={() => onPick(p)} className="classic-btn classic-btn-primary !w-auto !min-h-[36px] !flex-none !rounded-full !px-5 !py-1.5 !text-[13px]">
                {actionLabel}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
