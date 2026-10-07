import { useId, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { CalendarClock, Clock, FileCheck, Home, Lock, MapPin, Phone, RotateCw, Shield, ShieldAlert, ShieldCheck, ShieldOff, UserCheck, Wallet } from 'lucide-react';
import {
  CARD_INSURANCE_META,
  POLICY_STATE_META,
  coverTypeLabel,
  type CardInsurance,
} from '../services/insuranceService';
import {
  PERMIT_META,
  canRenewCard,
  cardValidityDetail,
  formatUgx,
  isCardExpired,
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

// How long the card itself stays valid (one year from payment). Nothing for an unpaid card.
export function CardValidityChip({ card }: { card: Pick<RiderCard, 'status' | 'expires_at' | 'card_expired' | 'card_days_left'> }) {
  if (card.status !== 'active' || !card.expires_at) return null;
  const tone: Tone = card.card_expired ? 'bad' : canRenewCard(card) ? 'warn' : 'ok';
  const text = card.card_expired ? 'Expired' : canRenewCard(card) ? 'Expiring soon' : 'Valid';
  return (
    <ToneChip tone={tone}>
      <CalendarClock size={10} /> Card: {text}
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

const INSURANCE_CHIP_TEXT: Record<Exclude<CardInsurance['state'], 'unavailable'>, string> = {
  active: 'Active', grace: 'Renew now', waiting: 'Starts soon', expired: 'Expired', none: 'None',
};

// Nothing at all until insurance is installed, so the card looks exactly as before.
export function InsuranceChip({ insurance }: { insurance?: CardInsurance | null }) {
  if (!insurance || insurance.state === 'unavailable') return null;
  return (
    <ToneChip tone={CARD_INSURANCE_META[insurance.state].tone}>
      <Shield size={10} /> Insurance: {INSURANCE_CHIP_TEXT[insurance.state]}
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
  // The card's one-year expiry, printed as "Expires" on the front.
  expires_at?: string | null;
  // Printed on the back. Only the rider's own card and their chairpersons' views carry these;
  // the public QR page never does.
  next_of_kin_name?: string | null;
  next_of_kin_phone?: string | null;
  next_of_kin_relationship?: string | null;
  home_location?: string | null;
  // Cover shown on the face of the card, read live from the database.
  insurance?: CardInsurance | null;
}

export type CardVisualStatus = 'active' | 'pending' | 'suspended' | 'expired';

const STATUS_LABEL: Record<CardVisualStatus, { text: string; tone: 'ok' | 'warn' | 'bad' }> = {
  active: { text: 'Active', tone: 'ok' },
  pending: { text: 'Unpaid', tone: 'warn' },
  suspended: { text: 'Suspended', tone: 'bad' },
  expired: { text: 'Expired', tone: 'bad' },
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

// Insurance on the face of the card: who insures this rider and until when. It sits in the
// open space between the chip and the photo.
function InsuranceStrip({ insurance }: { insurance?: CardInsurance | null }) {
  if (!insurance || insurance.state === 'unavailable') return null;
  const meta = CARD_INSURANCE_META[insurance.state];
  const top = insurance.policies[0];
  const Icon = insurance.state === 'active' ? ShieldCheck : insurance.state === 'none' ? ShieldOff : ShieldAlert;
  return (
    <div className={`rc-insure ${meta.tone}`}>
      <Icon aria-hidden />
      <div>
        <b>{meta.label}</b>
        <span>{top ? `${top.insurer} · ${monthYear(top.valid_until)}` : 'No cover on record'}</span>
      </div>
    </div>
  );
}

// The two faces of the card. Shared by the on-screen flip card and the print
// sheet, so what is printed is exactly what is shown.
export function CardFront({
  data,
  status,
  uid,
  hidden = false,
}: {
  data: CardVisualData;
  status: CardVisualStatus;
  uid: string;
  hidden?: boolean;
}) {
  const accent = safeAccent(data.accent_color);
  const label = STATUS_LABEL[status];
  return (
    <div className={`rc-face rc-front ${status === 'pending' || status === 'expired' ? 'is-pending' : ''}`} aria-hidden={hidden}>
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

      {status !== 'pending' && status !== 'expired' && <InsuranceStrip insurance={data.insurance} />}

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
            <span className="rc-label">Expires</span>
            <b className="rc-emboss">{status === 'pending' ? '—' : monthYear(data.expires_at)}</b>
          </div>
          <div>
            <span className="rc-label">Permit</span>
            <b className="rc-emboss">{monthYear(data.license_expiry)}</b>
          </div>
        </div>
      </div>

      {status === 'pending' && <div className="rc-stamp">Unpaid</div>}
      {status === 'expired' && <div className="rc-stamp is-expired">Expired</div>}
    </div>
  );
}

export function CardBack({
  data,
  status,
  hidden = false,
}: {
  data: CardVisualData;
  status: CardVisualStatus;
  hidden?: boolean;
}) {
  const active = status === 'active' && !!data.verify_code;
  const hasKin = !!(data.next_of_kin_name || data.next_of_kin_phone);
  return (
    <div className="rc-face rc-back" aria-hidden={hidden}>
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
          <strong>{active ? 'Scan to verify' : status === 'expired' ? 'Card expired' : 'QR locked'}</strong>
          {active
            ? 'Rider details, permit, fees and insurance, live.'
            : status === 'expired'
              ? `Renew for ${data.fee_ican ?? 2} ICAN to unlock this card's QR code.`
              : `Pay ${data.fee_ican ?? 2} ICAN to unlock this card's QR code.`}
          <span className="rc-kin">
            <b>Next of kin</b>
            {hasKin ? (
              <>
                <span>
                  {[data.next_of_kin_name, data.next_of_kin_relationship && `(${data.next_of_kin_relationship})`]
                    .filter(Boolean)
                    .join(' ')}
                </span>
                {data.next_of_kin_phone && <span>{data.next_of_kin_phone}</span>}
              </>
            ) : (
              <span>Not added yet</span>
            )}
            <b>Home</b>
            <span>{data.home_location || 'Not added yet'}</span>
          </span>
          <small>
            Issued {fullDate(data.issued_at)} · {data.card_number}
          </small>
        </div>
      </div>
    </div>
  );
}

// The CSS custom properties that give the card its division's / stage's colour.
export const cardColourStyle = (accentColor: string | null): React.CSSProperties => {
  const accent = safeAccent(accentColor);
  return {
    '--rc-a': accent,
    '--rc-1': darken(accent, 0.5),
    '--rc-2': darken(accent, 0.72),
    '--rc-3': darken(accent, 0.86),
  } as React.CSSProperties;
};

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
  const toggle = () => flippable && setFlipped((f) => !f);

  return (
    <div className="space-y-2">
      <div className="rc" style={cardColourStyle(data.accent_color)}>
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
          <CardFront data={data} status={status} uid={uid} hidden={flipped} />
          {flippable && <CardBack data={data} status={status} hidden={!flipped} />}
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
    card.status === 'pending_payment' ? 'pending'
    : isCardExpired(card) ? 'expired'
    : card.rider_status === 'active' ? 'active'
    : 'suspended';
  const validity = cardValidityDetail(card);
  const hasKin = !!(card.next_of_kin_name || card.next_of_kin_phone);
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

      {/* Standing — driving permit, fees and insurance */}
      <div className="space-y-1.5">
        <div className="flex flex-wrap gap-1.5">
          <CardValidityChip card={card} />
          <PermitChip status={card.permit_status} />
          <FeesChip status={card.fees_status} />
          <InsuranceChip insurance={card.insurance} />
        </div>
        {validity && <p className="text-[11px] text-slate-500">Card: {validity}</p>}
        <p className="text-[11px] text-slate-500">
          {permitDetail(card.permit_status, card.license_expiry, card.permit_days_left)}
          {card.license_masked && <span className="font-mono"> · No. {card.license_masked}</span>}
        </p>
        {card.fees_status === 'pending' && (
          <p className="flex items-start gap-1 text-[11px] text-amber-700">
            <Clock size={12} className="mt-0.5 flex-shrink-0" />
            <span>
              {card.card_fee_status === 'pending' &&
                (isCardExpired(card)
                  ? `Card expired — ${card.fee_ican} ICAN renews it for another year. `
                  : `Card fee ${card.fee_ican} ICAN not paid yet. `)}
              {card.commission_owed_ugx > 0 && `${formatUgx(card.commission_owed_ugx)} ride commission owed.`}
            </span>
          </p>
        )}
      </div>

      {/* Next of kin and home — printed on the back of the card, never on the public QR page */}
      <div className="rounded-xl bg-white p-3 ring-1 ring-black/5">
        <p className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
          <Home size={11} /> Next of kin &amp; home
        </p>
        <dl className="space-y-1.5 text-xs">
          <div>
            <dt className="text-[10px] text-slate-400">Next of kin</dt>
            <dd className="font-semibold text-slate-800">
              {hasKin ? (
                <>
                  {card.next_of_kin_name}
                  {card.next_of_kin_relationship && <span className="font-normal text-slate-500"> ({card.next_of_kin_relationship})</span>}
                  {card.next_of_kin_phone && (
                    <a href={`tel:${card.next_of_kin_phone.replace(/[^\d+]/g, '')}`} className="ml-2 inline-flex items-center gap-0.5 font-medium underline decoration-dotted">
                      <Phone size={10} /> {card.next_of_kin_phone}
                    </a>
                  )}
                </>
              ) : (
                <span className="font-normal text-slate-400">Not added yet</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] text-slate-400">Home location</dt>
            <dd className={card.home_location ? 'font-semibold text-slate-800' : 'text-slate-400'}>{card.home_location || 'Not added yet'}</dd>
          </div>
        </dl>
      </div>

      {/* Insurance — which company covers this rider, with which plan, until when */}
      {card.insurance && card.insurance.state !== 'unavailable' && (
        <div className="rounded-xl bg-white p-3 ring-1 ring-black/5">
          <p className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
            <Shield size={11} /> Insurance cover
          </p>
          {card.insurance.policies.length === 0 ? (
            <p className="text-xs text-slate-500">No insurance cover on record yet.</p>
          ) : (
            <ul className="space-y-2">
              {card.insurance.policies.map((p) => (
                <li key={p.ref} className="flex items-start justify-between gap-2 text-xs">
                  <span className="min-w-0">
                    <span className="block font-semibold text-slate-800">{p.plan} · {coverTypeLabel(p.cover_type)}</span>
                    <span className="block text-slate-500">
                      {p.insurer} · until {fullDate(p.valid_until)}
                      <span className="font-mono"> · {p.ref}</span>
                    </span>
                  </span>
                  <ToneChip tone={POLICY_STATE_META[p.state].tone}>{POLICY_STATE_META[p.state].label}</ToneChip>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
