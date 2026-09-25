import { useEffect, useState } from 'react';
import { Car, Phone, Star, Ship, Plane, AlertTriangle, ChevronDown, Trash2, Smartphone, Download, Loader2, MapPin } from 'lucide-react';
import { getMyJourneys, getAirTicket, deleteMyJourneys, type Journey, type JourneyLeg } from '../services/journeyService';
import { downloadAirTicketPdf } from '../services/airTicketPdf';
import {
  loadSavedJourneys, saveJourneysLocally, removeSavedJourney, snapshotJourney, downloadJourneySummaries,
  type SavedJourney,
} from '../services/journeyArchive';
import { legLabel } from './JourneyBookingFlow';
import AirTicketButton from './AirTicketButton';
import JourneyLegRideActions from './JourneyLegRideActions';

// A finished journey is offered for clearing from our servers once it has been
// over for this long — always by asking first (see the "clear" banner below).
const CLEAR_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const labelOf = (legType: string) => legLabel[legType] || legType;

// A customer's past-booking view of getMyJourneys — it already existed
// (real query, nested legs + rider info) but was never wired into any
// screen; a customer could only ever see journey status right after
// booking, inside JourneyBookingFlow's own local 'tracking' step.
export default function JourneyTracker({ customerId, onOpen, compact = false }: {
  customerId: string;
  /** When given, each journey gets an "Open & track" button that hands its id here (the live journey screen lives on the Book a Ride tab). */
  onOpen?: (journeyId: string) => void;
  /** Start every journey collapsed — for placing the list above another form. */
  compact?: boolean;
}) {
  const [journeys, setJourneys] = useState<Journey[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  // Only what the customer toggled by hand; anything else uses the default in isOpen.
  const [openOverride, setOpenOverride] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<SavedJourney[]>(() => loadSavedJourneys(customerId));
  // The journey the remove dialog is asking about (set by a journey's Remove button).
  const [confirming, setConfirming] = useState<Journey | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [clearPromptDismissed, setClearPromptDismissed] = useState(false);
  // Compact mode only: the whole My Journeys card is one collapsed line until tapped.
  const [sectionOpen, setSectionOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const rows = await getMyJourneys(customerId);
        if (!cancelled) {
          setJourneys(rows);
          setLoadError(false);
        }
      } catch (err) {
        // Say so instead of rendering nothing — a booking that exists but
        // cannot be read must not look like a booking that was never made.
        console.error('JourneyTracker load error:', err);
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const interval = setInterval(load, 10000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [customerId]);

  // A booked flight stays listed after the trip so its air ticket can still be
  // downloaded, and a failed booking stays listed when money was taken for it
  // (ican_journey_tx_id is only set once the wallet was actually debited) so the
  // customer is told to ask support for a refund instead of it silently vanishing.
  const hasTicket = (j: Journey) => j.legs.some((l) => l.leg_type === 'flight' && l.flight_booking);
  // Auto-refunded bookings (refunded_at set) need no action, so they drop off the list.
  const paidButFailed = (j: Journey) => j.status === 'failed' && !!j.ican_journey_tx_id && !j.refunded_at;
  const activeJourneys = journeys.filter((j) => {
    if (paidButFailed(j)) return true;
    if (j.status === 'cancelled' || j.status === 'failed') return false;
    return j.status !== 'completed' || hasTicket(j);
  });

  // Over and done with — the ones the customer may remove. A paid-but-failed
  // booking is not: its reference is still needed to ask support for the refund.
  const isFinished = (j: Journey) => ['completed', 'cancelled', 'failed'].includes(j.status) && !paidButFailed(j);
  // Includes finished journeys that are no longer listed (e.g. a completed ride
  // with no ticket) — they are still rows on the server.
  const dueForClearing = journeys.filter((j) => isFinished(j) && !!j.updated_at && Date.now() - new Date(j.updated_at).getTime() > CLEAR_AFTER_MS);
  const isOpen = (j: Journey) => openOverride[j.id] ?? (!compact && !isFinished(j));
  const toggle = (j: Journey) => setOpenOverride((prev) => ({ ...prev, [j.id]: !isOpen(j) }));

  /**
   * Removes journeys from the server, first saving a copy on the phone if
   * asked: the air ticket PDF, one summary file, and an in-app copy that keeps
   * showing under "Saved on this phone". Nothing is deleted unless saving worked.
   */
  const removeJourneys = async (list: Journey[], saveFirst: boolean) => {
    if (list.length === 0) return;
    setBusy(true);
    setNotice(null);
    let snapshots: SavedJourney[] = [];
    try {
      if (saveFirst) {
        for (const j of list) {
          if (hasTicket(j)) await downloadAirTicketPdf(await getAirTicket(j.id));
        }
        snapshots = list.map((j) => snapshotJourney(j, labelOf));
        downloadJourneySummaries(snapshots);
        saveJourneysLocally(customerId, snapshots);
        setSaved(loadSavedJourneys(customerId));
      }
      const { deletedIds, skipped } = await deleteMyJourneys(list.map((j) => j.id));
      // A copy was saved for a journey the server kept — drop it so it isn't listed twice.
      skipped.forEach((s) => removeSavedJourney(customerId, s.id));
      if (skipped.length > 0) setSaved(loadSavedJourneys(customerId));
      setJourneys((prev) => prev.filter((j) => !deletedIds.includes(j.id)));
      setConfirming(null);
      setNotice(
        skipped.length > 0
          ? { kind: 'error', text: `${deletedIds.length} removed. ${skipped[0].reason}` }
          : { kind: 'ok', text: saveFirst ? 'Saved on your phone and removed from our servers.' : 'Removed.' },
      );
    } catch (err: any) {
      // Nothing was deleted (saving comes first, deleting last), but a summary
      // may already sit in the in-app copy — take it back out so it isn't listed twice.
      snapshots.forEach((s) => removeSavedJourney(customerId, s.id));
      setSaved(loadSavedJourneys(customerId));
      setNotice({ kind: 'error', text: `${err?.message || 'Something went wrong.'} Nothing was removed.` });
    } finally {
      setBusy(false);
    }
  };

  if (loading) return null;
  if (loadError && journeys.length === 0) {
    return (
      <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        We couldn't load your journeys right now. Your bookings are safe — please refresh in a moment.
      </div>
    );
  }
  const serverIds = new Set(journeys.map((j) => j.id));
  // The clear-out banner and the phone copies belong on the Orders tab, not above a booking form.
  const savedOnly = compact ? [] : saved.filter((s) => !serverIds.has(s.id));
  const showClearPrompt = !compact && dueForClearing.length > 0 && !clearPromptDismissed;
  if (activeJourneys.length === 0 && savedOnly.length === 0 && !showClearPrompt && !notice) return null;

  const inProgress = activeJourneys.filter((j) => !isFinished(j));
  const placeOf = (j: Journey) => j.destination_city || j.destination_country;
  const compactSummary =
    activeJourneys.some(paidButFailed)
      ? '⚠ A booking needs your attention — tap to view'
      : inProgress.length === 1
      ? `To ${placeOf(inProgress[0])} · ${inProgress[0].status.replace(/_/g, ' ')}`
      : inProgress.length > 1
        ? `${inProgress.length} journeys in progress`
        : `${activeJourneys.length} booked · tap to view`;

  return (
    <div className="space-y-4">
      {compact ? (
        // One collapsed line above the booking form: what is going on, at a glance.
        <button
          type="button"
          onClick={() => setSectionOpen((v) => !v)}
          aria-expanded={sectionOpen}
          className="classic-card flex w-full items-center gap-3 p-3.5 text-left transition-all active:scale-[0.99] hover:border-orange-300"
        >
          <span className="grid h-11 w-11 flex-shrink-0 place-items-center rounded-2xl bg-orange-50 text-orange-600 ring-1 ring-inset ring-black/5">
            <MapPin size={20} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold leading-tight text-slate-800">My Journeys</span>
            <span className="mt-0.5 block truncate text-xs text-slate-500">{compactSummary}</span>
          </span>
          {inProgress.length > 0 && (
            <span className="flex-shrink-0 rounded-full bg-orange-500 px-2 py-0.5 text-[11px] font-bold text-white">{inProgress.length}</span>
          )}
          <ChevronDown size={18} className={`flex-shrink-0 text-slate-400 transition-transform ${sectionOpen ? 'rotate-180' : ''}`} />
        </button>
      ) : (
        <h3 className="text-lg font-bold text-slate-800">My Journeys</h3>
      )}

      {/* hidden (not unmounted) while collapsed, so the list keeps refreshing and the count stays right */}
      <div className={compact && !sectionOpen ? 'hidden' : 'space-y-4'}>

      {notice && (
        <div role={notice.kind === 'error' ? 'alert' : 'status'} className={`rounded-lg border p-3 text-sm ${notice.kind === 'error' ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
          {notice.text}
        </div>
      )}

      {showClearPrompt && (
        <div className="rounded-xl border border-orange-200 bg-orange-50 p-4 space-y-3 text-sm text-slate-700">
          <p className="font-semibold text-slate-800">
            {dueForClearing.length === 1 ? '1 journey finished' : `${dueForClearing.length} journeys finished`} over a week ago.
          </p>
          <p>
            To keep your account tidy we clear old journeys from our servers. Would you like to save a copy on your phone first?
            {dueForClearing.some(hasTicket) && ' Your air ticket is saved as a PDF; its QR code can no longer be checked online once the journey is cleared.'}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => removeJourneys(dueForClearing, true)} className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-orange-500 px-4 font-semibold text-white hover:bg-orange-600 disabled:opacity-60">
              {busy ? <Loader2 className="animate-spin" size={15} /> : <Smartphone size={15} />} Save to phone &amp; clear
            </button>
            <button type="button" disabled={busy} onClick={() => removeJourneys(dueForClearing, false)} className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-4 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
              Clear without saving
            </button>
            <button type="button" disabled={busy} onClick={() => setClearPromptDismissed(true)} className="min-h-[40px] rounded-lg px-3 text-slate-500 hover:text-slate-700 disabled:opacity-60">
              Not now
            </button>
          </div>
        </div>
      )}

      {activeJourneys.map((journey) => {
        const open = isOpen(journey);
        return (
          <div key={journey.id} className="bg-white rounded-xl shadow-sm border border-slate-100 p-4 space-y-3">
            <button
              type="button"
              onClick={() => toggle(journey)}
              aria-expanded={open}
              className="flex w-full items-center justify-between gap-3 text-left"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                  {journey.legs.some((l) => l.leg_type === 'sea_leg') ? <Ship size={16} className="shrink-0 text-orange-500" /> : <Plane size={16} className="shrink-0 text-orange-500" />}
                  <span className="truncate">To {journey.destination_city || journey.destination_country}</span>
                </div>
                {journey.created_at && <div className="mt-0.5 text-xs text-slate-400">Booked {fmtDate(journey.created_at)}</div>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-xs font-semibold uppercase text-orange-600">{journey.status.replace(/_/g, ' ')}</span>
                <ChevronDown size={18} className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
              </div>
            </button>
            {paidButFailed(journey) && (
              <div role="alert" className="flex items-start gap-2.5 rounded-lg border-2 border-amber-400 bg-amber-50 p-3 text-sm text-amber-900">
                <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600" />
                <div className="space-y-1">
                  <p className="font-bold">Your payment was taken but this booking did not complete — no ticket was issued.</p>
                  <p>Please contact the support team to be refunded. Quote this reference: <span className="select-all font-mono font-semibold">{journey.id}</span></p>
                </div>
              </div>
            )}
            <div className="flex flex-wrap items-start gap-2">
              {onOpen && !paidButFailed(journey) && (
                <button
                  type="button"
                  onClick={() => onOpen(journey.id)}
                  className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-orange-300 bg-orange-50 px-4 text-sm font-semibold text-orange-700 hover:bg-orange-100"
                >
                  <MapPin size={15} /> {isFinished(journey) ? 'View journey' : 'Open & track'}
                </button>
              )}
              {hasTicket(journey) && (
                <AirTicketButton
                  journeyId={journey.id}
                  className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-orange-500 px-4 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-60"
                />
              )}
            </div>
            {open && (
              <>
                <div className="space-y-2">
                  {[...journey.legs].sort((a, b) => a.leg_order - b.leg_order).map((leg) => (
                    <JourneyLegRow key={leg.id} leg={leg} customerId={customerId} />
                  ))}
                </div>
                {isFinished(journey) && (
                  <button
                    type="button"
                    onClick={() => setConfirming(journey)}
                    className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-red-200 px-4 text-sm font-semibold text-red-600 hover:bg-red-50"
                  >
                    <Trash2 size={15} /> Remove this journey
                  </button>
                )}
              </>
            )}
          </div>
        );
      })}

      {savedOnly.length > 0 && (
        <div className="space-y-3">
          <h4 className="flex items-center gap-2 text-sm font-bold text-slate-600"><Smartphone size={15} /> Saved on this phone</h4>
          {savedOnly.map((s) => (
            <SavedJourneyCard
              key={s.id}
              saved={s}
              onRemove={() => { removeSavedJourney(customerId, s.id); setSaved(loadSavedJourneys(customerId)); }}
            />
          ))}
        </div>
      )}

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="remove-journey-title">
          <div className="w-full max-w-md space-y-4 rounded-2xl bg-white p-5 shadow-xl">
            <h4 id="remove-journey-title" className="text-lg font-bold text-slate-800">Remove this journey?</h4>
            <p className="text-sm text-slate-600">
              It will be cleared from our servers. Would you like to save a copy on your phone first? We'll download {hasTicket(confirming) ? 'your air ticket and ' : ''}a summary, and keep it here under "Saved on this phone".
            </p>
            {hasTicket(confirming) && (
              <p className="text-xs text-slate-500">Once removed, the QR code on the ticket can no longer be checked online.</p>
            )}
            <div className="flex flex-col gap-2">
              <button type="button" disabled={busy} onClick={() => removeJourneys([confirming], true)} className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-orange-500 px-4 font-semibold text-white hover:bg-orange-600 disabled:opacity-60">
                {busy ? <Loader2 className="animate-spin" size={16} /> : <Smartphone size={16} />} Save to my phone &amp; remove
              </button>
              <button type="button" disabled={busy} onClick={() => removeJourneys([confirming], false)} className="min-h-[44px] rounded-lg border border-red-200 px-4 font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60">
                Remove without saving
              </button>
              <button type="button" disabled={busy} onClick={() => setConfirming(null)} className="min-h-[44px] rounded-lg px-4 font-semibold text-slate-500 hover:text-slate-700 disabled:opacity-60">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

function SavedJourneyCard({ saved, onRemove }: { saved: SavedJourney; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center justify-between gap-3 text-left">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-700">To {saved.destination || 'your destination'}</div>
          <div className="mt-0.5 text-xs text-slate-400">{saved.bookedAt ? `Booked ${fmtDate(saved.bookedAt)} · ` : ''}Saved {fmtDate(saved.savedAt)}</div>
        </div>
        <ChevronDown size={18} className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <>
          <ul className="space-y-1.5 text-sm text-slate-600">
            {saved.legs.map((l, i) => (
              <li key={i}>
                <span className="font-medium text-slate-700">{l.label}</span> — {l.status.replace(/_/g, ' ')}
                {l.pnr && <span className="block text-xs text-slate-500">PNR: {l.pnr}</span>}
                {l.driver && <span className="block text-xs text-slate-500">{l.driver}{l.vehicle ? ` · ${l.vehicle}` : ''}</span>}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => downloadJourneySummaries([saved])} className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              <Download size={15} /> Download summary
            </button>
            <button type="button" onClick={onRemove} className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-red-200 px-4 text-sm font-semibold text-red-600 hover:bg-red-50">
              <Trash2 size={15} /> Remove from this phone
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function JourneyLegRow({ leg, customerId }: { leg: JourneyLeg; customerId: string }) {
  const rider = leg.ride?.rider;
  // A flight or sea crossing underway has no live position to show — no
  // phone signal mid-ocean/mid-flight, and a flight leg isn't fulfilled by
  // one of our own riders anyway. Fixed price was already charged upfront;
  // tracking resumes on its own once the next (on-land) leg starts, which
  // is exactly when this same view starts showing that leg's live rider.
  const isInTransitCrossing = (leg.leg_type === 'flight' || leg.leg_type === 'sea_leg') && (leg.status === 'dispatched' || leg.status === 'in_progress');

  return (
    <div className="border rounded-lg p-3 space-y-2">
      <div className="flex justify-between items-center">
        <div>
          <div className="font-medium text-sm text-slate-800">{legLabel[leg.leg_type] || leg.leg_type}</div>
          {leg.flight_booking?.pnr && <div className="text-xs text-slate-500">PNR: {leg.flight_booking.pnr}</div>}
        </div>
        <span className="text-xs font-semibold uppercase text-slate-500">{leg.status.replace(/_/g, ' ')}</span>
      </div>

      {isInTransitCrossing && (
        <div className="bg-violet-50 border border-violet-200 rounded-lg p-3 text-sm text-violet-700">
          {leg.leg_type === 'sea_leg' ? '⛴️ At sea' : '✈️ In the air'} — fixed price already charged, tracking resumes on arrival.
        </div>
      )}

      {!isInTransitCrossing && rider && (
        <div className="bg-orange-50 rounded-lg p-3 flex items-center justify-between text-sm">
          <div>
            <div className="font-semibold text-slate-800">{rider.user?.profile?.full_name || 'Your driver'}</div>
            <div className="text-slate-500 flex items-center gap-1">
              <Car size={14} /> {rider.vehicle_type} · {rider.vehicle_color || ''} {rider.vehicle_model || ''} · {rider.plate_number}
            </div>
            {rider.location_updated_at && (
              <div className="text-xs text-slate-400 mt-1">Last seen {new Date(rider.location_updated_at).toLocaleTimeString()}</div>
            )}
          </div>
          <div className="text-right space-y-1">
            <div className="flex items-center gap-1 text-amber-600 font-semibold">
              <Star size={14} fill="currentColor" /> {Number(rider.rating || 0).toFixed(1)}
            </div>
            {rider.user?.phone && (
              <a href={`tel:${rider.user.phone}`} className="flex items-center gap-1 text-orange-600">
                <Phone size={14} /> Call
              </a>
            )}
          </div>
        </div>
      )}

      <JourneyLegRideActions leg={leg} customerId={customerId} />
    </div>
  );
}
