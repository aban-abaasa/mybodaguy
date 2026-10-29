import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * Collapsible block in the app's ivory / ink / gold style: an eyebrow title, an optional one-line summary shown
 * while collapsed, and a chevron. Uncontrolled by default; pass `open` + `onToggle` to control it.
 */
export default function ClassicSection({
  title,
  summary,
  right,
  defaultOpen = false,
  open: controlledOpen,
  onToggle,
  children,
}: {
  title: string;
  summary?: React.ReactNode;
  right?: React.ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onToggle?: (open: boolean) => void;
  children: React.ReactNode;
}) {
  const [inner, setInner] = useState(defaultOpen);
  const open = controlledOpen ?? inner;
  const toggle = () => {
    const next = !open;
    if (controlledOpen === undefined) setInner(next);
    onToggle?.(next);
  };

  return (
    <section className="rounded-2xl border border-[#c4a052]/30 bg-white dark:border-slate-700">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="classic-eyebrow block">{title}</span>
          {!open && summary && <span className="mt-0.5 block truncate text-sm text-slate-600">{summary}</span>}
        </span>
        {right}
        <ChevronDown size={18} className={`shrink-0 text-[#a17c28] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="border-t border-[#c4a052]/20 px-4 pb-4 pt-4">{children}</div>}
    </section>
  );
}
