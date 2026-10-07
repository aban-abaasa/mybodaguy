import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FilePlus2, Phone } from 'lucide-react';
import { ToneChip } from '../RiderIdCard';
import {
  CLAIM_STATUS_META,
  formatIcan,
  insuranceService,
  type LocalRate,
  type MyPolicy,
  type PolicyClaim,
} from '../../services/insuranceService';
import { Amount, Notice, fmtDate } from './coverCommon';

const today = () => new Date().toISOString().slice(0, 10);

// Claims on one policy: file one, follow it, see what the insurer decided and paid.
export default function CoverClaims({ policy, rate, onChanged }: { policy: MyPolicy; rate: LocalRate | null; onChanged?: () => void }) {
  const [claims, setClaims] = useState<PolicyClaim[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(today());
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [links, setLinks] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error: err } = await insuranceService.myClaims(policy.policy_id);
    if (err) setError(err); else { setError(null); setClaims(data ?? []); }
  }, [policy.policy_id]);

  useEffect(() => { load(); }, [load]);

  const canClaim = policy.state === 'active' || policy.state === 'grace' || policy.state === 'expired';
  const limit = policy.plan.cover_limit_ican;

  const submit = async () => {
    const amountNum = amount.trim() === '' ? null : Number(amount);
    if (amountNum !== null && (!Number.isFinite(amountNum) || amountNum <= 0)) { toast.error('Enter the amount in ICAN, or leave it empty'); return; }
    setBusy(true);
    const res = await insuranceService.fileClaim({
      policyId: policy.policy_id,
      incidentDate: date,
      description,
      amount: amountNum,
      evidenceUrls: links.split('\n').map((l) => l.trim()).filter(Boolean),
    });
    setBusy(false);
    if (res.success) {
      toast.success(`Claim ${String(res.claim_number ?? '')} sent to ${policy.insurer.name}`);
      setOpen(false); setDescription(''); setAmount(''); setLinks('');
      await load();
      onChanged?.();
    } else {
      toast.error(res.error || 'Could not file the claim');
    }
  };

  return (
    <div className="space-y-3">
      {policy.insurer.claims_phone && (
        <a href={`tel:${policy.insurer.claims_phone.replace(/[^\d+]/g, '')}`} className="flex items-center gap-2 rounded-xl bg-slate-50 p-3 text-xs text-slate-700">
          <Phone size={14} className="text-orange-500" />
          <span>Claims line: <span className="font-semibold">{policy.insurer.claims_phone}</span></span>
        </a>
      )}

      {error && <Notice tone="bad">{error}</Notice>}

      {!open ? (
        <button type="button" onClick={() => setOpen(true)} disabled={!canClaim} className="classic-btn classic-btn-outline !gap-1.5 !rounded-full disabled:opacity-50">
          <FilePlus2 size={15} /> File a claim
        </button>
      ) : (
        <div className="space-y-3 rounded-xl bg-slate-50 p-3">
          <div>
            <label htmlFor="claim-date" className="classic-label">When did it happen</label>
            <input id="claim-date" type="date" className="classic-input" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label htmlFor="claim-desc" className="classic-label">What happened</label>
            <textarea id="claim-desc" className="classic-input" rows={3} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Tell it as it happened: where, who was involved, what was damaged or lost." />
          </div>
          <div>
            <label htmlFor="claim-amount" className="classic-label">Amount you are claiming (ICAN, optional)</label>
            <input id="claim-amount" type="number" inputMode="decimal" min="0" step="any" className="classic-input" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={`Up to ${formatIcan(limit)}`} />
            <p className="mt-1 text-[11px] text-slate-400">Your cover limit is <Amount ican={limit} rate={rate} />.</p>
          </div>
          <div>
            <label htmlFor="claim-links" className="classic-label">Photos or documents (links, one per line, optional)</label>
            <textarea id="claim-links" className="classic-input" rows={2} value={links} onChange={(e) => setLinks(e.target.value)} placeholder="https://…" />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setOpen(false)} disabled={busy} className="classic-btn classic-btn-outline !rounded-full">Cancel</button>
            <button type="button" onClick={submit} disabled={busy || description.trim().length < 10} className="classic-btn classic-btn-primary !rounded-full">
              {busy ? 'Sending…' : 'Send claim'}
            </button>
          </div>
        </div>
      )}

      {claims === null ? (
        <p className="text-center text-xs text-slate-400" role="status">Loading…</p>
      ) : claims.length === 0 ? (
        <p className="py-3 text-center text-xs text-slate-400">No claims on this policy.</p>
      ) : (
        <ul className="space-y-2.5">
          {claims.map((c) => {
            const meta = CLAIM_STATUS_META[c.status];
            return (
              <li key={c.claim_id} className="rounded-xl bg-white p-3 ring-1 ring-black/5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono text-xs font-semibold text-slate-800">{c.claim_number}</p>
                    <p className="text-[11px] text-slate-400">Happened {fmtDate(c.incident_date)} · sent {fmtDate(c.created_at)}</p>
                  </div>
                  <ToneChip tone={meta.tone}>{meta.label}</ToneChip>
                </div>
                <p className="mt-1.5 text-xs text-slate-600">{c.description}</p>
                {c.amount_claimed_ican != null && <p className="mt-1 text-[11px] text-slate-500">Claimed <Amount ican={c.amount_claimed_ican} rate={rate} /></p>}
                {c.approved_amount_ican != null && <p className="mt-0.5 text-[11px] text-emerald-700">Approved <Amount ican={c.approved_amount_ican} rate={rate} /></p>}
                {c.insurer_note && <p className="mt-1.5 rounded-lg bg-slate-50 p-2 text-[11px] italic text-slate-600">{policy.insurer.name}: {c.insurer_note}</p>}
                {c.status === 'info_needed' && <p className="mt-1.5 text-[11px] font-semibold text-amber-700">{policy.insurer.name} needs more information. Answer in Messages.</p>}
                {c.status === 'paid' && <p className="mt-1.5 text-[11px] font-semibold text-emerald-700">Paid {fmtDate(c.paid_at)}. See your wallet history.</p>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
