import { useEffect, useState } from 'react';
import { AlertTriangle, Ban, CheckCircle, Clock, FileCheck, MapPin, Phone, Shield, ShieldCheck, Star, Wallet, XCircle } from 'lucide-react';
import { FeesChip, InsuranceChip, PermitChip, RiderCardVisual, ToneChip, type CardVisualData } from './RiderIdCard';
import { POLICY_STATE_META, coverTypeLabel } from '../services/insuranceService';
import {
  formatUgx,
  permitDetail,
  riderCardService,
  safeAccent,
  type RiderCardProof,
} from '../services/riderCardService';

const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const withCode = (name?: string | null, code?: string | null) => (name ? (code ? `${name} · ${code}` : name) : '—');


function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 border-t border-slate-100 p-5">
      <h2 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
        {icon} {title}
      </h2>
      {children}
    </section>
  );
}

function Contact({ label, name, phone }: { label: string; name?: string | null; phone?: string | null }) {
  if (!name && !phone) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-slate-600">
      <span className="font-semibold text-slate-500">{label}:</span>
      {name && <span>{name}</span>}
      {phone && (
        <a href={`tel:${phone.replace(/[^\d+]/g, '')}`} className="inline-flex items-center gap-0.5 font-medium text-slate-800 underline decoration-dotted">
          <Phone size={11} /> {phone}
        </a>
      )}
    </p>
  );
}

