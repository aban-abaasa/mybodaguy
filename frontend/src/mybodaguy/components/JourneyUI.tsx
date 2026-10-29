import type { ComponentType, ReactNode } from 'react';
import { AlertCircle, ArrowLeft, Check, X } from 'lucide-react';

// Presentational pieces for the "Book a journey" full page, in the same
// ivory / ink / gold language as the customer dashboard (index.css:
// .journey-*, .classic-eyebrow, .font-classic-display). The page itself is
// flat: no cards around steps, only the choices inside them are tiles.

export interface StepperStep {
  id: string;
  label: string;
}

/** The page's top bar: a back arrow, what this page is, and how far along. */
export function JourneyTopBar({
  title, backLabel, onBack, backDisabled, progress,
}: {
  title: string;
  backLabel: string;
  onBack: () => void;
  backDisabled?: boolean;
  progress?: { steps: StepperStep[]; currentIndex: number; onGoTo: (id: string) => void };
}) {
  const current = progress ? progress.steps[progress.currentIndex] : undefined;
  return (
    <header className="journey-bar">
      <div className="journey-bar-inner">
        <div className="-mx-2 flex items-center gap-1 pr-2">
          <button
            type="button"
            onClick={onBack}
            disabled={backDisabled}
            aria-label={backLabel}
            className="journey-icon-btn disabled:opacity-40"
          >
            <ArrowLeft size={22} />
          </button>
          <h2 className="min-w-0 flex-1 truncate font-classic-display text-[18px] font-bold leading-tight text-slate-800">{title}</h2>
          {progress && current && (
            <span className="shrink-0 text-[11px] font-semibold tabular-nums text-[#8a6a1f]">
              {progress.currentIndex + 1}<span className="text-slate-400"> / {progress.steps.length}</span>
            </span>
          )}
        </div>
        {progress && <JourneyProgress {...progress} />}
      </div>
    </header>
  );
}

/**
 * Where the customer is in the booking, as a row of segments. Only steps
 * already passed are tappable — jumping ahead would skip validation the next
 * step depends on.
 */
