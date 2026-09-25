import { useEffect, useMemo, useState } from 'react';
import { Plane, Clock, Briefcase, Moon, Sparkles, Check, SlidersHorizontal, Tag, Timer, Undo2, ChevronDown } from 'lucide-react';
import type { FlightOffer } from '../services/journeyService';
import {
  CABIN_LABELS, DAY_PART_HOURS, DAY_PART_LABELS, DEFAULT_PREFS,
  applyPrefs, computeBadges, fareDisplay, formatDuration, formatIcan, groupByAirline, sortFlights, summarizeOffers,
  type Badge, type CabinClass, type DayPart, type FlightPrefs, type FlightSummary, type SortKey, type StopsPref,
} from '../services/flightOffers';

const PREFS_STORAGE_KEY = 'bodagoera.flightPrefs.v1';
const PAGE_SIZE = 8;

function loadPrefs(): FlightPrefs {
  try {
    const raw = window.localStorage.getItem(PREFS_STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    const p = JSON.parse(raw);
    return {
      sort: ['best', 'cheapest', 'fastest', 'earliest'].includes(p.sort) ? p.sort : DEFAULT_PREFS.sort,
      stops: ['any', 'direct', 'max1'].includes(p.stops) ? p.stops : DEFAULT_PREFS.stops,
      dayParts: Array.isArray(p.dayParts) ? p.dayParts.filter((d: string) => d in DAY_PART_LABELS) : [],
      checkedBagOnly: p.checkedBagOnly === true,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function savePrefs(prefs: FlightPrefs) {
  try {
    window.localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Storage can be blocked (private mode) — preferences just won't persist.
  }
}

const chipClass = (active: boolean) => `classic-chip ${active ? 'is-active' : ''}`;

const BADGE_STYLE: Record<Badge, { label: string; className: string; icon: typeof Tag }> = {
  best: { label: 'Best match', className: 'bg-emerald-100 text-emerald-700', icon: Sparkles },
  cheapest: { label: 'Cheapest', className: 'bg-sky-100 text-sky-700', icon: Tag },
  fastest: { label: 'Fastest', className: 'bg-violet-100 text-violet-700', icon: Timer },
};

// The cabin is part of the search itself (it changes what the airlines offer
// and what it costs), so it lives with the search form and re-runs the search.
export function CabinPicker({
  value, onChange, disabled,
}: { value: CabinClass; onChange: (cabin: CabinClass) => void; disabled?: boolean }) {
  return (
    <div>
      <span className="classic-label">Cabin</span>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Cabin class">
        {(Object.keys(CABIN_LABELS) as CabinClass[]).map((c) => (
          <button key={c} type="button" disabled={disabled} aria-pressed={value === c} onClick={() => onChange(c)} className={chipClass(value === c)}>
            {CABIN_LABELS[c]}
          </button>
        ))}
      </div>
    </div>
  );
}

// One-line fare: "43.92 ICAN (≈ KES 8,010.68)" — ICAN first, then the
// customer's own currency; the airline's own price only when there's no ICAN one.
function fareLine(f: Parameters<typeof fareDisplay>[0]) {
  const { primary, secondary } = fareDisplay(f);
  return secondary ? `${primary} (${secondary})` : primary;
}

function AirlineLogo({ url, name, size = 28 }: { url: string | null; name: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const box = { width: size, height: size };
  if (!url || failed) {
    return (
      <span style={box} className="flex shrink-0 items-center justify-center rounded-full bg-[#fbf3dc] text-[#a17c28] ring-1 ring-[#c4a052]/40">
        <Plane size={Math.round(size / 2)} />
      </span>
    );
  }
  return <img src={url} alt="" style={box} className="shrink-0 object-contain" onError={() => setFailed(true)} />;
}

function FlightCard({
  flight, badges, selected, onSelect,
}: { flight: FlightSummary; badges: Badge[]; selected: boolean; onSelect: () => void }) {
  const stopsLabel = flight.stops === 0 ? 'Direct' : `${flight.stops} stop${flight.stops > 1 ? 's' : ''}`;
  const hasNotes = badges.length > 0 || flight.earlyStart || flight.landsLate;
  const fare = fareDisplay(flight);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${flight.airline}, departs ${flight.departClock}, arrives ${flight.arriveClock}, ${stopsLabel}, ${fareLine(flight)}`}
      className={`classic-tile flex overflow-hidden ${selected ? 'is-active' : ''}`}
    >
      <div className="min-w-0 flex-1 p-3.5">
        <div className="flex items-center gap-2">
          <AirlineLogo url={flight.logoUrl} name={flight.airline} size={26} />
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold leading-tight text-slate-800">{flight.airline}</p>
            <p className="truncate text-[11px] leading-tight text-slate-500">
              {flight.flightNumbers.join(' · ')}{flight.operatedBy ? ` · operated by ${flight.operatedBy}` : ''}
            </p>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-1.5">
          <div className="text-left">
            <p className="font-classic-display text-[20px] font-semibold leading-none tabular-nums text-slate-800 min-[420px]:text-[22px]">{flight.departClock}</p>
            <p className="mt-1 text-[11px] font-semibold tracking-[0.14em] text-[#8a6a1f]">{flight.originIata}</p>
          </div>
          <div className="flex min-w-0 flex-1 flex-col items-center px-0.5">
            <span className="whitespace-nowrap text-[10.5px] leading-none text-slate-500">{formatDuration(flight.durationMin)}</span>
            <span className="my-1 flex w-full items-center gap-1 text-[#c4a052]">
              <span className="h-px flex-1 bg-[#c4a052]/50" />
              <Plane size={13} />
              <span className="h-px flex-1 bg-[#c4a052]/50" />
            </span>
            <span className={`truncate text-[10.5px] leading-none ${flight.stops === 0 ? 'font-semibold text-emerald-600' : 'text-slate-500'}`}>
              {stopsLabel}{flight.viaIatas.length > 0 ? ` · ${flight.viaIatas.join(', ')}` : ''}
            </span>
          </div>
          <div className="text-right">
            <p className="font-classic-display text-[20px] font-semibold leading-none tabular-nums text-slate-800 min-[420px]:text-[22px]">
              {flight.arriveClock}
              {flight.arriveDayOffset > 0 && <sup className="ml-0.5 font-sans text-[10px] font-bold text-red-500">+{flight.arriveDayOffset}</sup>}
            </p>
            <p className="mt-1 text-[11px] font-semibold tracking-[0.14em] text-[#8a6a1f]">{flight.destinationIata}</p>
          </div>
        </div>

        <p className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-slate-500">
          <span>{flight.departDayLabel}</span>
          {flight.cabin && <span>· {flight.cabin}</span>}
          {flight.checkedBags !== null && (
            <span className="inline-flex items-center gap-1">
              · <Briefcase size={11} /> {flight.checkedBags > 0 ? `${flight.checkedBags} checked bag${flight.checkedBags > 1 ? 's' : ''}` : 'Hand luggage only'}
            </span>
          )}
          {flight.refundable === true && <span className="font-medium text-emerald-600">· Refundable</span>}
          {flight.refundable === false && <span>· Non-refundable</span>}
        </p>

        {hasNotes && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {badges.map((b) => {
              const s = BADGE_STYLE[b];
              const Icon = s.icon;
              return (
                <span key={b} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${s.className}`}>
                  <Icon size={10} /> {s.label}
                </span>
              );
            })}
            {flight.earlyStart && (
              <span className="inline-flex items-center gap-1 text-[10.5px] text-amber-700"><Moon size={10} /> Very early start</span>
            )}
            {flight.landsLate && (
              <span className="inline-flex items-center gap-1 text-[10.5px] text-amber-700"><Moon size={10} /> Lands late at night</span>
            )}
          </div>
        )}

        <p className="mt-2 text-[11px] text-slate-500">
          Be at {flight.originIata || 'the airport'} by <span className="font-semibold text-slate-700">{flight.airportBy.clock}</span>
          {flight.airportBy.previousDay ? ' the night before' : ''}
        </p>
      </div>

      <div className="classic-perforation flex w-[6.25rem] shrink-0 flex-col items-center justify-center gap-1 px-1.5 py-3 text-center min-[420px]:w-28">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
          {flight.priceIcan !== null ? 'ICAN' : flight.currency}
        </p>
        <p className="font-classic-display text-[22px] font-bold leading-none tabular-nums text-slate-900">
          {flight.priceIcan !== null
            ? formatIcan(flight.priceIcan)
            : flight.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
        </p>
        {fare.secondary && <p className="text-[10.5px] leading-tight text-slate-500">{fare.secondary}</p>}
        <span
          className={`mt-1 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ${
            selected ? 'bg-gradient-to-r from-orange-500 to-amber-400 text-white' : 'bg-[#fbf3dc] text-[#7a5a12]'
          }`}
        >
          {selected ? <><Check size={11} strokeWidth={3} /> Selected</> : 'Select'}
        </span>
      </div>
    </button>
  );
}

