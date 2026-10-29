import { useCallback, useEffect, useMemo, useState } from 'react';
import { Building2, Truck, ShieldCheck, CheckCircle, XCircle, Ban, RotateCcw, Search, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { adminBusinessService, type AdminBusinessRow, type AccessStatus, type ReviewDecision } from '../services/businessService';
import { AccessChip } from './BusinessAccessBanner';

type Filter = AccessStatus | 'all';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'pending', label: 'Pending' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'suspended', label: 'Suspended' },
  { id: 'all', label: 'All' },
];

const CATEGORY_LABEL = { transport_company: 'Transport Company', security_escort: 'Security Escort Service' } as const;

function Detail({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className="text-sm text-slate-800 break-words">{value === null || value === '' ? '—' : value}</dd>
    </div>
  );
}

/**
 * Developer Panel: registered-business approvals. A Transport Company or Security Escort business can set itself up
 * freely, but cannot add drivers or go live until a developer approves its registration here
 * (ADD_BUSINESS_REGISTRATION_AND_ACCESS.sql).
 */
export default function DevBusinessesTab({ onPendingCount }: { onPendingCount?: (n: number) => void }) {
  const [rows, setRows] = useState<AdminBusinessRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('pending');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // inline reason box for reject / suspend
  const [reasonFor, setReasonFor] = useState<{ id: string; decision: 'reject' | 'suspend' } | null>(null);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const { rows: list, error: err } = await adminBusinessService.list();
    setRows(list);
    setError(err);
    setLoading(false);
    onPendingCount?.(list.filter((r) => r.access_status === 'pending').length);
  }, [onPendingCount]);

  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { pending: 0, approved: 0, rejected: 0, suspended: 0, all: rows.length };
    for (const r of rows) c[r.access_status] += 1;
    return c;
  }, [rows]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter !== 'all' && r.access_status !== filter) return false;
      if (!q) return true;
      return [r.business_name, r.owner_name, r.owner_email, r.registration_number, r.license_number, r.home_city]
        .some((v) => v?.toLowerCase().includes(q));
    });
  }, [rows, filter, query]);

  const decide = async (row: AdminBusinessRow, decision: ReviewDecision, why?: string) => {
    setBusyId(row.business_profile_id);
    const err = await adminBusinessService.review(row.business_profile_id, decision, why);
    setBusyId(null);
    if (err) {
      toast.error(err);
      return;
    }
    toast.success(
      decision === 'approve' ? `${row.business_name} approved — it can now run its team`
        : decision === 'reject' ? `${row.business_name} rejected — the owner can fix and resubmit`
          : decision === 'suspend' ? `${row.business_name} suspended and its team taken offline`
            : `${row.business_name} reinstated`,
    );
    setReasonFor(null);
    setReason('');
    await load();
  };

  if (error === 'not_installed') {
    return (
      <div className="text-center py-12 max-w-md mx-auto">
        <Building2 size={32} className="mx-auto text-slate-300 mb-3" />
        <p className="font-semibold text-slate-700">Business approvals are not switched on yet</p>
        <p className="text-sm text-slate-500 mt-1">
          Run <code className="text-xs bg-slate-100 px-1 py-0.5 rounded">backend/database/ADD_BUSINESS_REGISTRATION_AND_ACCESS.sql</code> once in
          the Supabase SQL editor. Existing businesses keep working — they are approved automatically.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5 gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Registered Businesses</h2>
          <p className="text-sm text-slate-600 mt-1">
            Review the registration of each Transport Company and Security Escort business. Approved businesses can add drivers and go live.
          </p>
        </div>
        <button
          onClick={load}
          className="px-4 py-2 bg-gradient-to-r from-orange-500 to-yellow-500 text-white font-semibold rounded-lg flex items-center gap-2 shrink-0"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium shrink-0 ${
                filter === f.id ? 'bg-orange-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {f.label} <span className="opacity-75">{counts[f.id]}</span>
            </button>
          ))}
        </div>
        <div className="relative sm:ml-auto sm:w-72">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className="w-full border rounded-lg py-2 pl-8 pr-3 bg-white text-slate-900 placeholder-slate-400 text-sm"
            placeholder="Search name, owner, registration no."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {error && <p className="text-sm text-red-600 mb-3">Could not load businesses: {error}</p>}

      {loading && rows.length === 0 ? (
        <div className="text-center py-12">
          <div className="w-10 h-10 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-slate-600 text-sm">Loading businesses…</p>
        </div>
      ) : visible.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-10">
          {rows.length === 0 ? 'No businesses have registered yet.' : 'No businesses match.'}
        </p>
      ) : (
        <div className="space-y-3">
          {visible.map((r) => {
            const open = expanded === r.business_profile_id;
            const busy = busyId === r.business_profile_id;
            const asking = reasonFor?.id === r.business_profile_id ? reasonFor : null;
            const incomplete = !r.registration_number || !r.license_number;
            const Icon = r.category_key === 'security_escort' ? ShieldCheck : Truck;
            return (
              <div key={r.business_profile_id} className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <div className="p-4 flex flex-col md:flex-row md:items-center gap-3">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    {r.avatar_url ? (
                      <img src={r.avatar_url} alt="" className="w-11 h-11 rounded-lg object-cover shrink-0" />
                    ) : (
                      <div className="w-11 h-11 rounded-lg bg-orange-100 text-orange-500 flex items-center justify-center shrink-0">
                        <Icon size={20} />
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-800 truncate">{r.business_name}</p>
                      <p className="text-xs text-slate-500 flex items-center gap-1.5 flex-wrap">
                        {CATEGORY_LABEL[r.category_key] ?? r.category_key}
                        <AccessChip state={r.access_status} />
                        {r.grandfathered && <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">Existing business</span>}
                      </p>
                      <p className="text-xs text-slate-400 truncate mt-0.5">
                        {r.owner_name || r.owner_email || 'Unknown owner'}
                        {r.home_city ? ` · ${r.home_city}` : ''}
                        {r.submitted_at ? ` · Submitted ${new Date(r.submitted_at).toLocaleDateString()}` : ''}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 shrink-0">
                    <button
                      onClick={() => setExpanded(open ? null : r.business_profile_id)}
                      className="px-3 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-semibold flex items-center gap-1"
                    >
                      {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />} Details
                    </button>
                    {(r.access_status === 'pending' || r.access_status === 'rejected') && (
                      <button
                        disabled={busy || incomplete}
                        title={incomplete ? 'Registration number or licence is missing' : undefined}
                        onClick={() => decide(r, 'approve')}
                        className="px-3 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold flex items-center gap-1 disabled:opacity-50"
                      >
                        <CheckCircle size={14} /> Approve
                      </button>
                    )}
                    {r.access_status === 'pending' && (
                      <button
                        disabled={busy}
                        onClick={() => { setReasonFor({ id: r.business_profile_id, decision: 'reject' }); setReason(''); setExpanded(r.business_profile_id); }}
                        className="px-3 py-2 bg-red-50 text-red-600 border border-red-200 rounded-lg text-sm font-semibold flex items-center gap-1 disabled:opacity-50"
                      >
                        <XCircle size={14} /> Reject
                      </button>
                    )}
                    {r.access_status === 'approved' && (
                      <button
                        disabled={busy}
                        onClick={() => { setReasonFor({ id: r.business_profile_id, decision: 'suspend' }); setReason(''); setExpanded(r.business_profile_id); }}
                        className="px-3 py-2 bg-red-50 text-red-600 border border-red-200 rounded-lg text-sm font-semibold flex items-center gap-1 disabled:opacity-50"
                      >
                        <Ban size={14} /> Suspend
                      </button>
                    )}
                    {r.access_status === 'suspended' && (
                      <button
                        disabled={busy}
                        onClick={() => decide(r, 'reinstate')}
                        className="px-3 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold flex items-center gap-1 disabled:opacity-50"
                      >
                        <RotateCcw size={14} /> Reinstate
                      </button>
                    )}
                  </div>
                </div>

                {open && (
                  <div className="border-t border-slate-100 bg-slate-50 p-4 space-y-3">
                    {incomplete && (
                      <p className="text-xs bg-amber-50 text-amber-800 rounded-lg p-2.5">
                        This business has not given a registration number and licence yet, so it cannot be approved.
                      </p>
                    )}
                    <dl className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3">
                      <Detail label="Registration number" value={r.registration_number} />
                      <Detail label="Licence number" value={r.license_number} />
                      <Detail label="Tax ID (TIN)" value={r.tax_id} />
                      <Detail label="Contact phone" value={r.contact_phone} />
                      <Detail label="Business email" value={r.contact_email} />
                      <Detail label="Website" value={r.website} />
                      <Detail label="Office address" value={r.business_address} />
                      <Detail label="Owner" value={[r.owner_name, r.owner_email].filter(Boolean).join(' · ')} />
                      <Detail label="Team size" value={r.team_size} />
                    </dl>
                    {r.description && <Detail label="Description" value={r.description} />}
                    {r.rejection_reason && (r.access_status === 'rejected' || r.access_status === 'suspended') && (
                      <p className="text-xs text-red-700">
                        {r.access_status === 'suspended' ? 'Suspended' : 'Rejected'}: {r.rejection_reason}
                      </p>
                    )}

                    {asking && (
                      <form
                        onSubmit={(e) => { e.preventDefault(); decide(r, asking.decision, reason); }}
                        className="space-y-2 pt-1"
                      >
                        <label className="block text-xs font-medium text-slate-600">
                          {asking.decision === 'reject'
                            ? 'Why is it not approved? The owner sees this and can fix and resubmit.'
                            : 'Why is it suspended? The owner sees this, and their whole team goes offline now.'}
                        </label>
                        <textarea
                          className="w-full border rounded-lg p-2.5 bg-white text-slate-900 placeholder-slate-400 text-sm"
                          rows={2}
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          autoFocus
                        />
                        <div className="flex gap-2">
                          <button
                            type="submit"
                            disabled={busy || !reason.trim()}
                            className="px-3 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
                          >
                            {asking.decision === 'reject' ? 'Reject business' : 'Suspend business'}
                          </button>
                          <button type="button" onClick={() => setReasonFor(null)} className="px-3 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-semibold">
                            Cancel
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
