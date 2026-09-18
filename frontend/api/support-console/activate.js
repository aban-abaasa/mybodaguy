import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../_lib/supabaseAdmin.js';
import { applyCors } from '../_lib/cors.js';

// Public (anon-key) client used only to sign the freshly-minted throwaway
// account in for real and hand back a session — a normal email/password
// login, the same path every real BodaGoEra user already uses.
//
// Built lazily, inside the handler, not at module load — createClient()
// throws synchronously if the URL/key are missing, and doing that at the
// top level crashes the ENTIRE function on cold start (including plain
// CORS preflight OPTIONS requests, before applyCors() ever runs), which is
// indistinguishable from a CORS misconfiguration in the browser. Building
// it lazily lets applyCors() and the env-var check below run first, so a
// misconfiguration comes back as a normal JSON error instead of a raw
// Vercel FUNCTION_INVOCATION_FAILED with no CORS headers at all.
function getSupabasePublic() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    console.error('[support-console/activate] missing env vars', {
      hasUrl: !!url, hasAnonKey: !!anonKey,
    });
    return null;
  }
  return createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

/**
 * Support Console activation (see backend/database/ADD_SUPPORT_CONSOLE.sql
 * / ADD_SUPPORT_CONSOLE_ANY_TAB.sql). Verifying a support link's password
 * needs to end with the browser holding a REAL Supabase session scoped to
 * a developer, since mybodaguy's DeveloperDashboard trusts real
 * auth.uid()-backed RLS for every tab, not a shared passphrase like
 * ICAN's dev panel.
 *
 * Rather than requiring the Supabase project's "Anonymous Sign-ins" auth
 * provider to be turned on, this runs entirely through the service role
 * this backend already has configured for real production traffic
 * (journeys/confirm.js, webhooks/duffel.js, etc.): mint a real (not
 * anonymous) throwaway auth user via the Admin API, flip it to
 * role_type = 'developer' scoped to the link's allowed_tabs, and sign it
 * in — then hand the resulting access/refresh tokens back to the browser,
 * which adopts them via supabase.auth.setSession().
 */
export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  const { token, password } = req.body || {};
  if (!token || !password) {
    return res.status(400).json({ success: false, error: 'Missing token or password.' });
  }

  const supabasePublic = getSupabasePublic();
  if (!supabasePublic) {
    return res.status(500).json({
      success: false,
      error: 'Support Console is not fully configured on the server (missing SUPABASE_URL/SUPABASE_ANON_KEY env vars).',
    });
  }

  try {
    const { data: check, error: checkErr } = await supabaseAdmin.rpc('mbg_support_check_link_password', {
      p_token: token,
      p_password: password,
    });
    if (checkErr) throw checkErr;
    if (!check?.success) {
      return res.status(200).json({ success: false, error: check?.error || 'Could not verify.' });
    }

    const email = `support-${crypto.randomUUID()}@mybodaguy.invalid`;
    const throwawayPassword = crypto.randomUUID() + crypto.randomUUID();

    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: throwawayPassword,
      email_confirm: true,
    });
    if (createErr) throw createErr;
    const userId = created.user.id;

    // Elevate + record the grant. Service role bypasses RLS entirely, and
    // mbg_block_developer_self_grant() (ADD_DEVELOPER_SELF_SERVICE_ACCESS
    // .sql) already has an unconditional auth.role() = 'service_role'
    // escape hatch — nothing about that trigger needs to change for this.
    const { error: promoteErr } = await supabaseAdmin
      .from('mbg_users')
      .update({ role_type: 'developer' })
      .eq('id', userId);
    if (promoteErr) throw promoteErr;

    const { error: grantErr } = await supabaseAdmin
      .from('mbg_support_link_grants')
      .upsert({ user_id: userId, link_id: check.link_id }, { onConflict: 'user_id' });
    if (grantErr) throw grantErr;

    const { data: signIn, error: signInErr } = await supabasePublic.auth.signInWithPassword({
      email,
      password: throwawayPassword,
    });
    if (signInErr) throw signInErr;

    return res.status(200).json({
      success: true,
      label: check.label,
      allowed_tabs: check.allowed_tabs,
      access_token: signIn.session.access_token,
      refresh_token: signIn.session.refresh_token,
    });
  } catch (error) {
    console.error('[support-console/activate] error:', error);
    return res.status(500).json({ success: false, error: 'Failed to activate link.' });
  }
}
