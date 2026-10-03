import { QRCodeCanvas } from 'qrcode.react';
import { Bike, Clock, FileCheck, MapPin, Phone, ShieldCheck, Wallet } from 'lucide-react';
import {
  PERMIT_META,
  formatUgx,
  permitDetail,
  riderCardVerifyUrl,
  safeAccent,
  type PermitStatus,
  type RiderCard,
} from '../services/riderCardService';

export type Tone = 'ok' | 'warn' | 'bad' | 'muted';

const TONE_CLASS: Record<Tone, string> = {
  ok: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  warn: 'bg-amber-50 text-amber-800 ring-amber-200',
  bad: 'bg-red-50 text-red-700 ring-red-200',
  muted: 'bg-slate-100 text-slate-600 ring-slate-200',
};

// Small coloured status pill shared by the card, the chairperson's list and the public page.
export function ToneChip({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${TONE_CLASS[tone]}`}>
      {children}
    </span>
  );
}

export function PermitChip({ status }: { status: PermitStatus }) {
  const meta = PERMIT_META[status];
  return (
    <ToneChip tone={meta.tone}>
      <FileCheck size={10} /> Permit: {meta.label}
    </ToneChip>
  );
}

export function FeesChip({ status }: { status: 'paid' | 'pending' }) {
  return (
    <ToneChip tone={status === 'paid' ? 'ok' : 'warn'}>
      <Wallet size={10} /> Fees: {status === 'paid' ? 'Paid' : 'Pending'}
    </ToneChip>
  );
}

const vehicleLabel = (type: string) => type.charAt(0).toUpperCase() + type.slice(1);

const formatDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

// "Stage One · ST-01" — the name, with its code when the district has set one.
const withCode = (name: string | null, code: string | null) =>
  name ? (code ? `${name} · ${code}` : name) : '—';

function Contact({ label, name, phone }: { label: string; name: string | null; phone: string | null }) {
  if (!name && !phone) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-slate-600">
      <span className="font-semibold text-slate-500">{label}:</span>
      {name && <span>{name}</span>}
      {phone && (
        <a href={`tel:${phone.replace(/[^\d+]/g, '')}`} className="inline-flex items-center gap-0.5 font-medium text-slate-800 underline decoration-dotted">
          <Phone size={10} /> {phone}
        </a>
      )}
    </p>
  );
}

// A rider's ID card. The QR opens the public /rider-card/<code> page, which
// answers live — so the card only carries a QR once the rider has paid for it.
export default function RiderIdCard({ card }: { card: RiderCard }) {
  const accent = safeAccent(card.accent_color);
  const isActive = card.status === 'active';
  const notes = [card.division_notes, card.stage_notes].filter((n): n is string => !!n);
  // Tailwind's ring utilities read this variable, so the accent reaches the rings.
  const ringStyle = { '--tw-ring-color': accent } as React.CSSProperties;

  return (
    <div className="overflow-hidden rounded-[22px] bg-[#fffdf7] shadow-[0_18px_34px_-16px_rgba(0,0,0,0.45)] ring-1 ring-black/10">
      {/* Header — the accent colour is the division's or stage's own */}
      <div
        className="flex items-center justify-between gap-3 bg-gradient-to-r from-[#231b12] to-[#4a3418] px-4 py-3 text-white"
        style={{ borderBottom: `4px solid ${accent}` }}
      >
        <div className="flex items-center gap-2">
          <Bike size={18} style={{ color: accent }} />
          <div className="leading-tight">
            <p className="font-classic-display text-sm font-bold">BodaGoEra</p>
            <p className="text-[9px] uppercase tracking-[0.2em] text-white/60">Rider ID card</p>
          </div>
        </div>
        <p className="font-mono text-xs font-semibold tracking-wider text-white/90">{card.card_number}</p>
      </div>

      <div className="space-y-4 p-4">
        {/* Who */}
        <div className="flex items-center gap-3">
          {card.avatar_url ? (
            <img src={card.avatar_url} alt="" className="h-16 w-16 flex-shrink-0 rounded-full object-cover ring-2 ring-offset-2 ring-offset-[#fffdf7]" style={ringStyle} />
          ) : (
            <span
              className="grid h-16 w-16 flex-shrink-0 place-items-center rounded-full font-classic-display text-2xl font-bold text-white ring-2 ring-offset-2 ring-offset-[#fffdf7]"
              style={{ ...ringStyle, background: accent }}
            >
              {card.full_name.charAt(0).toUpperCase()}
            </span>
          )}
          <div className="min-w-0">
            <h3 className="break-words font-classic-display text-xl font-bold leading-tight text-slate-900">{card.full_name}</h3>
            <p className="mt-0.5 text-sm text-slate-600">
              {vehicleLabel(card.vehicle_type)} · <span className="font-semibold uppercase text-slate-800">{card.plate_number}</span>
            </p>
            {(card.vehicle_model || card.vehicle_color) && (
              <p className="text-xs text-slate-500">{[card.vehicle_color, card.vehicle_model].filter(Boolean).join(' · ')}</p>
            )}
          </div>
        </div>

        {/* Where — each division and stage can carry its own code, contact and note */}
        <div className="rounded-xl bg-white p-3 ring-1 ring-black/5">
          <p className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
            <MapPin size={11} /> Where this rider belongs
          </p>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
            <div>
              <dt className="text-[10px] text-slate-400">Stage</dt>
              <dd className="font-semibold text-slate-800">{withCode(card.stage, card.stage_code)}</dd>
            </div>
            <div>
              <dt className="text-[10px] text-slate-400">Division</dt>
              <dd className="font-semibold text-slate-800">{withCode(card.division, card.division_code)}</dd>
            </div>
            <div>
              <dt className="text-[10px] text-slate-400">Parish</dt>
              <dd className="font-medium text-slate-700">{card.parish || '—'}</dd>
            </div>
            <div>
              <dt className="text-[10px] text-slate-400">District</dt>
              <dd className="font-medium text-slate-700">{card.district || '—'}</dd>
            </div>
          </dl>
          <div className="mt-2 space-y-0.5">
            <Contact label="Stage" name={card.stage_contact_name} phone={card.stage_contact_phone} />
            <Contact label="Division" name={card.division_contact_name} phone={card.division_contact_phone} />
          </div>
          {notes.map((note) => (
            <p key={note} className="mt-1.5 text-[11px] italic text-slate-500">{note}</p>
          ))}
        </div>

        {/* Standing — driving permit and fees */}
        <div className="space-y-1.5">
          <div className="flex flex-wrap gap-1.5">
            <PermitChip status={card.permit_status} />
            <FeesChip status={card.fees_status} />
          </div>
          <p className="text-[11px] text-slate-500">
            {permitDetail(card.permit_status, card.license_expiry, card.permit_days_left)}
            {card.license_masked && <span className="font-mono"> · No. {card.license_masked}</span>}
          </p>
          {card.fees_status === 'pending' && (
            <p className="text-[11px] text-amber-700">
              {card.card_fee_status === 'pending' && `Card fee ${card.fee_ican} ICAN not paid yet. `}
              {card.commission_owed_ugx > 0 && `${formatUgx(card.commission_owed_ugx)} ride commission owed.`}
            </p>
          )}
        </div>

        {/* QR — only once paid */}
        {isActive ? (
          <div className="flex items-center gap-4 rounded-xl bg-white p-3 ring-1 ring-black/5">
            <div className="flex-shrink-0 rounded-lg bg-white p-1.5 ring-2" style={ringStyle}>
              <QRCodeCanvas value={riderCardVerifyUrl(card.verify_code)} size={116} level="M" fgColor="#231b12" bgColor="#ffffff" />
            </div>
            <div className="min-w-0 text-xs text-slate-600">
              <p className="flex items-center gap-1 font-semibold text-slate-800"><ShieldCheck size={14} className="text-emerald-600" /> Scan to verify</p>
              <p className="mt-1">Shows this rider's details, driving permit status and fees, live.</p>
              <p className="mt-1 text-[10px] text-slate-400">Issued {formatDate(card.issued_at)}</p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-xl border border-dashed border-amber-300 bg-amber-50/60 p-3 text-xs text-amber-900">
            <Clock size={20} className="flex-shrink-0" />
            <p>The QR code appears here once the rider pays the {card.fee_ican} ICAN card fee.</p>
          </div>
        )}
      </div>
    </div>
  );
}
