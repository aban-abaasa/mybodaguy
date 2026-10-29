import { useEffect, useState } from 'react';
import { CheckCircle2, Circle, Star, TrendingUp, Car, Users, Activity, Wallet } from 'lucide-react';
import { supabase } from '../../services/supabaseClient';
import ClassicSection from './common/ClassicSection';
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
    <div className="classic-card !rounded-2xl p-3.5">
      <div className="flex items-center gap-1.5">
        <Icon size={13} className="text-[#a17c28]" />
        <span className="classic-eyebrow !tracking-[0.14em] truncate">{label}</span>
      </div>
      <p className="mt-1.5 truncate font-classic-display text-xl font-bold leading-none tabular-nums text-slate-900">{value}</p>
      {hint && <p className="mt-1 truncate text-[11px] text-slate-400">{hint}</p>}
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
        <p className="text-xs text-slate-500">Fares per day</p>
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
                  fill="#a17c28"
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
  state,
  onGo,
  onPickLogo,
}: {
  business: OverviewBusiness;
  registration?: BusinessRegistration | undefined;
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
    { done: !!business.avatar_url, label: 'Logo', action: { label: 'Upload', run: onPickLogo } },
    { done: !!business.description?.trim() && !!business.home_city?.trim(), label: 'Describe your business', action: { label: 'Edit profile', run: () => onGo('profile') } },
    ...(gated ? [
      { done: state !== 'incomplete', label: 'Registration details', action: { label: 'Add details', run: () => onGo('profile') } },
      { done: state === 'approved', label: 'Approval' },
    ] : []),
    { done: pricingSet, label: 'Pricing', action: { label: 'Set pricing', run: () => onGo('pricing') } },
    { done: (overview?.team_total ?? 0) > 0, label: `First ${teamWord}`, action: live ? { label: `Add ${teamWord}`, run: () => onGo('roster') } : undefined },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const pct = Math.round((doneCount / steps.length) * 100);

  const completionRate =
    overview && overview.completed_30d + overview.cancelled_30d > 0
      ? Math.round((overview.completed_30d / (overview.completed_30d + overview.cancelled_30d)) * 100)
      : null;

  return (
    <div className="space-y-4">
      {pct < 100 && (
        <ClassicSection
          title="Get ready"
          summary={`${doneCount} of ${steps.length} done`}
          defaultOpen
          right={<span className="text-xs font-semibold text-[#8a6a1f]">{pct}%</span>}
        >
          <div className="mb-3 h-1.5 rounded-full bg-[#f1e7cc]" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-1.5 rounded-full bg-[#c4a052] transition-all" style={{ width: `${pct}%` }} />
          </div>
          <ul className="space-y-2">
            {steps.map((st) => (
              <li key={st.label} className="flex items-center gap-2.5 text-sm">
                {st.done ? <CheckCircle2 size={17} className="shrink-0 text-emerald-500" /> : <Circle size={17} className="shrink-0 text-slate-300" />}
                <span className={st.done ? 'text-slate-400' : 'text-slate-700'}>{st.label}</span>
                {!st.done && st.action && (
                  <button onClick={st.action.run} className="ml-auto shrink-0 text-xs font-semibold text-[#8a6a1f] hover:text-[#6b4f12]">
                    {st.action.label}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </ClassicSection>
      )}

      {!live ? (
        <p className="py-4 text-center text-sm text-slate-400">Figures appear once you are approved.</p>
      ) : loading ? (
        <p className="py-4 text-sm text-slate-400">Loading…</p>
      ) : overviewError === 'not_installed' ? null : overviewError || !overview ? (
        <p className="py-2 text-sm text-red-600">Could not load figures: {overviewError}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <Kpi icon={Wallet} label="Fares · 30 days" value={formatMoney(Number(overview.revenue_30d))} hint={`${formatMoney(Number(overview.revenue_all))} total`} />
            <Kpi icon={Car} label="Completed" value={String(overview.completed_30d)} hint={completionRate != null ? `${completionRate}% completion` : '30 days'} />
            <Kpi icon={Activity} label="Active now" value={String(overview.active_now)} hint={`${overview.rides_30d} requested`} />
            <Kpi icon={Users} label={isEscort ? 'Escorts online' : 'Drivers online'} value={`${overview.team_online} / ${overview.team_total}`} hint={overview.team_verified ? `${overview.team_verified} verified` : undefined} />
            <Kpi icon={Star} label="Rating" value={overview.avg_rating != null ? Number(overview.avg_rating).toFixed(1) : '—'} />
            <Kpi icon={TrendingUp} label="Cancelled" value={String(overview.cancelled_30d)} hint="30 days" />
          </div>

          <ClassicSection title="Last 14 days" summary={formatMoney(overview.trend.reduce((sum, d) => sum + Number(d.revenue), 0))}>
            <RevenueBars trend={overview.trend} />
          </ClassicSection>

          {overview.top.length > 0 && (
            <ClassicSection title={`Top ${isEscort ? 'escorts' : 'drivers'}`} summary={overview.top[0].name}>
              <ol className="space-y-2">
                {overview.top.map((t, i) => (
                  <li key={`${t.name}-${i}`} className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate text-slate-700">{i + 1}. {t.name}</span>
                    <span className="shrink-0 text-xs text-slate-500">{t.rides} · {formatMoney(Number(t.revenue))}</span>
                  </li>
                ))}
              </ol>
            </ClassicSection>
          )}
        </>
      )}
    </div>
  );
}