export function JourneyProgress({
  steps, currentIndex, onGoTo,
}: { steps: StepperStep[]; currentIndex: number; onGoTo: (id: string) => void }) {
  return (
    <nav aria-label="Booking progress" className="pb-2.5 pt-0.5">
      <ol className="flex gap-1.5">
        {steps.map((s, i) => {
          const done = i < currentIndex;
          const current = i === currentIndex;
          const bar = (
            <span className={`block h-1 rounded-full transition-colors ${done || current ? 'bg-[#c4a052]' : 'bg-slate-200 dark:bg-slate-700'}`} />
          );
          return (
            <li key={s.id} className="min-w-0 flex-1" aria-current={current ? 'step' : undefined}>
              {done ? (
                <button
                  type="button"
                  onClick={() => onGoTo(s.id)}
                  aria-label={`Go back to ${s.label}`}
                  className="block w-full rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c4a052]"
                >
                  {bar}
                </button>
              ) : bar}
              <span className={`mt-1 block truncate text-center text-[10.5px] leading-none ${current ? 'font-bold text-slate-800' : `max-[399px]:invisible ${done ? 'font-semibold text-[#8a6a1f]' : 'text-slate-400'}`}`}>
                {s.label}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** What are you booking? Each tab is its own page, not a toggle inside one. */
export function JourneyKindTabs<K extends string>({
  tabs, value, onChange,
}: {
  tabs: ReadonlyArray<{ id: K; label: string; Icon: ComponentType<{ size?: number; className?: string }> }>;
  value: K;
  onChange: (id: K) => void;
}) {
  return (
    <div className="border-b border-[#c4a052]/30">
      <div role="tablist" aria-label="What are you booking?" className="flex">
        {tabs.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={value === id}
            onClick={() => onChange(id)}
            className="journey-tab"
          >
            <Icon size={18} className="shrink-0" />
            <span className="max-w-full truncate">{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** A step's main action, pinned to the bottom of the screen. */
export function StepFooter({ children }: { children: ReactNode }) {
  return <div className="journey-footer space-y-2">{children}</div>;
}

/** One step of the flow: a page, not a card. Serif title under a gold hairline. */
export function StepCard({
  eyebrow, title, description, children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="animate-step-in space-y-5">
      <header className="space-y-2">
        <div>
          {eyebrow && <p className="classic-eyebrow">{eyebrow}</p>}
          <h3 className="mt-0.5 font-classic-display text-[22px] font-semibold leading-tight text-slate-800 min-[400px]:text-[24px]">{title}</h3>
        </div>
        <div className="landing-classic-divider" />
        {description && <p className="text-[13px] leading-relaxed text-slate-500">{description}</p>}
      </header>
      {children}
    </section>
  );
}

/**
 * One option in a 2-up choice grid. On phones (below `sm`) it stays
 * compact: a small icon inline with the title and the description on its own
 * line underneath at the tile's full width. Tablets and up put a larger
 * icon beside both lines. Keyed to `sm`, not a phone width, because the tile
 * sits inside several padded containers and is far narrower than the screen.
 */
export function ChoiceTile({
  label, desc, Icon, active, disabled, onClick,
}: {
  label: string;
  desc?: string;
  Icon?: ComponentType<{ size?: number; className?: string }>;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`classic-tile relative grid grid-cols-[auto_1fr] content-center items-center gap-x-2 gap-y-1 px-2.5 py-2.5 text-left disabled:cursor-not-allowed disabled:opacity-50 sm:gap-x-3 sm:p-3 ${active ? 'is-active' : ''}`}
    >
      {active && (
        <span aria-hidden className="absolute right-1.5 top-1.5 grid h-4 w-4 place-items-center rounded-full bg-[#c4a052] text-white">
          <Check size={10} strokeWidth={3} />
        </span>
      )}
      {Icon && (
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#fbf3dc] text-[#a17c28] ring-1 ring-[#c4a052]/40 sm:row-span-2 sm:h-10 sm:w-10">
          <Icon size={15} className="sm:h-5 sm:w-5" />
        </span>
      )}
      <span className={`min-w-0 pr-4 font-classic-display text-[14px] font-semibold leading-tight text-slate-800 sm:self-end sm:text-[15px] ${Icon ? '' : 'col-span-2'}`}>
        {label}
      </span>
      {desc && (
        <span className={`col-span-2 block text-[11px] leading-snug text-slate-500 sm:self-start ${Icon ? 'sm:col-span-1 sm:col-start-2' : ''}`}>
          {desc}
        </span>
      )}
    </button>
  );
}

/** A labelled form field — every input gets a real, visible label. */
export function Field({
  label, htmlFor, hint, children,
}: { label: string; htmlFor?: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="classic-label">{label}</label>
      {children}
      {hint && <p className="mt-1.5 text-xs leading-relaxed text-slate-500">{hint}</p>}
    </div>
  );
}

/** The choices made so far, kept in view while the customer works on the next step. */
export function TripSummary({ items }: { items: Array<{ icon: ReactNode; label: string; value: string }> }) {
  if (items.length === 0) return null;
  return (
    <div className="animate-step-in divide-y divide-[#c4a052]/20 border-y border-[#c4a052]/25">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-3 py-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#fbf3dc] text-[#a17c28] ring-1 ring-[#c4a052]/40">
            {item.icon}
          </span>
          <div className="min-w-0">
            <p className="classic-eyebrow !text-[9px]">{item.label}</p>
            <p className="truncate text-[13px] font-medium text-slate-800">{item.value}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div role="alert" className="animate-step-in flex items-start gap-2.5 rounded-2xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-700">
      <AlertCircle size={18} className="mt-0.5 shrink-0" />
      <p className="flex-1 leading-snug">{message}</p>
      <button type="button" onClick={onDismiss} aria-label="Dismiss message" className="-m-1 rounded-full p-1 hover:bg-red-100">
        <X size={16} />
      </button>
    </div>
  );
}

/** Placeholder cards while airlines are being searched. */
export function FlightSkeleton() {
  return (
    <div className="space-y-3" role="status" aria-live="polite" aria-label="Finding airlines">
      {[0, 1, 2].map((i) => (
        <div key={i} className="classic-tile flex animate-pulse overflow-hidden">
          <div className="flex-1 space-y-3 p-4">
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-full bg-slate-200" />
              <div className="h-3.5 w-32 rounded bg-slate-200" />
            </div>
            <div className="h-6 w-full rounded bg-slate-100" />
            <div className="h-3 w-2/3 rounded bg-slate-100" />
          </div>
          <div className="classic-perforation flex w-28 items-center justify-center p-4">
            <div className="h-6 w-16 rounded bg-slate-200" />
          </div>
        </div>
      ))}
      <p className="text-center text-xs text-slate-500">Asking the airlines for today's fares…</p>
    </div>
  );
}
