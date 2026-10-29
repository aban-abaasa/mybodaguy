import { useEffect, useState } from 'react';
import { CheckCircle2, Circle, Star, TrendingUp, Car, Users, Activity, Wallet } from 'lucide-react';
import { supabase } from '../../services/supabaseClient';
import { formatMoney } from '../services/money';
import {
  businessService,
  isLive,
  type AccessState,
  type BusinessCategory,
  type BusinessOverview,
  type BusinessRegistration,
} from '../services/businessService';

export type BusinessTab = 'overview' | 'profile' | 'roster' | 'pricing' | 'cover' | 'api';

interface OverviewBusiness {
  id: string;
  category_key: BusinessCategory;
  avatar_url: string | null;
  description: string | null;
  home_city: string | null;
}

function Kpi({ icon: Icon, label, value, hint }: { icon: typeof Car; label: string; value: string; hint?: string }) {
  return (
    <div className="bg-white border border-slate-100 rounded-xl p-3.5">
      <div className="flex items-center gap-1.5 text-xs text-slate-500">
        <Icon size={14} className="text-orange-500" /> {label}
      </div>
      <p className="text-lg font-bold text-slate-800 mt-1 truncate">{value}</p>
      {hint && <p className="text-[11px] text-slate-400 mt-0.5">{hint}</p>}
    </div>
  );
}

/** Single-series bars: revenue per day for the last 14 days. One hue, baseline-anchored, hover/focus for the exact figure. */
function RevenueBars({ trend }: { trend: BusinessOverview['trend'] }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...trend.map((d) => Number(d.revenue)));
  const W = 560;
  const H = 120;
  const slot = W / trend.length;
  const barW = Math.max(6, slot - 8);
  const dayLabel = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const shown = active != null ? trend[active] : null;
  const total = trend.reduce((s, d) => s + Number(d.revenue), 0);

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 mb-1 min-h-[20px]">
        <p className="text-xs text-slate-500">Gross fares per day, last 14 days</p>
        <p className="text-xs font-medium text-slate-700">
          {shown
            ? `${dayLabel(shown.day)} · ${formatMoney(Number(shown.revenue))} · ${shown.completed} ride${shown.completed === 1 ? '' : 's'}`
            : formatMoney(total)}
        </p>
      </div>
      <svg viewBox={`0 0 ${W} ${H + 18}`} className="w-full h-auto" role="img" aria-label={`Gross fares per day for the last 14 days, ${formatMoney(total)} in total`}>
        <line x1={0} x2={W} y1={H} y2={H} stroke="#cbd5e1" strokeWidth={1} />
        {trend.map((d, i) => {
          const h = Number(d.revenue) > 0 ? Math.max(3, (Number(d.revenue) / max) * (H - 8)) : 0;
          const x = i * slot + (slot - barW) / 2;
          return (
            <g key={d.day}>
              {h > 0 && (
                <path
                  d={`M${x},${H} V${H - h + 4} Q${x},${H - h} ${x + 4},${H - h} H${x + barW - 4} Q${x + barW},${H - h} ${x + barW},${H - h + 4} V${H} Z`}
                  fill="#ea580c"
                  opacity={active == null || active === i ? 1 : 0.45}
                />
              )}
              {/* full-height hit target, larger than the mark */}
              <rect
                x={i * slot}
                y={0}
                width={slot}
                height={H}
                fill="transparent"
                tabIndex={0}
                aria-label={`${dayLabel(d.day)}: ${formatMoney(Number(d.revenue))}, ${d.completed} rides`}
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                onClick={() => setActive(active === i ? null : i)}
              />
            </g>
          );
        })}
        <text x={0} y={H + 14} fontSize={11} fill="#64748b">{dayLabel(trend[0].day)}</text>
        <text x={W} y={H + 14} fontSize={11} fill="#64748b" textAnchor="end">{dayLabel(trend[trend.length - 1].day)}</text>
      </svg>
    </div>
  );
}

