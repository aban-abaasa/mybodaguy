/**
 * BodaGoEra Canwe Shield — deception-based bot/attacker detection.
 *
 * Named deliberately generic (not a recognizable security term) so nothing
 * in this file's name, import paths, or log tags gives away what it does
 * to anyone who reads the shipped client bundle or greps the repo.
 *
 * This project is Vercel serverless end to end — there is no persistent
 * Node process to hold an in-memory IP blocklist between requests, so state
 * lives entirely in Supabase (security_flagged_ips / security_threat_events
 * — see ../../backend/database/SECURITY_CANWE_SHIELD.sql). A small
 * per-instance in-memory cache still helps on a warm function instance, it
 * just can't be relied on across cold starts the way it can in a real
 * long-running server.
 *
 * Design choice: this gate FAILS OPEN. If Supabase is unreachable, real
 * users must never be blocked because a deception layer's backing store
 * hiccuped — this is a bonus detection layer, not primary authz (requireUser
 * in _lib/auth.js and applyCors in _lib/cors.js still do the real work).
 */

import { supabaseAdmin } from './supabaseAdmin.js';

const ipCache = new Map(); // ip -> { flagged, hit_count, severity, expiresAt }
const CACHE_TTL_MS = 30_000;

export const HONEYTOKEN_FIELDS = ['admin_pass', 'root_token', 'backup_key', 'website', 'confirm_email_2'];
const SENSITIVE_LOG_KEYS = ['password', 'pin', 'pass', 'token', 'secret', 'card', 'cvv'];

export function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

function redactPayload(body) {
  if (!body || typeof body !== 'object') return null;
  const out = {};
  for (const [key, value] of Object.entries(body)) {
    out[key] = SENSITIVE_LOG_KEYS.some((k) => key.toLowerCase().includes(k)) ? '[redacted]' : value;
  }
  return out;
}

export function tarpitDelayMs(hitCount = 1) {
  return Math.min(10_000 + (Math.max(hitCount, 1) - 1) * 4_000, 30_000);
}

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function isIpFlagged(ip) {
  const cached = ipCache.get(ip);
  if (cached && cached.expiresAt > Date.now()) return cached;

  const { data, error } = await supabaseAdmin.rpc('check_ip_flagged', { p_ip: ip, p_app_name: 'mybodaguy' });
  const result = error || !data ? { flagged: false } : data;
  ipCache.set(ip, { ...result, expiresAt: Date.now() + CACHE_TTL_MS });
  return result;
}

export async function logThreat({ ip, userAgent, triggerType, route, method, payload, severity = 'medium' }) {
  ipCache.delete(ip);
  const { data, error } = await supabaseAdmin.rpc('log_security_threat', {
    p_ip: ip,
    p_user_agent: userAgent || null,
    p_trigger_type: triggerType,
    p_route: route || null,
    p_http_method: method || null,
    p_payload: redactPayload(payload),
    p_app_name: 'mybodaguy',
    p_severity: severity,
  });
  if (error) {
    console.error('[canwe] failed to log threat:', error.message);
    return null;
  }
  console.warn(`[canwe] THREAT ${triggerType} ip=${ip} route=${route || '-'} severity=${data?.severity} hits=${data?.hit_count}`);
  return data;
}

export function decoyBaitResponse() {
  return { success: true, data: [], meta: { generated_at: new Date().toISOString(), version: '1.0.0' } };
}

/** Drop-in default export for any api/** decoy route file. */
export async function decoyHandler(req, res) {
  const ip = getClientIp(req);
  await logThreat({
    ip,
    userAgent: req.headers['user-agent'],
    triggerType: 'decoy_route',
    route: req.url,
    method: req.method,
    payload: req.body,
    severity: 'high',
  });
  await delay(tarpitDelayMs(2));
  res.status(200).json(decoyBaitResponse());
}

/**
 * Wrap any real api/** handler to gate out already-flagged IPs before your
 * handler's own logic (and its Supabase reads/writes) ever runs. Optional —
 * apply it to the endpoints most worth shielding; every handler still keeps
 * its own auth/CORS as the real access control.
 */
export function withIpReputationGate(handler) {
  return async function gated(req, res) {
    try {
      const ip = getClientIp(req);
      const status = await isIpFlagged(ip);
      if (!status.flagged) return handler(req, res);

      await delay(tarpitDelayMs(status.hit_count));
      return res.status(200).json(decoyBaitResponse());
    } catch (err) {
      console.error('[canwe] gate error (failing open):', err.message);
      return handler(req, res);
    }
  };
}
