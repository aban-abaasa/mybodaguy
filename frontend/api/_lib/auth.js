import { supabaseAdmin } from './supabaseAdmin.js';

/** Authenticate a browser request using the Supabase access token. */
export async function requireUser(req, res) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) {
    res.status(401).json({ success: false, error: 'Authentication required' });
    return null;
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) {
    res.status(401).json({ success: false, error: 'Invalid or expired authentication token' });
    return null;
  }
  return data.user;
}

export function requireMatchingUser(user, requestedUserId, res) {
  if (!requestedUserId || user.id !== requestedUserId) {
    res.status(403).json({ success: false, error: 'User identity does not match the journey request' });
    return false;
  }
  return true;
}
