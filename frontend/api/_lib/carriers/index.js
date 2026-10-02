import { maerskCarrier } from './maersk.js';
import { mockCarrier } from './mock.js';

const CARRIERS = { maersk: maerskCarrier, mock: mockCarrier };

/**
 * The carrier bookings go to, chosen by the CARRIER_PROVIDER environment variable.
 * Unset means 'mock', so nothing is ever booked with a real shipping line by accident.
 */
export function getCarrier() {
  const id = String(process.env.CARRIER_PROVIDER || 'mock').toLowerCase();
  const carrier = CARRIERS[id];
  if (!carrier) throw new Error(`Unknown CARRIER_PROVIDER "${id}" — use one of: ${Object.keys(CARRIERS).join(', ')}.`);
  return carrier;
}
