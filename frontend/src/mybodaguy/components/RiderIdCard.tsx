import { useId, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { Clock, FileCheck, Lock, MapPin, Phone, RotateCw, UserCheck, Wallet } from 'lucide-react';
import {
  PERMIT_META,
  formatUgx,
  isFreshRequest,
  permitDetail,
  riderCardVerifyUrl,
  safeAccent,
  timeAgo,
  type PermitStatus,
  type RiderCard,
} from '../services/riderCardService';
import './riderCard.css';

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

// ── The card itself ───────────────────────────────────────────────────────

// What the two faces of the card print. A full RiderCard has all of it; the
// public QR page builds the same shape from what it is allowed to show.
export interface CardVisualData {
  card_number: string;
  full_name: string;
  avatar_url: string | null;
  vehicle_type: string;
  plate_number: string;
  stage: string | null;
  stage_code: string | null;
  division: string | null;
  division_code: string | null;
  member_since: string;
  license_expiry: string | null;
  issued_at: string;
  accent_color: string | null;
  verify_code?: string;
  fee_ican?: number;
}

export type CardVisualStatus = 'active' | 'pending' | 'suspended';

const STATUS_LABEL: Record<CardVisualStatus, { text: string; tone: 'ok' | 'warn' | 'bad' }> = {
  active: { text: 'Active', tone: 'ok' },
  pending: { text: 'Unpaid', tone: 'warn' },
  suspended: { text: 'Suspended', tone: 'bad' },
};

// Darken a #rrggbb colour towards black by t (0..1).
const darken = (hex: string, t: number) =>
  '#' + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - t)).toString(16).padStart(2, '0')).join('');

// "BGE-000123" -> "BGE 0000 0123", the way a card prints its number.
const formatNumber = (cardNumber: string) => {
  const digits = cardNumber.replace(/\D/g, '').padStart(8, '0');
  return `BGE ${digits.slice(0, 4)} ${digits.slice(4, 8)}`;
};

const monthYear = (iso?: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(-2)}`;
};

const fullDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const vehicleLabel = (type: string) => type.charAt(0).toUpperCase() + type.slice(1);

const withCode = (name: string | null, code: string | null) =>
  name ? (code ? `${name} · ${code}` : name) : '—';

function WheelMark({ accent }: { accent: string }) {
  return (
    <svg viewBox="0 0 34 22" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="8.2" stroke="#fff" strokeWidth="2.4" />
      <circle cx="23" cy="11" r="8.2" stroke={accent} strokeWidth="2.4" />
      <circle cx="11" cy="11" r="1.7" fill="#fff" />
      <circle cx="23" cy="11" r="1.7" fill={accent} />
    </svg>
  );
}

function Contactless() {
  return (
    <svg className="rc-contactless" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M6 8.5a5.2 5.2 0 0 1 0 7" />
      <path d="M10 6a9 9 0 0 1 0 12" />
      <path d="M14 3.5a12.8 12.8 0 0 1 0 17" />
    </svg>
  );
}

function EmvChip({ idPrefix }: { idPrefix: string }) {
  return (
    <svg className="rc-chip" viewBox="0 0 48 36" aria-hidden>
      <defs>
        <linearGradient id={`${idPrefix}-gold`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f6e3a1" />
          <stop offset="0.45" stopColor="#d9b45a" />
          <stop offset="1" stopColor="#a9822c" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="46" height="34" rx="6" fill={`url(#${idPrefix}-gold)`} stroke="#7a5f18" strokeWidth="1" />
      <path
        d="M1 12h13c4 0 6 3 6 6s-2 6-6 6H1M47 12H34c-4 0-6 3-6 6s2 6 6 6h13M16 1v34M32 1v34"
        stroke="#7a5f18"
        strokeWidth="1"
        fill="none"
      />
    </svg>
  );
}