// Public, unauthenticated page for https://bodagoera.icanera.space/rider-card/<code>
// — what scanning the QR on a rider's ID card opens. It asks the database live
// (mbg_verify_rider_card, GRANT'd to anon), so a suspended rider, an expired
// driving permit or an unpaid fee shows up the moment it happens. Only
// public-safe details come back: never the rider's phone, email, full permit
// number or wallet.
export default function RiderCardVerifyPage({ code }: { code: string }) {
  const [proof, setProof] = useState<RiderCardProof | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { proof: result, error } = await riderCardService.verifyCard(code);
      if (cancelled) return;
      // A server error is not the same as "no such card" — say which it is.
      if (error) setLoadError(error);
      else setProof(result);
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  const state = proof?.state;
  const tone =
    state === 'valid' ? { icon: <CheckCircle size={44} />, cls: 'text-emerald-600', title: 'Genuine rider card', sub: 'This rider is registered and active on BodaGoEra.' }
    : state === 'suspended' ? { icon: <Ban size={44} />, cls: 'text-red-600', title: 'Rider not active', sub: 'This card is genuine but the rider is currently suspended or inactive. Do not treat it as valid.' }
    : state === 'unpaid' ? { icon: <Clock size={44} />, cls: 'text-amber-600', title: 'Card not activated', sub: 'This card has not been paid for yet, so it is not valid.' }
    : state === 'cancelled' ? { icon: <XCircle size={44} />, cls: 'text-red-600', title: 'Card cancelled', sub: 'This card was cancelled. Do not accept it.' }
    : { icon: <XCircle size={44} />, cls: 'text-red-600', title: 'Not a valid card', sub: 'No rider card matches this code. It may be forged or mistyped.' };

  const showDetails = state === 'valid' || state === 'suspended';
  const accent = safeAccent(proof?.accent_color);
  const fees = proof?.fees;
  const permit = proof?.permit_status ?? 'not_recorded';
  const warnings: string[] = [];
  if (showDetails) {
    if (permit === 'expired') warnings.push('The driving permit has expired.');
    if (permit === 'expiring_soon') warnings.push('The driving permit expires soon.');
    if (fees?.card_fee_status === 'pending') warnings.push('The ID card fee is pending.');
    if ((fees?.commission_owed_ugx ?? 0) > 0) warnings.push('Ride commission is still owed to the chairpersons.');
    // Never having been insured is not a warning (cover is new); a lapse is.
    if (proof?.insurance?.state === 'expired') warnings.push('The insurance cover has expired.');
    if (proof?.insurance?.state === 'grace') warnings.push('The insurance cover has ended and is in its grace days.');
  }
  const notes = [proof?.division_notes, proof?.stage_notes].filter((n): n is string => !!n);
  // The same credit-card visual riders carry, built from what the public page may show.
  const visual: CardVisualData | null = proof && showDetails
    ? {
        card_number: proof.card_number ?? '',
        full_name: proof.full_name ?? '',
        avatar_url: proof.avatar_url ?? null,
        vehicle_type: proof.vehicle_type ?? '',
        plate_number: proof.plate_number ?? '',
        stage: proof.stage ?? null,
        stage_code: proof.stage_code ?? null,
        division: proof.division ?? null,
        division_code: proof.division_code ?? null,
        member_since: proof.member_since ?? '',
        license_expiry: proof.license_expiry ?? null,
        issued_at: proof.issued_at ?? '',
        accent_color: proof.accent_color ?? null,
        insurance: proof.insurance ?? null,
      }
    : null;
  const insurance = proof?.insurance && proof.insurance.state !== 'unavailable' ? proof.insurance : null;

  return (
    <div className="min-h-screen bg-[#f7f1e3] px-4 py-8">
      <div className="mx-auto max-w-md space-y-4">
        <div className="flex items-center justify-center gap-2 text-sm font-semibold text-[#5c4410]">
          <ShieldCheck size={18} /> BodaGoEra rider check
        </div>

        {loadError ? (
          <div role="alert" className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-center text-sm text-amber-900">
            <AlertTriangle className="mx-auto mb-2" size={28} />
            <p className="font-semibold">We couldn't check this card right now.</p>
            <p className="mt-1">This is a connection problem, not a verdict on the card. Please try again in a moment.</p>
          </div>
        ) : !proof ? (
          <div role="status" className="rounded-2xl bg-white p-8 text-center text-sm text-slate-500 shadow-sm">Checking card…</div>
        ) : (
          <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
            <div className={`flex flex-col items-center gap-1 px-5 py-6 text-center ${tone.cls}`} style={showDetails ? { borderBottom: `4px solid ${accent}` } : undefined}>
              {tone.icon}
              <h1 className="text-xl font-bold">{tone.title}</h1>
              <p className="text-sm text-slate-600">{tone.sub}</p>
              {proof.card_number && <p className="mt-1 font-mono text-xs tracking-wider text-slate-400">{proof.card_number}</p>}
            </div>

            {showDetails && (
              <>
                {warnings.length > 0 && (
                  <div role="alert" className="border-t border-amber-200 bg-amber-50 px-5 py-3 text-xs text-amber-900">
                    <p className="flex items-center gap-1.5 font-semibold"><AlertTriangle size={14} /> Check before you rely on this card</p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5">
                      {warnings.map((w) => <li key={w}>{w}</li>)}
                    </ul>
                  </div>
                )}

                {/* The rider's card, as they carry it */}
                {visual && (
                  <div className="border-t border-slate-100 p-5">
                    <RiderCardVisual data={visual} status={state === 'valid' ? 'active' : 'suspended'} flippable={false} />
                    <p className="mt-3 flex items-center justify-center gap-1 text-xs text-slate-500">
                      {proof.rating ? <><Star size={12} className="text-amber-500" /> {Number(proof.rating).toFixed(1)} ·</> : null}
                      {proof.completed_rides ?? 0} rides · since {fmtDate(proof.member_since)}
                    </p>
                  </div>
                )}

                {/* Where — this rider's own division and stage */}
                <Section icon={<MapPin size={12} />} title="Where this rider belongs">
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    <div>
                      <dt className="text-[11px] text-slate-400">Stage</dt>
                      <dd className="font-semibold text-slate-800">{withCode(proof.stage, proof.stage_code)}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-slate-400">Division</dt>
                      <dd className="font-semibold text-slate-800">{withCode(proof.division, proof.division_code)}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-slate-400">Parish</dt>
                      <dd className="text-slate-700">{proof.parish || '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-slate-400">Subcounty</dt>
                      <dd className="text-slate-700">{proof.subcounty || '—'}</dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-[11px] text-slate-400">District</dt>
                      <dd className="text-slate-700">{proof.district || '—'}</dd>
                    </div>
                  </dl>
                  <div className="space-y-0.5 pt-1">
                    <Contact label="Stage" name={proof.stage_contact_name} phone={proof.stage_contact_phone} />
                    <Contact label="Division" name={proof.division_contact_name} phone={proof.division_contact_phone} />
                  </div>
                  {notes.map((note) => <p key={note} className="text-xs italic text-slate-500">{note}</p>)}
                </Section>

                {/* Driving permit */}
                <Section icon={<FileCheck size={12} />} title="Driving permit">
                  <div className="flex flex-wrap items-center gap-2">
                    <PermitChip status={permit} />
                    {proof.license_masked && <span className="font-mono text-xs text-slate-500">No. {proof.license_masked}</span>}
                  </div>
                  <p className="text-sm text-slate-700">{permitDetail(permit, proof.license_expiry, proof.permit_days_left)}</p>
                </Section>

                {/* Insurance cover — read live, so a lapse shows the moment it happens */}
                {insurance && (
                  <Section icon={<Shield size={12} />} title="Insurance cover">
                    <div className="flex flex-wrap items-center gap-2">
                      <InsuranceChip insurance={insurance} />
                    </div>
                    {insurance.policies.length === 0 ? (
                      <p className="text-sm text-slate-700">No insurance cover on record for this rider.</p>
                    ) : (
                      <ul className="space-y-2.5">
                        {insurance.policies.map((p) => (
                          <li key={p.ref} className="flex items-start justify-between gap-3 text-sm">
                            <span className="min-w-0">
                              <span className="block font-semibold text-slate-800">{p.insurer}</span>
                              <span className="block text-slate-600">{p.plan} · {coverTypeLabel(p.cover_type)}</span>
                              <span className="block text-xs text-slate-500">
                                Valid until {fmtDate(p.valid_until)} · <span className="font-mono">{p.ref}</span>
                              </span>
                            </span>
                            <ToneChip tone={POLICY_STATE_META[p.state].tone}>{POLICY_STATE_META[p.state].label}</ToneChip>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Section>
                )}

                {/* Fees to the chairpersons */}
                {fees && (
                  <Section icon={<Wallet size={12} />} title="Fees to the chairpersons">
                    <div className="flex flex-wrap items-center gap-2">
                      <FeesChip status={fees.status} />
                    </div>
                    <dl className="space-y-2 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <dt className="text-slate-600">
                          ID card fee <span className="text-slate-400">({fees.card_fee_ican} ICAN)</span>
                        </dt>
                        <dd>
                          {fees.card_fee_status === 'paid'
                            ? <ToneChip tone="ok">Paid {fmtDate(fees.card_fee_paid_at)}</ToneChip>
                            : <ToneChip tone="warn">Pending</ToneChip>}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <dt className="text-slate-600">Ride commission</dt>
                        <dd>
                          {fees.commission_owed_ugx > 0
                            ? <ToneChip tone="warn">Pending {formatUgx(fees.commission_owed_ugx)}</ToneChip>
                            : <ToneChip tone="ok">Nothing owed</ToneChip>}
                        </dd>
                      </div>
                    </dl>
                  </Section>
                )}
              </>
            )}
          </div>
        )}

        <p className="px-4 text-center text-[11px] text-[#5c4410]/70">
          This page is checked live against the BodaGoEra record each time it is opened.
        </p>
      </div>
    </div>
  );
}
