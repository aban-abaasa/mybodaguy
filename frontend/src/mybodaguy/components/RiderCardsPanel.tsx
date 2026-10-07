import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Ban, ChevronDown, FileCheck, IdCard, Pencil, Printer, Search, UserCheck, X } from 'lucide-react';
import RiderIdCard, { FeesChip, InsuranceChip, PermitChip, ToneChip } from './RiderIdCard';
import { isPrintableCard, printRiderCards } from './RiderCardPrint';
import {
  DEFAULT_RIDER_CARD_FEE_ICAN,
  isFreshRequest,
  permitDetail,
  riderCardService,
  safeAccent,
  timeAgo,
  type CardRegionInfo,
  type CardRegionInfoSet,
  type DistrictRiderRow,
  type RiderCard,
} from '../services/riderCardService';

type Filter = 'all' | 'no_card' | 'awaiting' | 'active' | 'permit' | 'uninsured';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'no_card', label: 'No card' },
  { id: 'awaiting', label: 'Awaiting payment' },
  { id: 'active', label: 'Active' },
  { id: 'permit', label: 'Permit attention' },
  { id: 'uninsured', label: 'Not insured' },
];

// A card whose insurance has not been put in yet (the SQL isn't run) says nothing either way.
const hasInsuranceData = (row: DistrictRiderRow) =>
  !!row.card?.insurance && row.card.insurance.state !== 'unavailable';
const isUninsured = (row: DistrictRiderRow) => {
  const s = row.card?.insurance?.state;
  return s === 'none' || s === 'expired' || s === 'grace';
};

const vehicleLabel = (type: string) => type.charAt(0).toUpperCase() + type.slice(1);

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="my-auto w-full max-w-md rounded-xl bg-white p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="font-classic-display text-xl font-bold text-slate-800">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-600">
            <X size={22} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function RiderAvatar({ row }: { row: DistrictRiderRow }) {
  return row.avatar_url ? (
    <img src={row.avatar_url} alt="" className="h-12 w-12 flex-shrink-0 rounded-full object-cover ring-2 ring-[#e6c980]" />
  ) : (
    <span className="grid h-12 w-12 flex-shrink-0 place-items-center rounded-full bg-gradient-to-br from-orange-400 to-amber-500 font-classic-display text-xl font-bold text-white ring-2 ring-[#e6c980]">
      {row.full_name.charAt(0).toUpperCase()}
    </span>
  );
}

