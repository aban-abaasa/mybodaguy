// Checks run BEFORE the customer's wallet is debited, so a booking the airline
// is certain to reject never takes any money in the first place; and a plain-
// language reason for the ones that still fail afterwards.

const E164 = /^\+[1-9]\d{6,14}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const TITLE_GENDER = { mr: 'm', mrs: 'f', ms: 'f', miss: 'f' }; // 'dr' fits either

/** Returns a customer-facing message for the first problem found, or null when the passengers are fine. */
export function validatePassengers(passengers, expectedCount = 1) {
  if (!Array.isArray(passengers) || passengers.length !== expectedCount) return 'Please enter the passenger details.';
  for (const p of passengers) {
    if (!p?.id) return 'This flight offer has expired — please search flights again.';
    if (!String(p.given_name || '').trim() || !String(p.family_name || '').trim()) return "Please enter the passenger's full name exactly as on their passport.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.born_on || '') || Number.isNaN(Date.parse(p.born_on)) || Date.parse(p.born_on) > Date.now()) {
      return "Please enter the passenger's date of birth.";
    }
    if (!['m', 'f'].includes(p.gender)) return "Please choose the passenger's gender.";
    const expectedGender = TITLE_GENDER[p.title];
    if (expectedGender && expectedGender !== p.gender) return `The title "${String(p.title).toUpperCase()}" doesn't match the gender selected — please correct one of them.`;
    if (!E164.test(String(p.phone_number || ''))) return 'Enter the phone number with its country code, e.g. +256 7XX XXX XXX.';
    if (!EMAIL.test(String(p.email || ''))) return 'Your account has no valid email address — the airline needs one to issue the ticket. Add an email to your profile and try again.';
  }
  return null;
}

/**
 * Turns a Duffel error into what the customer should be told, and whether
 * retrying with the same details could ever work. Never exposes raw provider
 * text except validation messages, which only describe the customer's own input.
 */
export function describeDuffelFailure(err) {
  const first = err?.duffelResponse?.errors?.[0] || {};
  const code = first.code || err?.duffelCode || null;
  const type = first.type || null;

  // Codes below were confirmed against Duffel's test API (offer_no_longer_available, offer_request_already_booked,
  // payment_amount_does_not_match_order_amount, invalid_phone_number, validation_required).
  if (['offer_no_longer_available', 'offer_expired', 'price_changed', 'offer_request_expired', 'offer_request_already_booked', 'payment_amount_does_not_match_order_amount'].includes(code)) {
    return { code, message: 'That flight is no longer available at this price. Please search flights again.' };
  }
  if (type === 'validation_error' || code === 'validation_error') {
    const detail = String(first.message || '').slice(0, 160);
    return { code: code || type, message: `The airline rejected the passenger details${detail ? ` (${detail})` : ''}. Please check them and try again.` };
  }
  if (code === 'insufficient_balance' || err?.status === 401 || err?.status === 403) {
    // Operational (platform's airline balance / credentials) — not the customer's to fix.
    return { code: code || `http_${err.status}`, message: 'Ticket booking is temporarily unavailable. Please try again later.', operational: true };
  }
  return { code: code || (err?.status ? `http_${err.status}` : 'unknown'), message: "We couldn't book that flight with the airline. Please try again or pick another flight." };
}

/** Raw airline error text for the screen — only ever used when Duffel is on a test token. */
export function testModeDetail(err) {
  const first = err?.duffelResponse?.errors?.[0] || {};
  const parts = [first.code || err?.duffelCode, first.message || err?.message].filter(Boolean);
  return parts.length ? ` [Test mode: ${parts.join(' — ').slice(0, 300)}]` : '';
}
