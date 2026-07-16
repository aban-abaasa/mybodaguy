/**
 * 🔒 Transaction PIN Service — My Boda Guy
 * Lets a user set or change their transaction PIN from any app — the
 * account itself (public.user_accounts) is auto-created on signup for
 * every app since they all share one Supabase auth. Uses the exact same
 * hashPIN() algorithm as ICAN app's walletAccountService.js so a PIN set
 * here verifies correctly everywhere, including the ICAN dev panel's
 * recovery tools.
 *
 * Forgotten-PIN recovery is intentionally NOT here — that only exists in
 * the ICAN app's dev panel (no self-service reset path, by design).
 */

import { supabase } from '../../services/supabaseClient';

export interface PinResult {
  success: boolean;
  error?: string;
  message?: string;
}

// Must match ICAN/frontend/src/services/walletAccountService.js exactly.
export const hashPIN = (pin: string): string => {
  let hash = 0;
  const string = `pin-${pin}-salt-ican-hash`;
  for (let i = 0; i < string.length; i++) {
    const char = string.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return btoa(`hash-${Math.abs(hash)}-${pin.length}`);
};

const verifyPINHash = (pin: string, hash: string) => hashPIN(pin) === hash;

export function validatePIN(pin: string): boolean {
  return /^\d{4,6}$/.test(pin);
}

interface AccountRow {
  pin_hash: string | null;
  pin_attempts: number | null;
  pin_locked_until: string | null;
}

async function getAccount(userId: string): Promise<AccountRow | null> {
  const { data, error } = await supabase
    .from('user_accounts')
    .select('pin_hash, pin_attempts, pin_locked_until')
    .eq('user_id', userId)
    .single();
  if (error && (error as any).code !== 'PGRST116') throw error;
  return data as AccountRow | null;
}

/** True once the user has set a PIN at all (any app). */
export async function hasPinSet(userId: string): Promise<boolean> {
  const account = await getAccount(userId);
  return !!account?.pin_hash;
}

/**
 * First-time PIN set — only succeeds while no PIN exists yet. Changing an
 * existing PIN must go through changePin() with the current PIN.
 */
export async function setInitialPin(userId: string, pin: string): Promise<PinResult> {
  if (!validatePIN(pin)) return { success: false, error: 'PIN must be 4-6 digits' };

  const account = await getAccount(userId);
  if (account?.pin_hash) {
    return { success: false, error: 'A PIN is already set. Use "Change PIN" instead.' };
  }

  const { error } = await supabase
    .from('user_accounts')
    .update({
      pin_hash: hashPIN(pin),
      pin_created_at: new Date().toISOString(),
      pin_attempts: 0,
      pin_locked_until: null,
    })
    .eq('user_id', userId);

  if (error) return { success: false, error: error.message };
  return { success: true, message: 'PIN set successfully' };
}

export async function verifyPin(userId: string, pin: string): Promise<PinResult> {
  if (!validatePIN(pin)) return { success: false, error: 'Invalid PIN format' };

  const account = await getAccount(userId);
  if (!account) return { success: false, error: 'Account not found' };

  if (account.pin_locked_until && new Date(account.pin_locked_until) > new Date()) {
    return { success: false, error: 'Account locked due to too many failed PIN attempts. Try again later.' };
  }

  if (account.pin_hash && verifyPINHash(pin, account.pin_hash)) {
    await supabase.from('user_accounts').update({ pin_attempts: 0, pin_locked_until: null }).eq('user_id', userId);
    return { success: true, message: 'PIN verified' };
  }

  const newAttempts = (account.pin_attempts || 0) + 1;
  const lockedUntil = newAttempts >= 3 ? new Date(Date.now() + 30 * 60 * 1000).toISOString() : null;
  await supabase.from('user_accounts').update({ pin_attempts: newAttempts, pin_locked_until: lockedUntil }).eq('user_id', userId);
  return { success: false, error: `Incorrect PIN. Attempts remaining: ${Math.max(0, 3 - newAttempts)}` };
}

/** Change an existing PIN — requires the current PIN. */
export async function changePin(userId: string, oldPin: string, newPin: string): Promise<PinResult> {
  if (!validatePIN(newPin)) return { success: false, error: 'New PIN must be 4-6 digits' };

  const verification = await verifyPin(userId, oldPin);
  if (!verification.success) return verification;

  const { error } = await supabase
    .from('user_accounts')
    .update({ pin_hash: hashPIN(newPin), pin_created_at: new Date().toISOString() })
    .eq('user_id', userId);

  if (error) return { success: false, error: error.message };
  return { success: true, message: 'PIN updated successfully' };
}