export default function RiderCardsPanel() {
  const [rows, setRows] = useState<DistrictRiderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fee, setFee] = useState(DEFAULT_RIDER_CARD_FEE_ICAN);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');

  const [viewCard, setViewCard] = useState<RiderCard | null>(null);
  const [issueFor, setIssueFor] = useState<DistrictRiderRow | null>(null);
  const [cancelFor, setCancelFor] = useState<DistrictRiderRow | null>(null);
  const [permitFor, setPermitFor] = useState<DistrictRiderRow | null>(null);

  const [regionInfo, setRegionInfo] = useState<CardRegionInfoSet | null>(null);
  const [regionOpen, setRegionOpen] = useState(false);
  const [editRegion, setEditRegion] = useState<{ type: 'division' | 'stage'; item: CardRegionInfo } | null>(null);

  const load = useCallback(async () => {
    const [{ rows: list, error }, cardFee] = await Promise.all([riderCardService.getDistrictRiders(), riderCardService.getFee()]);
    setRows(list);
    setLoadError(error ?? null);
    setFee(cardFee);
    setLoading(false);
  }, []);

  const loadRegionInfo = useCallback(async () => {
    const { info, error } = await riderCardService.getRegionInfo();
    if (error) toast.error(error);
    setRegionInfo(info);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (regionOpen && !regionInfo) loadRegionInfo();
  }, [regionOpen, regionInfo, loadRegionInfo]);

  const counts = useMemo(() => ({
    riders: rows.length,
    active: rows.filter((r) => r.card?.status === 'active').length,
    awaiting: rows.filter((r) => r.card?.status === 'pending_payment').length,
    none: rows.filter((r) => !r.card).length,
    insuranceKnown: rows.some(hasInsuranceData),
  }), [rows]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === 'no_card' && r.card) return false;
      if (filter === 'awaiting' && r.card?.status !== 'pending_payment') return false;
      if (filter === 'active' && r.card?.status !== 'active') return false;
      if (filter === 'permit' && r.permit_status === 'valid') return false;
      if (filter === 'uninsured' && !isUninsured(r)) return false;
      if (!q) return true;
      return [r.full_name, r.plate_number, r.stage, r.division, r.parish]
        .some((v) => v && v.toLowerCase().includes(q));
    });
  }, [rows, filter, query]);

  if (loading) {
    return <div className="classic-card px-6 py-10 text-center text-sm text-slate-500" role="status">Loading riders…</div>;
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="classic-eyebrow">District</p>
        <h2 className="mt-1 font-classic-display text-[28px] font-bold leading-tight tracking-tight text-slate-900">Rider cards</h2>
        <p className="mt-1 text-sm text-slate-500">
          Issue a QR ID card to a rider. The rider pays {fee} ICAN, shared equally between their stage, parish, subcounty, division and district chairpersons.
        </p>
        <div className="landing-classic-divider mt-4" />
      </div>

      {loadError && (
        <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">We couldn't load your riders.</p>
          <p className="mt-1">{loadError}</p>
          <p className="mt-1 text-xs">If this is the first time, run <code>ADD_RIDER_ID_CARDS.sql</code> in the database.</p>
        </div>
      )}

      <div className="classic-card grid grid-cols-4 divide-x divide-[#c4a052]/25">
        {[
          { label: 'Riders', value: counts.riders },
          { label: 'Active', value: counts.active },
          { label: 'Awaiting', value: counts.awaiting },
          { label: 'No card', value: counts.none },
        ].map((s) => (
          <div key={s.label} className="min-w-0 px-2 py-4 text-center">
            <p className="font-classic-display text-[24px] font-bold leading-none text-slate-900">{s.value}</p>
            <p className="classic-eyebrow mt-2 truncate !tracking-[0.12em]">{s.label}</p>
          </div>
        ))}
      </div>

      {counts.active > 0 && (
        <button
          type="button"
          onClick={() => printRiderCards(rows.map((r) => r.card).filter((c): c is RiderCard => !!c))}
          className="classic-btn classic-btn-outline !gap-1.5 !rounded-full"
        >
          <Printer size={15} /> Print all active cards ({rows.filter((r) => r.card && isPrintableCard(r.card)).length})
        </button>
      )}

      {/* Search + filters */}
      <div className="space-y-3">
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, plate or stage"
            aria-label="Search riders"
            className="classic-input !pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {FILTERS.filter((f) => f.id !== 'uninsured' || counts.insuranceKnown).map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              aria-pressed={filter === f.id}
              className={`classic-chip ${filter === f.id ? 'is-active' : ''}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Riders */}
      {rows.length === 0 && !loadError ? (
        <div className="classic-card px-6 py-9 text-center">
          <IdCard className="mx-auto text-[#c4a052]" size={30} strokeWidth={1.6} />
          <h3 className="mt-3 font-classic-display text-xl font-semibold text-slate-800">No riders in your district yet</h3>
          <p className="mt-1 text-sm text-slate-500">Riders appear here once a stage chairperson assigns them.</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="classic-card px-6 py-8 text-center text-sm text-slate-500">No riders match.</div>
      ) : (
        <ul className="space-y-3">
          {visible.map((row) => {
            const card = row.card;
            const canIssue = !card && row.rider_status === 'active';
            return (
              <li key={row.rider_id} className="classic-card p-3.5">
                <div className="flex items-center gap-3">
                  <RiderAvatar row={row} />
                  <div className="min-w-0 flex-1">
                    <h4 className="truncate font-classic-display text-base font-semibold leading-tight text-slate-800">{row.full_name}</h4>
                    <p className="mt-0.5 truncate text-xs text-slate-500">
                      {vehicleLabel(row.vehicle_type)} · <span className="uppercase">{row.plate_number}</span>
                    </p>
                    <p className="truncate text-xs text-slate-400">{[row.stage, row.division].filter(Boolean).join(' · ')}</p>
                  </div>
                </div>

                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  {!card && <ToneChip tone="muted">No card</ToneChip>}
                  {card?.status === 'pending_payment' && <ToneChip tone="warn">Awaiting rider payment</ToneChip>}
                  {card?.requested_by_rider && (
                    <ToneChip tone={isFreshRequest(card) ? 'warn' : 'muted'}>
                      <UserCheck size={10} /> Requested by rider{card.requested_at ? ` · ${timeAgo(card.requested_at)}` : ''}
                    </ToneChip>
                  )}
                  {card?.status === 'active' && <ToneChip tone="ok">Card active</ToneChip>}
                  {row.rider_status !== 'active' && <ToneChip tone="bad">Rider {row.rider_status}</ToneChip>}
                  <PermitChip status={row.permit_status} />
                  {card && <FeesChip status={card.fees_status} />}
                  {card && <InsuranceChip insurance={card.insurance} />}
                </div>
                <p className="mt-1.5 text-[11px] text-slate-500">
                  {permitDetail(row.permit_status, row.license_expiry, row.permit_days_left)}
                </p>

                <div className="mt-3 flex flex-wrap gap-2">
                  {canIssue && (
                    <button type="button" onClick={() => setIssueFor(row)} className="classic-btn classic-btn-primary !w-auto !min-h-[36px] !gap-1.5 !rounded-full !px-4 !py-1.5 !text-[13px]">
                      <IdCard size={14} /> Issue card
                    </button>
                  )}
                  {!card && !canIssue && (
                    <span className="self-center text-[11px] text-slate-400">Only an active rider can get a card</span>
                  )}
                  {card && (
                    <button type="button" onClick={() => setViewCard(card)} className="classic-btn classic-btn-outline !w-auto !min-h-[36px] !gap-1.5 !rounded-full !px-4 !py-1.5 !text-[13px]">
                      <IdCard size={14} /> View card
                    </button>
                  )}
                  {card?.status === 'pending_payment' && (
                    <button type="button" onClick={() => setCancelFor(row)} className="classic-btn classic-btn-ghost !w-auto !min-h-[36px] !gap-1.5 !rounded-full !px-3 !py-1.5 !text-[13px]">
                      <Ban size={14} /> Cancel
                    </button>
                  )}
                  <button type="button" onClick={() => setPermitFor(row)} className="classic-btn classic-btn-ghost !w-auto !min-h-[36px] !gap-1.5 !rounded-full !px-3 !py-1.5 !text-[13px]">
                    <FileCheck size={14} /> Permit
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Different information per division and per stage */}
      <div className="classic-card overflow-hidden">
        <button
          type="button"
          onClick={() => setRegionOpen((o) => !o)}
          aria-expanded={regionOpen}
          className="flex w-full items-center justify-between gap-3 p-4 text-left"
        >
          <span className="min-w-0">
            <span className="block font-classic-display text-lg font-semibold leading-tight text-slate-800">Card details by division &amp; stage</span>
            <span className="block text-xs text-slate-500">A code, contact, note and colour that appear on every rider card under it</span>
          </span>
          <ChevronDown size={18} className={`flex-shrink-0 text-slate-400 transition-transform ${regionOpen ? 'rotate-180' : ''}`} />
        </button>
        {regionOpen && (
          <div className="space-y-4 px-4 pb-4">
            <div className="landing-classic-divider" />
            {!regionInfo ? (
              <p className="text-sm text-slate-500" role="status">Loading…</p>
            ) : (
              <>
                <RegionList title="Divisions" items={regionInfo.divisions} onEdit={(item) => setEditRegion({ type: 'division', item })} />
                {Array.from(new Set(regionInfo.stages.map((s) => s.division ?? ''))).map((division) => (
                  <RegionList
                    key={division || 'none'}
                    title={division ? `Stages — ${division}` : 'Stages'}
                    items={regionInfo.stages.filter((s) => (s.division ?? '') === division)}
                    onEdit={(item) => setEditRegion({ type: 'stage', item })}
                  />
                ))}
                {regionInfo.divisions.length === 0 && regionInfo.stages.length === 0 && (
                  <p className="text-sm text-slate-500">No divisions or stages in your district yet.</p>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {viewCard && (
        <Modal title="Rider card" onClose={() => setViewCard(null)}>
          <div className="space-y-3">
            <RiderIdCard card={viewCard} />
            {isPrintableCard(viewCard) && (
              <button type="button" onClick={() => printRiderCards([viewCard])} className="classic-btn classic-btn-outline !gap-1.5 !rounded-full">
                <Printer size={15} /> Print card
              </button>
            )}
          </div>
        </Modal>
      )}

      {issueFor && (
        <IssueModal
          row={issueFor}
          fee={fee}
          onClose={() => setIssueFor(null)}
          onDone={() => { setIssueFor(null); load(); }}
        />
      )}

      {cancelFor?.card && (
        <CancelModal
          row={cancelFor}
          onClose={() => setCancelFor(null)}
          onDone={() => { setCancelFor(null); load(); }}
        />
      )}

      {permitFor && (
        <PermitModal
          row={permitFor}
          onClose={() => setPermitFor(null)}
          onDone={() => { setPermitFor(null); load(); }}
        />
      )}

      {editRegion && (
        <RegionInfoModal
          type={editRegion.type}
          item={editRegion.item}
          onClose={() => setEditRegion(null)}
          onDone={() => {
            setEditRegion(null);
            loadRegionInfo();
            load(); // cards read this live, so refresh the cards on screen too
          }}
        />
      )}
    </div>
  );
}

function RegionList({ title, items, onEdit }: { title: string; items: CardRegionInfo[]; onEdit: (item: CardRegionInfo) => void }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="classic-eyebrow mb-2">{title}</p>
      <ul className="divide-y divide-slate-100 rounded-xl ring-1 ring-black/5">
        {items.map((item) => {
          const filled = [item.code, item.contact_name, item.contact_phone, item.notes].some(Boolean);
          return (
            <li key={item.region_id} className="flex items-center gap-3 px-3 py-2.5">
              <span
                className="h-3 w-3 flex-shrink-0 rounded-full ring-1 ring-black/10"
                style={{ background: safeAccent(item.accent_color, '#e2e8f0') }}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-800">
                  {item.name}
                  {item.code && <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">{item.code}</span>}
                </p>
                <p className="truncate text-xs text-slate-500">
                  {filled
                    ? [item.contact_name, item.contact_phone, item.notes].filter(Boolean).join(' · ') || 'Code set'
                    : 'Nothing set — cards show the name only'}
                </p>
              </div>
              <button type="button" onClick={() => onEdit(item)} aria-label={`Edit ${item.name}`} className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-full text-slate-500 hover:bg-[#c4a052]/10 hover:text-[#7a5a12]">
                <Pencil size={14} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function IssueModal({ row, fee, onClose, onDone }: { row: DistrictRiderRow; fee: number; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);

  const issue = async () => {
    setBusy(true);
    const result = await riderCardService.issueCard(row.rider_id);
    setBusy(false);
    if (result.success) {
      toast.success(`Card issued to ${row.full_name}. They can now pay ${fee} ICAN to activate it.`);
      onDone();
    } else {
      toast.error(result.error || 'Could not issue the card');
    }
  };

  return (
    <Modal title="Issue rider card" onClose={onClose}>
      <p className="text-sm text-slate-600">
        Issue a QR ID card to <span className="font-semibold text-slate-800">{row.full_name}</span> ({row.plate_number}, {row.stage ?? 'no stage'}).
      </p>
      <ul className="mt-3 space-y-1.5 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
        <li>• Nothing is charged now. The rider sees the card in their dashboard.</li>
        <li>• The rider pays <span className="font-semibold">{fee} ICAN</span> from their own wallet to activate it.</li>
        <li>• The fee is split equally between the stage, parish, subcounty, division and district chairpersons. A level with no chairperson leaves its share with ICANera.</li>
      </ul>
      <div className="mt-4 flex gap-2">
        <button type="button" onClick={onClose} disabled={busy} className="classic-btn classic-btn-outline !rounded-full">Cancel</button>
        <button type="button" onClick={issue} disabled={busy} className="classic-btn classic-btn-primary !rounded-full">
          {busy ? 'Issuing…' : 'Issue card'}
        </button>
      </div>
    </Modal>
  );
}

function CancelModal({ row, onClose, onDone }: { row: DistrictRiderRow; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const cardId = row.card?.card_id;

  const cancel = async () => {
    if (!cardId) return;
    setBusy(true);
    const result = await riderCardService.cancelCard(cardId);
    setBusy(false);
    if (result.success) {
      toast.success('Card cancelled');
      onDone();
    } else {
      toast.error(result.error || 'Could not cancel the card');
    }
  };

  return (
    <Modal title="Cancel card" onClose={onClose}>
      <p className="text-sm text-slate-600">
        Cancel the unpaid card for <span className="font-semibold text-slate-800">{row.full_name}</span>? Nothing was charged. You can issue a new one afterwards.
      </p>
      <div className="mt-4 flex gap-2">
        <button type="button" onClick={onClose} disabled={busy} className="classic-btn classic-btn-outline !rounded-full">Keep</button>
        <button type="button" onClick={cancel} disabled={busy} className="classic-btn classic-btn-ink !rounded-full">
          {busy ? 'Cancelling…' : 'Cancel card'}
        </button>
      </div>
    </Modal>
  );
}

function PermitModal({ row, onClose, onDone }: { row: DistrictRiderRow; onClose: () => void; onDone: () => void }) {
  const [number, setNumber] = useState(row.license_number ?? '');
  const [expiry, setExpiry] = useState(row.license_expiry ?? '');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    const result = await riderCardService.setRiderPermit(row.rider_id, number, expiry);
    setBusy(false);
    if (result.success) {
      toast.success('Driving permit saved');
      onDone();
    } else {
      toast.error(result.error || 'Could not save the permit');
    }
  };

  return (
    <Modal title="Driving permit" onClose={onClose}>
      <p className="mb-3 text-sm text-slate-600">
        {row.full_name} · <span className="uppercase">{row.plate_number}</span>. The QR code shows whether this permit is valid, expiring soon or expired.
      </p>
      <div className="space-y-3">
        <div>
          <label htmlFor="permit-number" className="classic-label">Permit number</label>
          <input id="permit-number" className="classic-input" value={number} maxLength={40} onChange={(e) => setNumber(e.target.value)} placeholder="Driving permit number" />
        </div>
        <div>
          <label htmlFor="permit-expiry" className="classic-label">Expiry date</label>
          <input id="permit-expiry" type="date" className="classic-input" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
          <p className="mt-1 text-[11px] text-slate-400">Leave blank if the expiry isn't known; the permit shows as "not recorded".</p>
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <button type="button" onClick={onClose} disabled={busy} className="classic-btn classic-btn-outline !rounded-full">Cancel</button>
        <button type="button" onClick={save} disabled={busy} className="classic-btn classic-btn-primary !rounded-full">
          {busy ? 'Saving…' : 'Save permit'}
        </button>
      </div>
    </Modal>
  );
}

function RegionInfoModal({ type, item, onClose, onDone }: { type: 'division' | 'stage'; item: CardRegionInfo; onClose: () => void; onDone: () => void }) {
  const [code, setCode] = useState(item.code ?? '');
  const [contactName, setContactName] = useState(item.contact_name ?? '');
  const [contactPhone, setContactPhone] = useState(item.contact_phone ?? '');
  const [notes, setNotes] = useState(item.notes ?? '');
  const [accent, setAccent] = useState(item.accent_color ?? '');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    const result = await riderCardService.setRegionInfo(type, item.region_id, {
      code,
      contact_name: contactName,
      contact_phone: contactPhone,
      notes,
      accent_color: accent || null,
    });
    setBusy(false);
    if (result.success) {
      toast.success(`${item.name} card details saved`);
      onDone();
    } else {
      toast.error(result.error || 'Could not save');
    }
  };

  return (
    <Modal title={`${type === 'division' ? 'Division' : 'Stage'}: ${item.name}`} onClose={onClose}>
      <p className="mb-3 text-xs text-slate-500">
        Shown on every rider card in this {type}, and on the public page its QR opens. Leave everything blank to clear it.
      </p>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="region-code" className="classic-label">Code</label>
            <input id="region-code" className="classic-input" value={code} maxLength={16} onChange={(e) => setCode(e.target.value)} placeholder={type === 'division' ? 'e.g. KWP' : 'e.g. ST-04'} />
          </div>
          <div>
            <label htmlFor="region-accent" className="classic-label">Card colour</label>
            <div className="flex items-center gap-2">
              <input
                id="region-accent"
                type="color"
                value={safeAccent(accent, '#c4a052')}
                onChange={(e) => setAccent(e.target.value)}
                className="h-[42px] w-14 cursor-pointer rounded-lg border border-slate-200 bg-white p-1"
              />
              {accent && (
                <button type="button" onClick={() => setAccent('')} className="text-xs text-slate-500 underline">Default</button>
              )}
            </div>
          </div>
        </div>
        <div>
          <label htmlFor="region-contact-name" className="classic-label">Contact name</label>
          <input id="region-contact-name" className="classic-input" value={contactName} maxLength={60} onChange={(e) => setContactName(e.target.value)} placeholder={type === 'division' ? 'Division office' : 'Stage chairperson'} />
        </div>
        <div>
          <label htmlFor="region-contact-phone" className="classic-label">Contact phone</label>
          <input id="region-contact-phone" type="tel" className="classic-input" value={contactPhone} maxLength={24} onChange={(e) => setContactPhone(e.target.value)} placeholder="+256 700 000000" />
        </div>
        <div>
          <label htmlFor="region-notes" className="classic-label">Note on the card</label>
          <textarea id="region-notes" className="classic-input" rows={2} value={notes} maxLength={160} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Report misconduct to the stage office" />
          <p className="mt-1 text-right text-[11px] text-slate-400">{notes.length}/160</p>
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <button type="button" onClick={onClose} disabled={busy} className="classic-btn classic-btn-outline !rounded-full">Cancel</button>
        <button type="button" onClick={save} disabled={busy} className="classic-btn classic-btn-primary !rounded-full">
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </Modal>
  );
}
