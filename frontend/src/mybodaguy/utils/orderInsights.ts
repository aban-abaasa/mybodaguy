/**
 * Shared "live insights" helpers for the Customer/Rider Overview greetings —
 * traffic (order count), peak activity hour, and top pickup location,
 * derived from a list of mbg_rides rows already loaded on the client.
 */

// "18" -> "6–7 PM"
export function formatHourRange(hour: number): string {
  const format = (h: number) => {
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12} ${period}`;
  };
  return `${format(hour)}–${format((hour + 1) % 24)}`;
}

export interface OrderInsights {
  peakHourLabel: string | null;
  topLocation: string | null;
}

// Geocoded pickup locations come back as a full address ("Makerere
// University, Junju Road, Makerere Kivulu, Wandegeya, Central, Kampala,
// Central Region, Uganda") — nobody wants to read that in a stat strip, so
// keep only the specific place name at the front of it.
export function shortenLocation(location: string): string {
  return location.split(',')[0].trim();
}

export function computeOrderInsights(rides: Array<{ created_at: string; pickup_location?: string | null }>): OrderInsights | null {
  if (rides.length === 0) return null;
  const hourCounts: Record<number, number> = {};
  const locationCounts: Record<string, number> = {};
  rides.forEach(r => {
    const hour = new Date(r.created_at).getHours();
    hourCounts[hour] = (hourCounts[hour] || 0) + 1;
    if (r.pickup_location) locationCounts[r.pickup_location] = (locationCounts[r.pickup_location] || 0) + 1;
  });
  const topHour = Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0];
  const topLocation = Object.entries(locationCounts).sort((a, b) => b[1] - a[1])[0];
  return {
    peakHourLabel: topHour ? formatHourRange(Number(topHour[0])) : null,
    topLocation: topLocation ? topLocation[0] : null,
  };
}
