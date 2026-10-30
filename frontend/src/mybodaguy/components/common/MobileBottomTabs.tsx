import type { ComponentType } from 'react';
import NavGlowDefs from './NavGlowDefs';
import './mobileBottomTabs.css';

export interface BottomTab<Id extends string = string> {
  id: Id;
  label: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  badge?: number;
}

const MAX_TABS = 5;

interface MobileBottomTabsProps<Id extends string> {
  tabs: BottomTab<Id>[];
  activeTab: string;
  onSelect: (id: Id) => void;
  /** Viewport width from which the bar is hidden — match where the page's own top tab strip appears. */
  hideFrom?: 'sm' | 'md';
  /** The page colour the fade blends into: 'classic' (the cream/navy dashboards) or 'slate' (light slate pages). */
  tone?: 'classic' | 'slate';
}

// Phone-only bottom tab bar: the vital destinations of a dashboard, in reach
// of the thumb. Deliberately capped at 5 — everything else stays in the
// header's Menu sheet.
//
// Bare icons, like TikTok's: nothing painted behind or around them. The current
// tab's icon is drawn in colours that travel along its own shape; the row is
// compact, sits on the bottom edge, and scrolls sideways if there are ever more
// tabs than fit (see mobileBottomTabs.css). Hidden from `sm` (or `md`) up, where
// each dashboard already has its full top tab strip.
//
// With no bar behind the icons, cards scrolling underneath would show through
// (labels sitting on top of card text). So the bar carries its own page-coloured
// fade (.mbg-nav-fade) -- every page that mounts it gets the same soft fade-out
// at the bottom edge, and it hides and themes together with the bar.
//
// Pages that render this need ~5rem of bottom padding so their last card isn't
// hidden under it (the dashboards already carry pb-28).
export default function MobileBottomTabs<Id extends string>({
  tabs,
  activeTab,
  onSelect,
  hideFrom = 'sm',
  tone = 'classic',
}: MobileBottomTabsProps<Id>) {
  const visible = tabs.slice(0, MAX_TABS);
  if (visible.length === 0) return null;

  return (
    <nav
      aria-label="Primary"
      className={`mbg-nav ${tone === 'slate' ? 'mbg-nav-slate' : ''} fixed inset-x-0 bottom-0 z-[60] mx-auto flex max-w-md ${hideFrom === 'md' ? 'md:hidden' : 'sm:hidden'}`}
    >
      <span aria-hidden="true" className="mbg-nav-fade" />
      <NavGlowDefs />
      {visible.map((tab) => {
        const active = activeTab === tab.id;
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onSelect(tab.id)}
            aria-current={active ? 'page' : undefined}
            className={`mbg-nav-tab ${active ? 'mbg-nav-tab-active' : ''} flex flex-col items-center justify-center gap-0.5 px-1 py-1 text-[9.5px] font-semibold whitespace-nowrap`}
          >
            <span className="relative flex">
              <Icon size={18} className="flex-shrink-0" />
              {!!tab.badge && tab.badge > 0 && (
                <span className="absolute -right-2.5 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold leading-none text-white">
                  {tab.badge > 99 ? '99+' : tab.badge}
                </span>
              )}
            </span>
            <span className="max-w-full truncate">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
