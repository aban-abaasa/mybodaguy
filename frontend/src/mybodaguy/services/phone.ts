// The airline needs the passenger's phone number in international format
// (+<country code><number>). Customers type it the way they dial locally, so
// a leading 0 is turned into their country's code when we know it; anything
// else has to be given with its "+" code.

const DIAL_CODES: Record<string, string> = {
  UG: '256', KE: '254', TZ: '255', RW: '250', BI: '257', SS: '211', CD: '243', ET: '251', SO: '252',
  ZA: '27', NG: '234', GH: '233', ZM: '260', ZW: '263', MW: '265', MZ: '258', GB: '44', US: '1', CA: '1',
  AE: '971', IN: '91', CN: '86',
};

/** E.164 (+ then 7–15 digits), or null when it can't be worked out. */
export function toInternationalPhone(raw: string, countryIso2?: string): string | null {
  const cleaned = raw.trim().replace(/[\s\-().]/g, '');
  if (!cleaned) return null;

  let candidate: string | null = null;
  if (cleaned.startsWith('+')) candidate = cleaned;
  else if (cleaned.startsWith('00')) candidate = `+${cleaned.slice(2)}`;
  else if (cleaned.startsWith('0') && countryIso2 && DIAL_CODES[countryIso2.toUpperCase()]) {
    candidate = `+${DIAL_CODES[countryIso2.toUpperCase()]}${cleaned.slice(1)}`;
  }
  return candidate && /^\+[1-9]\d{6,14}$/.test(candidate) ? candidate : null;
}

/** Gender a title implies, or null when it fits either ("dr"). */
export function genderForTitle(title: string): 'm' | 'f' | null {
  if (title === 'mr') return 'm';
  if (['mrs', 'ms', 'miss'].includes(title)) return 'f';
  return null;
}
