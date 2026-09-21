import { useState } from 'react';
import { TrendingDown, TrendingUp } from 'lucide-react';

export interface DayEarning {
  date: Date;
  amount: number;
  rides: number;
}

interface CompletedRideRow {
  completed_at: string | null;
  fare: number | null;
  rider_earning: number | null;
}

// Buckets completed rides into the last 7 local calendar days, oldest first —
// index 6 is today. rider_earning (net, after chairperson commission cuts) is
// what the rider actually keeps; the gross fare is only the fallback for old
// rows completed before that column existed.
export function buildWeekEarnings(rows: CompletedRideRow[], now: Date = new Date()): DayEarning[] {
  const key = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const days: DayEarning[] = [];
  for (let i = 6; i >= 0; i--) {
    days.push({ date: new Date(now.getFullYear(), now.getMonth(), now.getDate() - i), amount: 0, rides: 0 });
  }
  const byKey = new Map(days.map(d => [key(d.date), d]));
  rows.forEach(r => {
    if (!r.completed_at) return;
    const day = byKey.get(key(new Date(r.completed_at)));
    if (!day) return;
    day.amount += Number(r.rider_earning ?? r.fare) || 0;
    day.rides += 1;
  });
  return days;
}

const ugx = (n: number) => `UGX ${Math.round(n).toLocaleString()}`;
const weekday = (d: Date) => d.toLocaleDateString(undefined, { weekday: 'short' });
const fullDay = (d: Date) => d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

interface Props {
  week: DayEarning[] | null;
  loading: boolean;
}

// Today's earnings as the headline, the last 7 days as a quiet column chart
// beneath it. One series, so it uses emphasis rather than categorical color:
// today in the accent, earlier days in muted gold. Hover/focus/tap a column to
// read that day in the caption line below; the same numbers are in a
// screen-reader table.
export default function RiderEarningsCard({ week, loading }: Props) {
  const [picked, setPicked] = useState<number | null>(null);

  const days = week ?? [];
  const today = days[6];
  const yesterday = days[5];
  const max = Math.max(1, ...days.map(d => d.amount));
  const weekTotal = days.reduce((s, d) => s + d.amount, 0);
  const best = days.reduce<DayEarning | null>((b, d) => (d.amount > 0 && (!b || d.amount > b.amount) ? d : b), null);

  const deltaPct = today && yesterday && yesterday.amount > 0
    ? Math.round(((today.amount - yesterday.amount) / yesterday.amount) * 100)
    : null;

  const shown = picked !== null ? days[picked] : null;

  return (
    <div className="classic-card p-4 min-[360px]:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="classic-eyebrow">Today's earnings</p>
          <p className="mt-1.5 font-classic-display text-[34px] font-bold leading-none tabular-nums text-slate-900 min-[360px]:text-[38px]">
            {loading || !today ? '…' : ugx(today.amount)}
          </p>
          <p className="mt-1.5 text-xs text-slate-500">
            {loading || !today
              ? 'Loading…'
              : today.rides === 0
                ? 'No completed rides yet today'
                : `${today.rides} ride${today.rides === 1 ? '' : 's'} completed today`}
          </p>
        </div>
        {deltaPct !== null && (
          <span className={`mt-1 inline-flex flex-shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${
            deltaPct >= 0
              ? 'bg-emerald-50 text-emerald-700 ring-emerald-100'
              : 'bg-amber-50 text-amber-700 ring-amber-100'
          }`}>
            {deltaPct >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {deltaPct >= 0 ? '+' : ''}{deltaPct}% vs yesterday
          </span>
        )}
      </div>

      <div className="landing-classic-divider my-4" />

      {/* Columns: ≤24px wide, 4px rounded tops, square at the baseline */}
      <div className="flex h-[88px] items-end gap-1.5" role="group" aria-label="Earnings, last 7 days">
        {days.map((d, i) => {
          const isToday = i === 6;
          const isPicked = picked === i;
          const pct = d.amount > 0 ? Math.max(8, (d.amount / max) * 100) : 0;
          return (
            <button
              key={i}
              type="button"
              onMouseEnter={() => setPicked(i)}
              onMouseLeave={() => setPicked(null)}
              onFocus={() => setPicked(i)}
              onBlur={() => setPicked(null)}
              onClick={() => setPicked(p => (p === i ? null : i))}
              aria-label={`${fullDay(d.date)}: ${ugx(d.amount)}, ${d.rides} ride${d.rides === 1 ? '' : 's'}`}
              className="flex h-full flex-1 flex-col items-center justify-end outline-none"
            >
              {d.amount > 0 ? (
                <span
                  style={{ height: `${pct}%` }}
                  className={`w-full max-w-[24px] rounded-t-[4px] transition-all duration-300 ${
                    isToday
                      ? 'bg-gradient-to-t from-orange-600 to-amber-400'
                      : isPicked ? 'bg-[#c4a052]' : 'bg-[#e3cf9c] dark:bg-slate-600'
                  } ${isPicked ? 'brightness-105' : ''}`}
                />
              ) : (
                <span className={`h-[2px] w-full max-w-[24px] rounded-full ${isPicked ? 'bg-[#c4a052]' : 'bg-[#e9dfc4] dark:bg-slate-700'}`} />
              )}
            </button>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-1.5" aria-hidden>
        {days.map((d, i) => (
          <span
            key={i}
            className={`flex-1 truncate text-center text-[10px] ${
              i === 6 ? 'font-bold text-slate-800' : picked === i ? 'font-semibold text-slate-700' : 'text-slate-400'
            }`}
          >
            {i === 6 ? 'Today' : weekday(d.date)}
          </span>
        ))}
      </div>

      {/* Caption: the picked day, else the week in one line */}
      <p className="mt-3 min-h-[2.25rem] text-xs leading-snug text-slate-500" aria-live="polite">
        {shown ? (
          <>
            <span className="font-semibold text-slate-800">{fullDay(shown.date)}</span>
            {' · '}{ugx(shown.amount)}{' · '}{shown.rides} ride{shown.rides === 1 ? '' : 's'}
          </>
        ) : weekTotal > 0 && best ? (
          <>
            <span className="font-semibold text-slate-800">{ugx(weekTotal)}</span> in the last 7 days · best day{' '}
            <span className="font-semibold text-slate-800">{weekday(best.date)}</span> ({ugx(best.amount)})
          </>
        ) : (
          'Complete a ride and your week starts to take shape here.'
        )}
      </p>

      <table className="sr-only">
        <caption>Earnings, last 7 days</caption>
        <thead><tr><th>Day</th><th>Earnings</th><th>Rides</th></tr></thead>
        <tbody>
          {days.map((d, i) => (
            <tr key={i}><td>{fullDay(d.date)}</td><td>{ugx(d.amount)}</td><td>{d.rides}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
