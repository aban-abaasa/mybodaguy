// Maersk adapter. Maersk's Ocean Booking API follows DCSA Booking 2.0 (see dcsa.js), so
// the request is the standard one; this file only does Maersk's credentials and transport.
//
// Everything account- or environment-specific comes from environment variables and is
// never guessed here (the sandbox and production hosts, key and token details are on
// developer.maersk.com once you are registered):
//
//   MAERSK_BOOKING_URL    full URL of the Ocean Booking "create booking" endpoint
//                         (use the sandbox/mock URL while testing)
//   MAERSK_CONSUMER_KEY   your app's API key, sent as the Consumer-Key header
//   MAERSK_TOKEN_URL      OAuth2 token URL, only if the booking API needs a bearer token
//   MAERSK_CLIENT_ID / MAERSK_CLIENT_SECRET   OAuth2 client credentials, with MAERSK_TOKEN_URL
//
// A booking POST is NOT retried: if it times out we cannot know whether Maersk created
// it, so the caller marks it "unconfirmed" for a person to check rather than risk a
// second container.
import { CarrierRequestError, parseDcsaBookingResponse } from './dcsa.js';

const TIMEOUT_MS = 20000;

/** The outcome of a call is unknown (timeout / network) — the booking may or may not exist. */
export class CarrierUnconfirmedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CarrierUnconfirmedError';
  }
}

function config() {
  const url = process.env.MAERSK_BOOKING_URL;
  const key = process.env.MAERSK_CONSUMER_KEY;
  if (!url || !key) {
    throw new CarrierRequestError('Maersk is not configured: set MAERSK_BOOKING_URL and MAERSK_CONSUMER_KEY on the server.');
  }
  return { url, key, tokenUrl: process.env.MAERSK_TOKEN_URL, clientId: process.env.MAERSK_CLIENT_ID, clientSecret: process.env.MAERSK_CLIENT_SECRET };
}

async function bearerToken({ tokenUrl, clientId, clientSecret, key }) {
  if (!tokenUrl) return null;
  if (!clientId || !clientSecret) throw new CarrierRequestError('MAERSK_TOKEN_URL is set but MAERSK_CLIENT_ID / MAERSK_CLIENT_SECRET are not.');
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Consumer-Key': key },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    // Nothing has been booked yet, so this is safe to retry.
    throw new CarrierRequestError(`Maersk sign-in failed (${res.status}).`);
  }
  return data.access_token;
}

export const maerskCarrier = {
  id: 'maersk',
  label: 'Maersk',
  async createBooking(request) {
    const cfg = config();
    const token = await bearerToken(cfg);

    let res;
    try {
      res = await fetch(cfg.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Consumer-Key': cfg.key,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new CarrierUnconfirmedError(`Maersk did not answer (${err?.name === 'TimeoutError' ? 'timed out' : 'network error'}) — check their portal before booking again.`);
    }

    const body = await res.json().catch(() => ({}));
    if (res.status >= 500) {
      throw new CarrierUnconfirmedError(`Maersk answered with an error (${res.status}) — check their portal before booking again.`);
    }
    if (!res.ok) {
      // A clear refusal: nothing was booked, so it is safe to fix the request and try again.
      const detail = body?.errors?.[0]?.errorCodeText || body?.message || body?.error_description || '';
      throw new CarrierRequestError(`Maersk refused the booking (${res.status})${detail ? `: ${String(detail).slice(0, 200)}` : ''}.`);
    }

    const parsed = parseDcsaBookingResponse(body);
    if (!parsed.reference) throw new CarrierUnconfirmedError('Maersk accepted the request but returned no booking reference — check their portal.');
    return { ...parsed, raw: body };
  },
};
