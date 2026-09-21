// The journey endpoints that touch the database (quote, confirm) load their
// server-side dependencies here, inside the handler, instead of importing them
// at the top of the file.
//
// Why: the Supabase admin client is created when its module loads. If that
// throws (server env vars missing, unsupported runtime, a bad build), a
// top-level import kills the whole function before it can send a single
// header — no CORS headers, so the browser reports a misleading "CORS error /
// Failed to fetch" and nothing says what is actually wrong. Loading it after
// applyCors() lets the endpoint answer with a normal JSON error that names the
// problem, and that the page can show.

export async function loadServer() {
  const [{ supabaseAdmin }, auth] = await Promise.all([
    import('./supabaseAdmin.js'),
    import('./auth.js'),
  ]);
  return { supabaseAdmin, requireUser: auth.requireUser, requireMatchingUser: auth.requireMatchingUser };
}

/** Respond to a dependency-load failure. `detail` is the reason (a config/runtime message, not user data). */
export function sendMisconfigured(res, err) {
  const detail = String(err?.message || err).split('\n')[0].slice(0, 300);
  console.error('Journey API could not load its server dependencies:', err);
  return res.status(500).json({
    success: false,
    error: "The booking service isn't configured correctly on the server yet.",
    code: 'server_misconfigured',
    detail,
  });
}
