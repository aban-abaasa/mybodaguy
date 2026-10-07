import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { ToneChip } from '../RiderIdCard';
import {
  POLICY_STATE_META,
  formatIcan,
  formatLocal,
  getLocalRate,
  type LocalRate,
  type PolicyState,
} from '../../services/insuranceService';

// The user's own currency at the live ICAN price. Null (and quietly hidden) if the price engine can't be reached.
export function useLocalRate(userId?: string) {
  const [rate, setRate] = useState<LocalRate | null>(null);
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    getLocalRate(userId).then((r) => { if (!cancelled) setRate(r); });
    return () => { cancelled = true; };
  }, [userId]);
  return rate;
}

export const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export function StateChip({ state }: { state: PolicyState }) {
  const meta = POLICY_STATE_META[state];
  return <ToneChip tone={meta.tone}>{meta.label}</ToneChip>;
}

// "12.5 ICAN  ≈ UGX 62,500"
export function Amount({ ican, rate, suffix = '' }: { ican: number | null | undefined; rate: LocalRate | null; suffix?: string }) {
  return (
    <span>
      <span className="font-semibold text-slate-800">{formatIcan(ican)} ICAN</span>
      {suffix && <span className="text-slate-500">{suffix}</span>}
      {rate && ican != null && <span className="ml-1.5 text-[11px] text-slate-400">{formatLocal(ican, rate)}</span>}
    </span>
  );
}

// A bottom sheet on a phone, a centred card on a desktop.
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[1100] flex items-end justify-center bg-black/50 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 h-full w-full cursor-default" />
      <div className="relative max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-[24px] bg-white p-5 shadow-2xl sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="font-classic-display text-xl font-bold text-slate-800">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Notice({ tone = 'muted', children }: { tone?: 'muted' | 'warn' | 'bad' | 'ok'; children: React.ReactNode }) {
  const cls = {
    muted: 'bg-slate-50 text-slate-600 ring-slate-200',
    warn: 'bg-amber-50 text-amber-900 ring-amber-200',
    bad: 'bg-red-50 text-red-800 ring-red-200',
    ok: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  }[tone];
  return <div role={tone === 'bad' || tone === 'warn' ? 'alert' : undefined} className={`rounded-xl p-3 text-xs ring-1 ring-inset ${cls}`}>{children}</div>;
}
