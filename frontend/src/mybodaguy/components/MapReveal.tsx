/**
 * MapReveal — keeps a map out of the way until the customer asks for it.
 * Children are only mounted while open, so a hidden map costs no Leaflet
 * init, no tile requests and no GPS prompt. Pass `summary` to show the
 * current choice (e.g. the selected address) while the map is collapsed.
 */
import { useState, type ReactNode } from 'react';
import { ChevronDown, Map as MapIcon } from 'lucide-react';

interface Props {
  children: ReactNode;
  showLabel?: string;
  hideLabel?: string;
  summary?: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}

export default function MapReveal({
  children,
  showLabel = 'Show map',
  hideLabel = 'Hide map',
  summary,
  defaultOpen = false,
  className = '',
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 rounded-xl border border-dashed border-[#c4a052]/60 px-3 py-2.5 text-left text-sm font-semibold text-orange-700 transition-colors hover:bg-orange-50"
      >
        <span className="flex min-w-0 items-center gap-2">
          <MapIcon size={15} className="shrink-0" />
          <span className="truncate">{open ? hideLabel : showLabel}</span>
        </span>
        <ChevronDown size={15} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {!open && summary ? <div className="mt-1.5 px-1 text-xs text-slate-500">{summary}</div> : null}
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}
