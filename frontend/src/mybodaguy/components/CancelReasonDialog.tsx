import { useEffect, useState } from 'react';
import { Loader2, AlertTriangle } from 'lucide-react';

const OTHER = '__other__';

/**
 * Asks why something is being cancelled: a short list of common reasons plus
 * "Other" with a text box. The reason is required, so the confirm button stays
 * off until one is picked (or typed).
 */
export default function CancelReasonDialog({
  open, title, description, reasons, warning, confirmLabel = 'Cancel it', busy = false, onConfirm, onClose,
}: {
  open: boolean;
  title: string;
  description?: string;
  reasons: string[];
  /** Shown in an amber box — e.g. "air tickets are not refunded". */
  warning?: string;
  confirmLabel?: string;
  busy?: boolean;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const [choice, setChoice] = useState<string | null>(null);
  const [other, setOther] = useState('');

  useEffect(() => {
    if (open) {
      setChoice(null);
      setOther('');
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  const reason = choice === OTHER ? other.trim() : choice || '';
  const canConfirm = reason.length >= 3 && !busy;

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="cancel-reason-title">
      <div className="max-h-[92dvh] w-full max-w-md space-y-4 overflow-y-auto rounded-2xl bg-white p-5 text-left shadow-xl">
        <div>
          <h4 id="cancel-reason-title" className="text-lg font-bold text-slate-800">{title}</h4>
          {description && <p className="mt-1 text-sm text-slate-600">{description}</p>}
        </div>

        {warning && (
          <div role="note" className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />
            <span>{warning}</span>
          </div>
        )}

        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-semibold text-slate-700">Why are you cancelling?</legend>
          {[...reasons, OTHER].map((r) => {
            const selected = choice === r;
            return (
              <label
                key={r}
                className={`flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg border px-3 text-sm ${selected ? 'border-orange-400 bg-orange-50 font-semibold text-slate-800' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}
              >
                <input type="radio" name="cancel-reason" checked={selected} onChange={() => setChoice(r)} className="accent-orange-500" disabled={busy} />
                {r === OTHER ? 'Other…' : r}
              </label>
            );
          })}
          {choice === OTHER && (
            <textarea
              value={other}
              onChange={(e) => setOther(e.target.value)}
              maxLength={300}
              rows={3}
              autoFocus
              placeholder="Tell us in a few words"
              className="w-full rounded-lg border border-slate-300 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
              disabled={busy}
            />
          )}
        </fieldset>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={!canConfirm}
            onClick={() => onConfirm(reason)}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-red-600 px-4 font-semibold text-white hover:bg-red-700 disabled:opacity-50"
          >
            {busy && <Loader2 className="animate-spin" size={16} />} {confirmLabel}
          </button>
          <button type="button" disabled={busy} onClick={onClose} className="min-h-[44px] rounded-lg px-4 font-semibold text-slate-500 hover:text-slate-700 disabled:opacity-60">
            Keep it
          </button>
        </div>
      </div>
    </div>
  );
}