/**
 * Which airlines fly this route on this date, and the customer's preferences
 * (stops, time of day, checked bag, sort order) for choosing between them.
 * Preferences are remembered between bookings; the chosen airline is not.
 */
export default function FlightResultsPicker({
  offers, selectedOffer, onSelect, travellers = 1,
}: {
  offers: FlightOffer[];
  selectedOffer: FlightOffer | null;
  onSelect: (offer: FlightOffer) => void;
  /** How many people the search was for — the airline's price covers all of them. */
  travellers?: number;
}) {
  const [prefs, setPrefsState] = useState<FlightPrefs>(loadPrefs);
  const [airlineKey, setAirlineKey] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(() => {
    const p = loadPrefs();
    return p.stops !== 'any' || p.dayParts.length > 0 || p.checkedBagOnly;
  });

  const setPrefs = (patch: Partial<FlightPrefs>) => {
    setPrefsState((prev) => {
      const next = { ...prev, ...patch };
      savePrefs(next);
      return next;
    });
  };

  // A fresh search is a fresh comparison — don't carry an airline filter over.
  useEffect(() => { setAirlineKey(null); }, [offers]);

  const all = useMemo(() => summarizeOffers(offers), [offers]);
  const matching = useMemo(() => applyPrefs(all, prefs), [all, prefs]);
  const airlines = useMemo(() => groupByAirline(matching), [matching]);
  const badges = useMemo(() => computeBadges(matching), [matching]);

  // If the chosen airline drops out (a preference now excludes all its
  // flights), fall back to showing everyone rather than an empty list.
  const activeAirline = airlineKey && airlines.some((a) => a.key === airlineKey) ? airlineKey : null;
  const visible = useMemo(
    () => sortFlights(activeAirline ? matching.filter((f) => f.airlineKey === activeAirline) : matching, prefs.sort),
    [matching, activeAirline, prefs.sort],
  );

  // Long result lists are shown a page at a time; a new search, airline or
  // preference starts back at the top of the list.
  const [limit, setLimit] = useState(PAGE_SIZE);
  useEffect(() => { setLimit(PAGE_SIZE); }, [offers, activeAirline, prefs]);
  const shown = visible.slice(0, limit);

  const hiddenByPrefs = all.length - matching.length;
  const activeFilterCount = (prefs.stops !== 'any' ? 1 : 0) + prefs.dayParts.length + (prefs.checkedBagOnly ? 1 : 0);
  const allAirlineCount = useMemo(() => new Set(all.map((f) => f.airlineKey)).size, [all]);
  const directExists = all.some((f) => f.stops === 0);
  const selectedSummary = useMemo(() => all.find((f) => f.offer.offerId === selectedOffer?.offerId) ?? null, [all, selectedOffer]);
  const selectedHidden = !!selectedSummary && !visible.some((f) => f.offer.offerId === selectedSummary.offer.offerId);

  if (all.length === 0) return null;

  return (
    <div className="animate-step-in space-y-3.5">
      <div>
        <div className="flex items-center gap-3">
          <h4 className="font-classic-display text-lg font-semibold text-slate-800">Choose your airline</h4>
          <div className="landing-classic-divider flex-1" />
        </div>
        <p className="mt-1 text-xs text-slate-500">
          {all.length} flight{all.length !== 1 ? 's' : ''} on {allAirlineCount} airline{allAirlineCount !== 1 ? 's' : ''} for your date
          {travellers > 1 && ` · prices are the total for all ${travellers} travellers`}
        </p>
      </div>

      <div className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1.5" role="group" aria-label="Airlines flying this route">
        <button
          type="button"
          aria-pressed={activeAirline === null}
          onClick={() => setAirlineKey(null)}
          className={`classic-tile shrink-0 snap-start !w-auto px-3.5 py-2.5 ${activeAirline === null ? 'is-active' : ''}`}
        >
          <span className="block text-[13px] font-semibold leading-tight text-slate-800">All airlines</span>
          <span className="block text-[11px] leading-tight text-slate-500">{matching.length} flight{matching.length !== 1 ? 's' : ''}</span>
        </button>
        {airlines.map((a) => (
          <button
            key={a.key}
            type="button"
            aria-pressed={activeAirline === a.key}
            onClick={() => setAirlineKey(activeAirline === a.key ? null : a.key)}
            className={`classic-tile flex shrink-0 snap-start !w-auto items-center gap-2.5 px-3 py-2.5 ${activeAirline === a.key ? 'is-active' : ''}`}
          >
            <AirlineLogo url={a.logoUrl} name={a.name} size={28} />
            <span className="text-left leading-tight">
              <span className="block max-w-[9.5rem] truncate text-[13px] font-semibold text-slate-800">{a.name}</span>
              <span className="block text-[11px] text-slate-500">
                from {fareDisplay({ price: a.cheapest, currency: a.currency, priceIcan: a.cheapestIcan, priceLocal: a.cheapestLocal, localCurrency: a.localCurrency }).primary}
              </span>
              <span className="block text-[10.5px] text-slate-400">
                {a.hasDirect ? 'Direct' : 'With stops'}{a.count > 1 ? ` · ${a.count} flights` : ''}
              </span>
            </span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          aria-expanded={showFilters}
          onClick={() => setShowFilters((v) => !v)}
          className="classic-chip"
        >
          <SlidersHorizontal size={13} />
          Preferences{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
          <ChevronDown size={13} className={`transition-transform ${showFilters ? 'rotate-180' : ''}`} />
        </button>
        <label className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#8a6a1f]">
          Sort
          <select
            className="classic-input !min-h-0 !w-auto min-w-0 max-w-[10rem] !rounded-full !px-3 !py-1.5 !text-xs !font-semibold normal-case tracking-normal"
            value={prefs.sort}
            onChange={(e) => setPrefs({ sort: e.target.value as SortKey })}
          >
            <option value="best">Best match</option>
            <option value="cheapest">Cheapest first</option>
            <option value="fastest">Fastest first</option>
            <option value="earliest">Earliest departure</option>
          </select>
        </label>
      </div>

      {showFilters && (
        <div className="animate-step-in space-y-3.5 rounded-2xl border border-[#c4a052]/30 bg-[#fdfaf1] p-3.5 dark:bg-slate-800/60">
          <div>
            <span className="classic-label">Stops</span>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Number of stops">
              {([['any', 'Any'], ['direct', 'Direct only'], ['max1', 'Up to 1 stop']] as Array<[StopsPref, string]>).map(([value, label]) => (
                <button key={value} type="button" aria-pressed={prefs.stops === value} onClick={() => setPrefs({ stops: value })} className={chipClass(prefs.stops === value)}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="classic-label">Departure time</span>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Departure time of day">
              {(Object.keys(DAY_PART_LABELS) as DayPart[]).map((d) => {
                const on = prefs.dayParts.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setPrefs({ dayParts: on ? prefs.dayParts.filter((x) => x !== d) : [...prefs.dayParts, d] })}
                    className={chipClass(on)}
                  >
                    {DAY_PART_LABELS[d]} <span className="font-normal opacity-70">{DAY_PART_HOURS[d]}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <span className="classic-label">Baggage</span>
            <button type="button" aria-pressed={prefs.checkedBagOnly} onClick={() => setPrefs({ checkedBagOnly: !prefs.checkedBagOnly })} className={chipClass(prefs.checkedBagOnly)}>
              <Briefcase size={12} /> Checked bag included
            </button>
          </div>

          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={() => setPrefs({ stops: 'any', dayParts: [], checkedBagOnly: false })}
              className="classic-btn classic-btn-ghost !text-[#a17c28]"
            >
              <Undo2 size={13} /> Clear preferences{hiddenByPrefs > 0 ? ` · ${hiddenByPrefs} hidden` : ''}
            </button>
          )}
        </div>
      )}

      {visible.length === 0 ? (
        <div className="space-y-1 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <p className="font-semibold">No flights match your preferences.</p>
          {prefs.stops === 'direct' && !directExists && (
            <p className="text-xs">There are no direct flights on this date — try “Up to 1 stop”.</p>
          )}
          <p className="text-xs">{hiddenByPrefs} flight{hiddenByPrefs !== 1 ? 's are' : ' is'} hidden by your preferences.</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {shown.map((f) => (
            <FlightCard
              key={f.offer.offerId}
              flight={f}
              badges={badges.get(f.offer.offerId) ?? []}
              selected={selectedOffer?.offerId === f.offer.offerId}
              onSelect={() => onSelect(f.offer)}
            />
          ))}
          {visible.length > shown.length && (
            <button type="button" onClick={() => setLimit((n) => n + PAGE_SIZE)} className="classic-btn classic-btn-outline !min-h-[44px] !text-sm">
              Show {Math.min(PAGE_SIZE, visible.length - shown.length)} more flight{visible.length - shown.length !== 1 ? 's' : ''}
              <span className="font-normal opacity-70">({visible.length - shown.length} left)</span>
            </button>
          )}
        </div>
      )}

      {selectedSummary && (
        <div className="flex items-start gap-2.5 rounded-2xl border border-[#c4a052]/50 bg-[#fbf3dc] p-3 text-[#5c4410] dark:bg-[#c4a052]/15 dark:text-[#f0d68f]">
          <Check size={16} className="mt-0.5 shrink-0" />
          <div className="min-w-0 text-xs leading-relaxed">
            <p className="font-classic-display text-sm font-semibold">{selectedSummary.airline} · {selectedSummary.departDayLabel}</p>
            <p>
              {selectedSummary.departClock} {selectedSummary.originIata} → {selectedSummary.arriveClock}{selectedSummary.arriveDayOffset > 0 ? ` (+${selectedSummary.arriveDayOffset})` : ''} {selectedSummary.destinationIata}
              {' · '}{selectedSummary.stops === 0 ? 'Direct' : `${selectedSummary.stops} stop${selectedSummary.stops > 1 ? 's' : ''}`}
              {' · '}{fareLine(selectedSummary)}
            </p>
            {selectedHidden && <p className="mt-0.5 font-medium text-amber-700">Hidden by your current preferences.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
