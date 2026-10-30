/**
 * The "Deliver within" step of a store delivery, kept free of React and Supabase so it
 * can be unit-tested (tests/deliveryWindow.test.js).
 *
 * The window is how long the customer will wait before the rider is warned and, after a
 * grace period, the customer can claim a refund (mbg_request_ride; bounds come from the
 * platform's delivery.min_deadline_hours / delivery.max_deadline_hours settings).
 */

export interface WindowPreset {
  hours: number;
  label: string;
  /** One short line on who it suits. */
  hint: string;
}

export const WINDOW_PRESETS: readonly WindowPreset[] = [
  { hours: 1, label: 'Express', hint: 'Rider heads straight over' },
  { hours: 3, label: 'Standard', hint: 'Right for a normal errand' },
  { hours: 6, label: 'Later today', hint: 'No rush' },
  { hours: 24, label: 'Next day', hint: 'Tomorrow is fine' },
  { hours: 48, label: 'Flexible', hint: 'Whenever suits the rider' },
];

export const DEFAULT_WINDOW_HOURS = 3;

export interface WindowBounds { min: number; max: number }

/** Presets the server will accept. */
export function presetsWithin(bounds: WindowBounds): WindowPreset[] {
  return WINDOW_PRESETS.filter(p => p.hours >= bounds.min && p.hours <= bounds.max);
}

/** A whole number of hours inside the bounds (a typed "0", "-2" or "9999" never reaches the server). */
export function clampHours(hours: number, bounds: WindowBounds): number {
  if (!Number.isFinite(hours)) return Math.min(Math.max(DEFAULT_WINDOW_HOURS, bounds.min), bounds.max);
  return Math.min(Math.max(Math.round(hours), bounds.min), bounds.max);
}

/** "3 hrs" / "1 hr" / "2 days" for whole days. */
export function formatWindow(hours: number): string {
  if (hours >= 24 && hours % 24 === 0) {
    const days = hours / 24;
    return days === 1 ? '1 day' : `${days} days`;
  }
  return hours === 1 ? '1 hr' : `${hours} hrs`;
}

/**
 * When the rider must have delivered by, in the customer's words: "3:45 PM" today,
 * "Tomorrow 3:45 PM", or "Sat 3:45 PM" further out.
 */
export function deadlineLabel(now: Date, hours: number, locale?: string): string {
  const due = new Date(now.getTime() + hours * 3600_000);
  const time = due.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(due) - startOfDay(now)) / 86_400_000);
  if (days <= 0) return time;
  if (days === 1) return `Tomorrow ${time}`;
  return `${due.toLocaleDateString(locale, { weekday: 'short' })} ${time}`;
}

/**
 * Whether a window is tight for the trip: the ride itself plus time to shop and hand over
 * (about 20 minutes) would use most of it. Only a hint; nothing is blocked.
 */
export function isTightWindow(routeMinutes: number | null | undefined, hours: number): boolean {
  if (routeMinutes == null || !Number.isFinite(routeMinutes)) return false;
  return routeMinutes + 20 > hours * 60 * 0.75;
}
