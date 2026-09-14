/**
 * Vercel Serverless Function — honeytoken report intake
 *
 * The frontend calls this the instant a hidden trap field (see
 * src/mybodaguy/components/security/CanweFields.tsx) comes back non-empty
 * on submit -- i.e. before ever calling authService.signIn/signUp.
 * Deliberately unauthenticated (the point is to catch pre-auth bots) and
 * always answers with the same generic body regardless of outcome.
 *
 * Route: POST /api/security/report
 */

import { applyCors } from '../_lib/cors.js';
import { getClientIp, logThreat, delay, HONEYTOKEN_FIELDS } from '../_lib/canweShield.js';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const ip = getClientIp(req);
  const body = req.body || {};
  const trippedField = HONEYTOKEN_FIELDS.find((f) => body[f] !== undefined && String(body[f]).trim() !== '');

  if (trippedField) {
    await logThreat({
      ip,
      userAgent: req.headers['user-agent'],
      triggerType: 'honeytoken_field',
      route: body.formContext || 'unknown-form',
      method: 'POST',
      payload: { field: trippedField },
      severity: 'critical',
    });
  }

  await delay(700 + Math.random() * 500);
  res.status(200).json({ success: false, error: 'Authentication failed' });
}
