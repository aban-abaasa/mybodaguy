import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Eye } from 'lucide-react';
import {
  BUSINESS_SHARE_SCOPES,
  SHARE_SCOPES,
  insuranceService,
  type AccessLogEntry,
  type BusinessShareScope,
  type MyPolicy,
  type ShareScope,
} from '../../services/insuranceService';
import { Notice } from './coverCommon';

const scopeName = (id: string) =>
  SHARE_SCOPES.find((s) => s.id === id)?.label ?? BUSINESS_SHARE_SCOPES.find((s) => s.id === id)?.label ?? id;

// What the insurer may read about the holder. Off unless ticked, changeable any time, and every
// look is listed below. A business that pays for a driver shares only the business's own data here;
// the driver decides about the driver's.
export default function CoverSharing({ policy, mode, onChanged }: { policy: MyPolicy; mode: 'holder' | 'business'; onChanged?: () => void }) {
  const isBusiness = mode === 'business';
  const options = isBusiness ? BUSINESS_SHARE_SCOPES : SHARE_SCOPES;
  const saved = (isBusiness ? policy.business_scopes : policy.holder_scopes) as string[];
  const [scopes, setScopes] = useState<string[]>(saved);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<AccessLogEntry[] | null>(null);

  useEffect(() => { setScopes(saved); }, [saved.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    insuranceService.accessLog(policy.policy_id).then(({ data }) => { if (!cancelled) setLog(data ?? []); });
    return () => { cancelled = true; };
  }, [policy.policy_id]);

  const dirty = scopes.slice().sort().join('|') !== saved.slice().sort().join('|');
  const toggle = (id: string) => setScopes((cur) => (cur.includes(id) ? cur.filter((s) => s !== id) : [...cur, id]));

  const save = async () => {
    setBusy(true);
    const res = isBusiness
      ? await insuranceService.setBusinessConsent(policy.policy_id, scopes as BusinessShareScope[])
      : await insuranceService.setConsent(policy.policy_id, scopes as ShareScope[]);
    setBusy(false);
    if (res.success) { toast.success('Saved'); onChanged?.(); } else toast.error(res.error || 'Could not save');
  };

  const discountScopes = policy.plan.data_discount_scopes;
  const discountOn = !isBusiness && policy.plan.data_discount_pct > 0 && discountScopes.every((s) => scopes.includes(s));

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        {isBusiness
          ? `Choose what ${policy.insurer.name} can see about the business. Nothing is shared unless you tick it.`
          : `Choose what ${policy.insurer.name} can see about you. Nothing is shared unless you tick it, and you can stop at any time.`}
      </p>

      {!isBusiness && policy.plan.data_discount_pct > 0 && (
        <Notice tone={discountOn ? 'ok' : 'warn'}>
          {discountOn
            ? `Sharing ${discountScopes.map(scopeName).join(' and ').toLowerCase()} saves you ${policy.plan.data_discount_pct}% when this cover renews.`
            : `Share ${discountScopes.map(scopeName).join(' and ').toLowerCase()} and pay ${policy.plan.data_discount_pct}% less when this cover renews.`}
        </Notice>
      )}

      <ul className="space-y-2">
        {options.map((s) => (
          <li key={s.id}>
            <label className="flex cursor-pointer items-start gap-2 text-xs text-slate-700">
              <input type="checkbox" className="mt-0.5" checked={scopes.includes(s.id)} onChange={() => toggle(s.id)} />
              <span><span className="font-semibold">{s.label}</span><span className="block text-[11px] text-slate-500">{s.help}</span></span>
            </label>
          </li>
        ))}
      </ul>

      <button type="button" onClick={save} disabled={busy || !dirty} className="classic-btn classic-btn-primary !rounded-full disabled:opacity-50">
        {busy ? 'Saving…' : 'Save what I share'}
      </button>

      <div>
        <p className="classic-label flex items-center gap-1"><Eye size={12} /> Who looked</p>
        {log === null ? (
          <p className="text-xs text-slate-400" role="status">Loading…</p>
        ) : log.length === 0 ? (
          <p className="text-xs text-slate-400">{policy.insurer.name} has not looked at your shared data.</p>
        ) : (
          <ul className="space-y-1.5">
            {log.map((e) => (
              <li key={`${e.at}-${e.insurer}`} className="flex items-start justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
                <span><span className="font-semibold">{e.insurer}</span> looked at {e.scopes.map(scopeName).join(', ').toLowerCase()}</span>
                <span className="flex-shrink-0 text-slate-400">{new Date(e.at).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
