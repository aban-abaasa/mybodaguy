/**
 * Journeys a customer chose to keep on his phone before they were cleared from
 * our servers. Nothing here touches Supabase — it is a plain copy in this
 * device's own storage (plus a downloadable summary file), so it keeps showing
 * in My Journeys after the server record is gone. Clearing the browser's site
 * data removes it, which is why the summary is also offered as a file.
 */
import type { Journey } from './journeyService';

export interface SavedJourneyLeg {
  label: string;
  status: string;
  pnr?: string;
  driver?: string;
  vehicle?: string;
}

export interface SavedJourney {
  id: string;
  savedAt: string;
  status: string;
  destination: string;
  bookedAt?: string;
  finishedAt?: string;
  passengers?: number;
  fareIcan?: number;
  fareUgx?: number;
  legs: SavedJourneyLeg[];
}

const storageKey = (userId: string) => `mbg_saved_journeys_${userId}`;

export function loadSavedJourneys(userId: string): SavedJourney[] {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeSaved(userId: string, list: SavedJourney[]) {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(list));
  } catch {
    // Storage full or blocked — the summary file the customer also gets is the fallback.
  }
}

export function snapshotJourney(journey: Journey, legLabel: (legType: string) => string): SavedJourney {
  return {
    id: journey.id,
    savedAt: new Date().toISOString(),
    status: journey.status,
    destination: [journey.destination_city, journey.destination_country].filter(Boolean).join(', '),
    bookedAt: journey.created_at,
    finishedAt: journey.updated_at,
    passengers: journey.passenger_count,
    fareIcan: journey.total_fare_ican != null ? Number(journey.total_fare_ican) : undefined,
    fareUgx: journey.total_fare_ugx != null ? Number(journey.total_fare_ugx) : undefined,
    legs: [...journey.legs]
      .sort((a, b) => a.leg_order - b.leg_order)
      .map((leg) => ({
        label: legLabel(leg.leg_type),
        status: leg.status,
        pnr: leg.flight_booking?.pnr || undefined,
        driver: leg.ride?.rider?.user?.profile?.full_name || undefined,
        vehicle: leg.ride?.rider
          ? [leg.ride.rider.vehicle_type, leg.ride.rider.vehicle_color, leg.ride.rider.vehicle_model, leg.ride.rider.plate_number].filter(Boolean).join(' · ')
          : undefined,
      })),
  };
}

export function saveJourneysLocally(userId: string, snapshots: SavedJourney[]) {
  const incoming = new Set(snapshots.map((s) => s.id));
  writeSaved(userId, [...snapshots, ...loadSavedJourneys(userId).filter((s) => !incoming.has(s.id))]);
}

export function removeSavedJourney(userId: string, journeyId: string) {
  writeSaved(userId, loadSavedJourneys(userId).filter((s) => s.id !== journeyId));
}

const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');

export function savedJourneySummaryText(saved: SavedJourney): string {
  const lines = [
    'BodaGoEra journey summary',
    `To: ${saved.destination || '—'}`,
    `Status: ${saved.status.replace(/_/g, ' ')}`,
    saved.bookedAt ? `Booked: ${fmtDate(saved.bookedAt)}` : '',
    saved.finishedAt ? `Finished: ${fmtDate(saved.finishedAt)}` : '',
    saved.passengers ? `Travellers: ${saved.passengers}` : '',
    saved.fareIcan != null ? `Paid: ${saved.fareIcan} ICAN` : '',
    `Reference: ${saved.id}`,
    '',
    ...saved.legs.map((l) => [`• ${l.label} — ${l.status.replace(/_/g, ' ')}`, l.pnr && `   Booking reference (PNR): ${l.pnr}`, l.driver && `   Driver: ${l.driver}`, l.vehicle && `   Vehicle: ${l.vehicle}`].filter(Boolean).join('\n')),
  ];
  return lines.join('\n');
}

/** Saves the summaries as ONE text file on the phone (goes to Downloads) — browsers block several downloads at once. */
export function downloadJourneySummaries(list: SavedJourney[]) {
  if (list.length === 0) return;
  const blob = new Blob([list.map(savedJourneySummaryText).join('\n\n----------------------------------------\n\n')], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = list.length === 1
    ? `Journey-${(list[0].destination || 'trip').replace(/[^A-Za-z0-9]+/g, '-')}-${list[0].id.slice(0, 8)}.txt`
    : `My-journeys-${new Date().toISOString().slice(0, 10)}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
