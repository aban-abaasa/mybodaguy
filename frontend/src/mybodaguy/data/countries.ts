// Shared country list — display-name strings here match exactly what's
// already stored in SQL (mbg_user_profiles.country, mbg_riders.operator_country,
// mbg_journeys.origin_country, etc all store the English name, e.g. 'Uganda').
// iso2 is only ever used at the frontend/Nominatim/Duffel boundary for
// matching a geocoded country_code back to one of these entries.
export interface CountryOption {
  name: string;
  iso2: string;
}

export const COUNTRIES: CountryOption[] = [
  { name: 'Uganda', iso2: 'UG' },
  { name: 'Kenya', iso2: 'KE' },
  { name: 'Tanzania', iso2: 'TZ' },
  { name: 'Rwanda', iso2: 'RW' },
  { name: 'South Sudan', iso2: 'SS' },
  { name: 'DR Congo', iso2: 'CD' },
  { name: 'Nigeria', iso2: 'NG' },
  { name: 'Ghana', iso2: 'GH' },
  { name: 'South Africa', iso2: 'ZA' },
  { name: 'United States', iso2: 'US' },
  { name: 'United Kingdom', iso2: 'GB' },
  { name: 'Canada', iso2: 'CA' },
  { name: 'United Arab Emirates', iso2: 'AE' },
  { name: 'Other', iso2: '' },
];

// Drop-in replacement for the plain string list SignInPage.tsx used to keep locally.
export const COUNTRY_NAMES: string[] = COUNTRIES.map((c) => c.name);

export function countryByIso2(iso2: string): CountryOption | null {
  const upper = iso2.toUpperCase();
  return COUNTRIES.find((c) => c.iso2 === upper) || null;
}