// The visual: a credit-card-style rider ID. Tap to flip to the back, which
// carries the QR once the rider has paid. `flippable={false}` shows the front only.
export function RiderCardVisual({
  data,
  status,
  flippable = true,
}: {
  data: CardVisualData;
  status: CardVisualStatus;
  flippable?: boolean;
}) {
  const [flipped, setFlipped] = useState(false);
  const uid = useId().replace(/:/g, '');
  const accent = safeAccent(data.accent_color);
  const label = STATUS_LABEL[status];
  const active = status === 'active' && !!data.verify_code;

  const style = {
    '--rc-a': accent,
    '--rc-1': darken(accent, 0.5),
    '--rc-2': darken(accent, 0.72),
    '--rc-3': darken(accent, 0.86),
  } as React.CSSProperties;

  const toggle = () => flippable && setFlipped((f) => !f);

  return (
    <div className="space-y-2">
      <div className="rc" style={style}>
        <div
          className={`rc-flip ${flipped ? 'is-flipped' : ''} ${flippable ? '' : 'is-static'}`}
          {...(flippable
            ? {
                role: 'button',
                tabIndex: 0,
                'aria-pressed': flipped,
                'aria-label': flipped ? 'Rider card, back. Tap to see the front' : 'Rider card, front. Tap to see the back',
                onClick: toggle,
                onKeyDown: (e: React.KeyboardEvent) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggle();
                  }
                },
              }
            : {})}
        >
          {/* Front */}
          <div className={`rc-face rc-front ${status === 'pending' ? 'is-pending' : ''}`} aria-hidden={flipped}>
            <div className="rc-pad">
              <div className="rc-top">
                <div className="rc-logo">
                  <WheelMark accent={accent} /> BodaGoEra
                </div>
                <div className="rc-top-right">
                  <span className={`rc-pill ${label.tone}`}>
                    <i /> {label.text}
                  </span>
                  <Contactless />
                </div>
              </div>
            </div>

            <EmvChip idPrefix={uid} />

            {data.avatar_url ? (
              <img className="rc-photo" src={data.avatar_url} alt="" />
            ) : (
              <div className="rc-photo" style={{ background: accent }}>
                {data.full_name.charAt(0).toUpperCase()}
              </div>
            )}

            <div className="rc-number rc-emboss">{formatNumber(data.card_number)}</div>

            <div className="rc-place">
              {withCode(data.stage, data.stage_code)} · {withCode(data.division, data.division_code)}
            </div>
            <div className="rc-holo" aria-hidden />

            <div className="rc-bottom">
              <div style={{ minWidth: 0, flex: 1 }}>
                <span className="rc-label">
                  {vehicleLabel(data.vehicle_type)} · {data.plate_number.toUpperCase()}
                </span>
                <span className="rc-name rc-emboss">{data.full_name}</span>
              </div>
              <div className="rc-meta">
                <div>
                  <span className="rc-label">Since</span>
                  <b className="rc-emboss">{monthYear(data.member_since)}</b>
                </div>
                <div>
                  <span className="rc-label">Permit</span>
                  <b className="rc-emboss">{monthYear(data.license_expiry)}</b>
                </div>
              </div>
            </div>

            {status === 'pending' && <div className="rc-stamp">Unpaid</div>}
          </div>

          {/* Back */}
          {flippable && (
            <div className="rc-face rc-back" aria-hidden={!flipped}>
              <div className="rc-stripe" />
              <div className="rc-sign">
                <em>{data.full_name}</em>
                <span className="rc-cvc">{data.stage_code || 'BGE'}</span>
              </div>
              <div className="rc-qr-row">
                {active ? (
                  <div className="rc-qr">
                    <QRCodeCanvas value={riderCardVerifyUrl(data.verify_code!)} size={240} level="M" fgColor="#231b12" bgColor="#ffffff" />
                  </div>
                ) : (
                  <div className="rc-qr is-locked">
                    <Lock aria-hidden />
                  </div>
                )}
                <div className="rc-fine">
                  <strong>{active ? 'Scan to verify' : 'QR locked'}</strong>
                  {active
                    ? "Shows this rider's details, driving permit status and fees, live."
                    : `Pay ${data.fee_ican ?? 2} ICAN to unlock this card's QR code.`}
                  <small>
                    Issued {fullDate(data.issued_at)} · {data.card_number}
                  </small>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {flippable && (
        <button
          type="button"
          onClick={toggle}
          className="mx-auto flex items-center gap-1.5 text-[11px] font-medium text-slate-500 hover:text-slate-700"
        >
          <RotateCw size={12} /> {flipped ? 'Show front' : 'Flip card for QR'}
        </button>
      )}
    </div>
  );
}

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

// A rider's ID card: the credit-card visual on top, and everything that does not
// fit on a card — where the rider belongs, the contacts, permit and fee status —
// beneath it.
export default function RiderIdCard({ card }: { card: RiderCard }) {
  const status: CardVisualStatus =
    card.status === 'pending_payment' ? 'pending' : card.rider_status === 'active' ? 'active' : 'suspended';
  const notes = [card.division_notes, card.stage_notes].filter((n): n is string => !!n);
  const fresh = isFreshRequest(card);

  return (
    <div className="space-y-4">
      <RiderCardVisual data={card} status={status} />

      {card.requested_by_rider && (
        <div
          className={`flex items-start gap-2 rounded-xl p-3 text-xs ring-1 ring-inset ${
            fresh ? 'bg-amber-50 text-amber-900 ring-amber-200' : 'bg-slate-50 text-slate-600 ring-slate-200'
          }`}
        >
          <UserCheck size={15} className="mt-0.5 flex-shrink-0" />
          <p>
            <span className="font-semibold">{fresh ? 'Just requested by the rider' : 'Requested by the rider'}</span>
            {card.requested_at && <> · {timeAgo(card.requested_at)}</>}
            {card.status === 'pending_payment' && <> — waiting for them to pay {card.fee_ican} ICAN.</>}
          </p>
        </div>
      )}

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
          <p className="flex items-start gap-1 text-[11px] text-amber-700">
            <Clock size={12} className="mt-0.5 flex-shrink-0" />
            <span>
              {card.card_fee_status === 'pending' && `Card fee ${card.fee_ican} ICAN not paid yet. `}
              {card.commission_owed_ugx > 0 && `${formatUgx(card.commission_owed_ugx)} ride commission owed.`}
            </span>
          </p>
        )}
      </div>
    </div>
  );
}