export default function BusinessOverviewTab({
  business,
  registration,
  state,
  onGo,
  onPickLogo,
}: {
  business: OverviewBusiness;
  registration: BusinessRegistration | undefined;
  state: AccessState;
  onGo: (tab: BusinessTab) => void;
  onPickLogo: () => void;
}) {
  const live = isLive(state);
  const isEscort = business.category_key === 'security_escort';
  const [overview, setOverview] = useState<BusinessOverview | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [loading, setLoading] = useState(live);
  const [pricingSet, setPricingSet] = useState(false);

  useEffect(() => {
    let off = false;
    supabase.rpc('mbg_get_business_pricing', { p_business_profile_id: business.id }).then(({ data }) => {
      if (off || !data) return;
      setPricingSet([data.base_fare, data.per_km_rate, data.min_fare, data.escort_flat_fee, data.escort_hourly_rate].some((v) => v != null));
    });
    return () => { off = true; };
  }, [business.id]);

  useEffect(() => {
    if (!live) { setLoading(false); return; }
    let off = false;
    setLoading(true);
    businessService.overview(business.id).then(({ data, error }) => {
      if (off) return;
      setOverview(data);
      setOverviewError(error);
      setLoading(false);
    });
    return () => { off = true; };
  }, [business.id, live]);

  const teamWord = isEscort ? 'escort' : 'driver';
  const gated = state !== 'unsupported'; // registration + approval steps only exist once the gate is installed
  const steps: { done: boolean; label: string; action?: { label: string; run: () => void } }[] = [
    { done: !!business.avatar_url, label: 'Add your logo', action: { label: 'Upload', run: onPickLogo } },
    { done: !!business.description?.trim() && !!business.home_city?.trim(), label: 'Describe your business and home city', action: { label: 'Edit profile', run: () => onGo('profile') } },
    ...(gated ? [
      { done: state !== 'incomplete', label: 'Submit your registration details', action: { label: 'Add details', run: () => onGo('profile') } },
      { done: state === 'approved', label: 'Get approved by the BodaGoEra team' },
    ] : []),
    { done: pricingSet, label: 'Set your pricing', action: { label: 'Set pricing', run: () => onGo('pricing') } },
    { done: (overview?.team_total ?? 0) > 0, label: `Add your first ${teamWord}`, action: live ? { label: `Add ${teamWord}`, run: () => onGo('roster') } : undefined },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const pct = Math.round((doneCount / steps.length) * 100);

  const completionRate =
    overview && overview.completed_30d + overview.cancelled_30d > 0
      ? Math.round((overview.completed_30d / (overview.completed_30d + overview.cancelled_30d)) * 100)
      : null;

  return (
    <div className="space-y-5">
      {pct < 100 && (
        <section className="bg-slate-50 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="font-semibold text-slate-800 text-sm">Get your business ready</h4>
            <span className="text-xs font-medium text-slate-500">{doneCount} of {steps.length}</span>
          </div>
          <div className="h-1.5 rounded-full bg-slate-200 mb-3" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-1.5 rounded-full bg-orange-500 transition-all" style={{ width: `${pct}%` }} />
          </div>
          <ul className="space-y-1.5">
            {steps.map((s) => (
              <li key={s.label} className="flex items-center gap-2 text-sm">
                {s.done ? <CheckCircle2 size={16} className="text-emerald-500 shrink-0" /> : <Circle size={16} className="text-slate-300 shrink-0" />}
                <span className={s.done ? 'text-slate-400 line-through' : 'text-slate-700'}>{s.label}</span>
                {!s.done && s.action && (
                  <button onClick={s.action.run} className="ml-auto text-xs font-semibold text-orange-600 hover:text-orange-700 shrink-0">
                    {s.action.label}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {!live ? (
        <p className="text-sm text-slate-400 text-center py-4">
          Your earnings, rides and team figures appear here once your business is approved.
        </p>
      ) : loading ? (
        <p className="text-sm text-slate-400 py-4">Loading figures…</p>
      ) : overviewError === 'not_installed' ? null : overviewError || !overview ? (
        <p className="text-sm text-red-600 py-2">Could not load figures: {overviewError}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            <Kpi icon={Wallet} label="Fares, 30 days" value={formatMoney(Number(overview.revenue_30d))} hint={`${formatMoney(Number(overview.revenue_all))} all time`} />
            <Kpi icon={Car} label="Completed, 30 days" value={String(overview.completed_30d)} hint={completionRate != null ? `${completionRate}% completion` : 'No finished jobs yet'} />
            <Kpi icon={Activity} label="Active right now" value={String(overview.active_now)} hint={`${overview.rides_30d} requested in 30 days`} />
            <Kpi icon={Users} label={isEscort ? 'Escorts online' : 'Drivers online'} value={`${overview.team_online} / ${overview.team_total}`} hint={`${overview.team_verified} verified by BodaGoEra`} />
            <Kpi icon={Star} label="Team rating" value={overview.avg_rating != null ? Number(overview.avg_rating).toFixed(1) : '—'} hint={overview.avg_rating != null ? 'Average across your team' : 'No ratings yet'} />
            <Kpi icon={TrendingUp} label="Cancelled, 30 days" value={String(overview.cancelled_30d)} />
          </div>

          <section className="bg-white border border-slate-100 rounded-xl p-4">
            <RevenueBars trend={overview.trend} />
          </section>

          {overview.top.length > 0 && (
            <section className="bg-white border border-slate-100 rounded-xl p-4">
              <h4 className="font-semibold text-slate-800 text-sm mb-2">Top {isEscort ? 'escorts' : 'drivers'}, last 30 days</h4>
              <ol className="space-y-1.5">
                {overview.top.map((t, i) => (
                  <li key={`${t.name}-${i}`} className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-slate-700 truncate">{i + 1}. {t.name}</span>
                    <span className="text-xs text-slate-500 shrink-0">{t.rides} job{t.rides === 1 ? '' : 's'} · {formatMoney(Number(t.revenue))}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </>
      )}
      {registration?.operating_hours && (
        <p className="text-xs text-slate-400">Listed hours: {registration.operating_hours}</p>
      )}
    </div>
  );
}
