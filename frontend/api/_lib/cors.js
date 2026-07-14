/**
 * Journey booking is now also embedded inside digital-city-era/supermarkera
 * (vendored components — see digital-city-era/frontend/src/vendor/mybodaguy),
 * a different Vercel deployment/origin, so these endpoints need real CORS,
 * not just same-origin. Allowlist-based (not a wildcard) since these routes
 * touch payment/ICAN debit.
 *
 * Set ALLOWED_ORIGINS in the mybodaguy Vercel project as a comma-separated
 * list, e.g. "https://mybodaguy.vercel.app,https://faredeal.vercel.app".
 * Localhost dev ports are always allowed.
 *
 * Returns true if the request was a handled preflight (caller should stop).
 */
const DEFAULT_ALLOWED = ['http://localhost:5173', 'http://localhost:5177', 'http://127.0.0.1:5173'];

export function applyCors(req, res) {
  const configured = (process.env.ALLOWED_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean);
  const allowed = [...DEFAULT_ALLOWED, ...configured];
  const origin = req.headers.origin;

  if (origin && allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}
