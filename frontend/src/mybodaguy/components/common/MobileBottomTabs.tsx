import type { ComponentType } from 'react';

export interface BottomTab<Id extends string = string> {
  id: Id;
  label: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  badge?: number;
}

interface MobileBottomTabsProps<Id extends string> {
  tabs: BottomTab<Id>[];
  activeTab: string;
  onSelect: (id: Id) => void;
  /** Accent for the active tab — Tailwind classes, defaults to the app's orange. */
  activeClassName?: string;
  /** Viewport width from which the bar is hidden — match where the page's own top tab strip appears. */
  hideFrom?: 'sm' | 'md';
}

// Phone-only bottom tab bar: the four vital destinations of a dashboard, in
// reach of the thumb. Deliberately capped at 4 — everything else stays in the
// header's Menu sheet. The bar itself is see-through (a faint frosted blur, no
// solid fill) so page content shows through beneath it; the active tab gets a
// solid pill so it still reads clearly over any content. Hidden from `sm` (or `md`)
// up, where each dashboard already has its full top tab strip.
//
// Pages that render this need ~5rem of bottom padding so their last card isn't
// hidden under it (the dashboards already carry pb-28).
export default function MobileBottomTabs<Id extends string>({
  tabs,
  activeTab,
  onSelect,
  activeClassName = 'bg-orange-500 text-white shadow-md shadow-orange-500/30',
  hideFrom = 'sm',
}: MobileBottomTabsProps<Id>) {
  const visible = tabs.slice(0, 4);
  if (visible.length === 0) return null;

  return (
    <nav
      aria-label="Primary"
      className={`pointer-events-none fixed inset-x-0 bottom-0 z-[60] px-3 ${hideFrom === 'md' ? 'md:hidden' : 'sm:hidden'}`}
      style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom, 0px))' }}
    >
      <div className="pointer-events-auto mx-auto flex max-w-md items-center justify-around gap-1 rounded-[26px] border border-white/40 bg-white/10 p-1.5 shadow-[0_8px_30px_rgba(0,0,0,0.12)] backdrop-blur-md backdrop-saturate-150 dark:border-white/15 dark:bg-slate-900/10">
        {visible.map((tab) => {
          const active = activeTab === tab.id;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onSelect(tab.id)}
              aria-current={active ? 'page' : undefined}
              className={`relative flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-[20px] px-1 py-2 transition-all active:scale-95 ${
                active
                  ? activeClassName
                  : 'text-slate-800 [text-shadow:0_1px_2px_rgba(255,255,255,0.7)] dark:text-white dark:[text-shadow:0_1px_2px_rgba(0,0,0,0.6)]'
              }`}
            >
              <Icon size={20} className="flex-shrink-0" />
              <span className="max-w-full truncate text-[10.5px] font-semibold leading-none">{tab.label}</span>
              {!!tab.badge && tab.badge > 0 && (
                <span className="absolute right-3 top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
                  {tab.badge > 99 ? '99+' : tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
