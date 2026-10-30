/**
 * DeliveryWindowPicker — the "Deliver within" choice of a store delivery: a short list of
 * windows, each with the real clock time the rider must deliver by, plus "your own" hours.
 * A plain classic list (no card), shown on the Time step of the delivery flow.
 */
import { clampHours, deadlineLabel, formatWindow, isTightWindow, presetsWithin, DEFAULT_WINDOW_HOURS, type WindowBounds } from '../utils/deliveryWindow';

interface Props {
  hours: number;
  onChange: (hours: number) => void;
  bounds: WindowBounds;
  /** Ride time of the route, when known: windows the trip would nearly use up are flagged. */
  routeMinutes?: number | null;
  /** Epoch ms; the parent keeps it ticking so the clock times stay current. */
  now: number;
}

const Radio = ({ on }: { on: boolean }) => (
  <span className={`grid h-5 w-5 flex-shrink-0 place-items-center rounded-full border-2 ${on ? 'border-orange-500' : 'border-slate-300'}`} aria-hidden>
    {on && <span className="h-2.5 w-2.5 rounded-full bg-orange-500" />}
  </span>
);

// An inset shadow, not a border, so the selected row doesn't shift its content sideways.
const selectedBar = 'shadow-[inset_2px_0_0_#fb923c]';

export default function DeliveryWindowPicker({ hours, onChange, bounds, routeMinutes, now }: Props) {
  const presets = presetsWithin(bounds);
  const isPreset = presets.some(p => p.hours === hours);
  const date = new Date(now);

  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="Deliver within">
        {presets.map(p => {
          const on = hours === p.hours;
          const tight = isTightWindow(routeMinutes, p.hours);
          return (
            <button
              key={p.hours}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(p.hours)}
              className={`flex w-full items-center gap-3 border-b border-[#c4a052]/20 py-3.5 pl-1 text-left transition-colors ${on ? selectedBar : 'hover:bg-orange-50/40'}`}
            >
              <Radio on={on} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="font-classic-display text-[15px] font-semibold text-slate-800">{p.label}</span>
                  {p.hours === DEFAULT_WINDOW_HOURS && <span className="text-[10px] font-bold uppercase tracking-wider text-orange-600">Usual</span>}
                </span>
                <span className={`block text-xs ${tight ? 'text-amber-700' : 'text-slate-500'}`}>{tight ? 'Tight for this trip' : p.hint}</span>
              </span>
              <span className="flex-shrink-0 text-right">
                <span className={`block text-sm font-semibold ${on ? 'text-orange-600' : 'text-slate-700'}`}>{formatWindow(p.hours)}</span>
                <span className="block text-[11px] text-slate-400">by {deadlineLabel(date, p.hours)}</span>
              </span>
            </button>
          );
        })}

        <div className={`flex items-center gap-3 border-b border-[#c4a052]/20 py-3.5 pl-1 ${!isPreset ? selectedBar : ''}`}>
          <Radio on={!isPreset} />
          <span className="min-w-0 flex-1">
            <span className="block font-classic-display text-[15px] font-semibold text-slate-800">Your own</span>
            <span className="block text-xs text-slate-500">by {deadlineLabel(date, hours)}</span>
          </span>
          <span className="flex flex-shrink-0 items-center gap-1 text-sm font-semibold text-slate-700">
            <button
              type="button"
              onClick={() => onChange(clampHours(hours - 1, bounds))}
              disabled={hours <= bounds.min}
              aria-label="One hour less"
              className="grid h-8 w-8 place-items-center rounded-full border border-slate-300 text-slate-600 disabled:opacity-30"
            >−</button>
            <input
              type="number"
              inputMode="numeric"
              min={bounds.min}
              max={bounds.max}
              value={hours}
              onChange={e => onChange(clampHours(Number(e.target.value), bounds))}
              aria-label="Hours"
              className="input-bare w-10 text-center outline-none"
            />
            <span className="text-xs font-normal text-slate-500">hrs</span>
            <button
              type="button"
              onClick={() => onChange(clampHours(hours + 1, bounds))}
              disabled={hours >= bounds.max}
              aria-label="One hour more"
              className="grid h-8 w-8 place-items-center rounded-full border border-slate-300 text-slate-600 disabled:opacity-30"
            >+</button>
          </span>
        </div>
      </div>
      <p className="text-xs text-slate-500">Miss it and you can claim a refund from your order receipt.</p>
    </div>
  );
}
