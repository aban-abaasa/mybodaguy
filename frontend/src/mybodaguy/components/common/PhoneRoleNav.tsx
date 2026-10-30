import { ArrowLeft, LogOut } from 'lucide-react';

// Phone-only navigation handed down by UnifiedDashboard when it gives a role's
// dashboard the whole screen (no shared brand header / role-tab strip above it).
// Customer, Rider and Chairperson all take it, so they behave the same way.
export interface PhoneNav {
  // The account's other roles, offered as "Switch role" in the Menu.
  roles: { id: string; label: string }[];
  onSwitchRole: (roleId: string) => void;
  // Returns to the role the user came from. Undefined when there is nowhere to go back to.
  onBackToRole?: () => void;
  onSignOut: () => void;
}

// Back arrow for the section bar: walks out of a sub-section to Overview first,
// and from Overview returns to the previous role. Renders nothing at the root
// of a first-landed role, where there is nothing to go back to.
export function PhoneBackButton({ nav, atHome, onHome }: { nav?: PhoneNav; atHome: boolean; onHome: () => void }) {
  if (!nav || (atHome && !nav.onBackToRole)) return null;
  return (
    <button
      type="button"
      onClick={atHome ? nav.onBackToRole : onHome}
      aria-label={atHome ? 'Back to previous role' : 'Back to Overview'}
      className="-ml-1.5 grid h-9 w-9 flex-shrink-0 place-items-center rounded-full text-slate-700 transition-transform active:scale-90 dark:text-slate-200"
    >
      <ArrowLeft size={20} />
    </button>
  );
}

// "Switch role" chips + Sign Out, shown at the foot of each dashboard's Menu in
// place of the header/tab strip that is hidden in full-screen phone mode.
export function PhoneRoleSection({ nav, onDone }: { nav?: PhoneNav; onDone: () => void }) {
  if (!nav) return null;
  return (
    <div className="px-4 pb-2 pt-4">
      {nav.roles.length > 0 && (
        <>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Switch role</p>
          <div className="flex flex-wrap gap-2">
            {nav.roles.map(r => (
              <button
                key={r.id}
                type="button"
                onClick={() => { onDone(); nav.onSwitchRole(r.id); }}
                className="rounded-full border border-[#c4a052]/40 bg-[#faf8f3] px-4 py-2 text-xs font-semibold text-slate-700 transition-transform active:scale-95"
              >
                {r.label}
              </button>
            ))}
          </div>
        </>
      )}
      <button
        type="button"
        onClick={() => { onDone(); nav.onSignOut(); }}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-red-50 py-3 text-sm font-semibold text-red-600 ring-1 ring-inset ring-red-100 transition-transform active:scale-[0.99]"
      >
        <LogOut size={16} /> Sign Out
      </button>
    </div>
  );
}
