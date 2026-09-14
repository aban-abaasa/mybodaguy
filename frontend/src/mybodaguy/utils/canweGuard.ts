// Must match the field names rendered by components/security/CanweFields.tsx.
const TRAP_FIELDS = ['admin_pass', 'root_token', 'backup_key', 'website'];

// Same production origin journeyService.ts already hardcodes for this
// project's Vercel functions (frontend/api/**).
const MBG_API_BASE_URL = 'https://bodagoera.icanera.space';

/**
 * Call this first inside any onSubmit that also renders <CanweFields />,
 * before doing any real auth/network work. Reads the trap fields straight
 * off the DOM form element (they aren't wired into React state) so a
 * scripted client that fills every <input> it finds still gets caught even
 * though our own JS never touches those values in the happy path.
 *
 * Returns true if a trap field was filled (caller should stop and show a
 * normal-looking generic error) or false to proceed as usual.
 */
export function checkCanweFields(formEl: HTMLFormElement | null, formContext: string = 'unknown-form'): boolean {
  if (!formEl) return false;

  const data = new FormData(formEl);
  const trippedField = TRAP_FIELDS.find((name) => {
    const value = data.get(name);
    return value !== null && String(value).trim() !== '';
  });

  if (!trippedField) return false;

  fetch(`${MBG_API_BASE_URL}/api/security/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ [trippedField]: data.get(trippedField), formContext }),
    keepalive: true,
  }).catch(() => {
    // Never let a reporting failure surface to the user.
  });

  return true;
}

export default checkCanweFields;
