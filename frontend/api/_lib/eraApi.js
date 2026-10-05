/**
 * Era API gateway: the public, key-based API (reads, plus a few safe request-creating writes) of the whole ICANERA family
 * (ICANERA, BodaGoEra, SupermarketEra, FarmAgentEra).
 *
 * Route (served by api/v1/[...path].js in every app, so each app's own domain answers):
 *   GET  /api/v1/ping                 health + whether the database layer is installed (no key)
 *   GET  /api/v1/catalog              the endpoint registry as JSON (no key)
 *   GET  /api/v1/openapi.json         the same registry as an OpenAPI 3 file (no key)
 *   POST /api/v1/developers/register  get a ticket + an instant sandbox key (no account)
 *   POST /api/v1/developers/status    what the platform team decided about your app
 *   POST /api/v1/developers/key       issue / rotate a sandbox or live key (shown once)
 *   GET  /api/v1/<app>/<resource>     the data (needs a key)
 *   POST /api/v1/business/...         the few write endpoints: payment REQUESTS and ride/delivery booking REQUESTS
 *                                     (need a business key and an Idempotency-Key header; they never move money)
 *
 * This file is deliberately thin: authentication, scopes, rate limits, the sandbox and every handler live in the
 * database (supabase/migrations/20261005100000_era_api.sql) where they are tested. The gateway only
 *   - reads the key from `Authorization: Bearer ...` or `X-API-Key` (never from the URL, so keys stay out of logs),
 *   - hashes the caller's IP with a daily salt (so abuse limits work without storing an address),
 *   - relays the answer with CORS and rate-limit headers.
 *
 * Env: SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY (preferred) or SUPABASE_ANON_KEY
 * (or VITE_SUPABASE_ANON_KEY). Everything this file calls is also safe to call with the anon key.
 */
import { createHash } from 'node:crypto';

export const API_VERSION = 'v1';
const BASE_PATH = '/api/v1';
const RPC_TIMEOUT_MS = 8000;
const MAX_BODY_BYTES = 16 * 1024;
const IDEM_RE = /^[A-Za-z0-9_-]{8,64}$/;

const EXPOSED_HEADERS = [
  'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset', 'X-Quota-Limit', 'X-Quota-Remaining',
  'X-Era-Mode', 'X-Era-Version', 'X-Request-Id', 'X-Idempotent-Replay', 'Retry-After',
].join(', ');

// ---------------------------------------------------------------------------- pure helpers (unit tested)

/** `/api/v1/icanera/coin/price?currency=UGX&pretty=1` -> { path: '/icanera/coin/price', query: { currency: 'UGX' }, pretty: true } */
export function parseRoute(rawUrl) {
  const u = new URL(rawUrl || '/', 'http://local');
  let p = u.pathname;
  if (p === BASE_PATH || p.startsWith(`${BASE_PATH}/`)) p = p.slice(BASE_PATH.length);
  const path = `/${p.split('/').filter(Boolean).join('/')}`;
  const query = {};
  let pretty = false;
  for (const [k, v] of u.searchParams) {
    if (k === 'pretty') { pretty = v !== '0' && v !== 'false'; continue; }
    if (!(k in query)) query[k] = v;           // first value wins
  }
  return { path: path === '/' ? '' : path, query, pretty };
}

/** The key, from `Authorization: Bearer <key>` or `X-API-Key`. Never from the URL. */
export function extractKey(headers = {}) {
  const auth = String(headers.authorization || '').trim();
  const m = /^Bearer\s+(\S{1,120})$/i.exec(auth);
  if (m) return m[1];
  const x = String(headers['x-api-key'] || '').trim();
  return x && x.length <= 120 ? x : null;
}

/** A pseudonymous caller id: sha256(salt | UTC day | ip). Rotates daily and cannot be reversed to an address. */
export function hashIp(headers = {}, remoteAddress = '', salt = 'era-api', now = new Date()) {
  const ip = String(headers['x-real-ip'] || String(headers['x-forwarded-for'] || '').split(',')[0] || remoteAddress || '').trim();
  if (!ip) return null;
  return createHash('sha256').update(`${salt}|${now.toISOString().slice(0, 10)}|${ip}`).digest('hex').slice(0, 32);
}

/** Map a PostgREST / Postgres error to an HTTP answer. Messages we wrote ourselves (validation) are passed on; others are not. */
export function mapPgError(err) {
  const pg = err?.pg || {};
  const code = String(pg.code || '');
  if (code === 'PGRST202' || code === '42883' || err?.httpStatus === 404) {
    return { status: 503, code: 'not_installed', message: 'The Era API database layer has not been applied to this server yet.' };
  }
  const safe = typeof pg.message === 'string' ? pg.message.slice(0, 300) : 'Request failed.';
  if (code === 'ERA29' || code === '53400') return { status: 429, code: 'too_many_requests', message: safe };
  if (code === 'ERA22') return { status: 422, code: 'unprocessable', message: safe };
  if (code === '22023') return { status: 400, code: 'bad_request', message: safe };
  if (code === 'P0002') return { status: 404, code: 'not_found', message: safe };
  if (code === '42501') return { status: 403, code: 'forbidden', message: safe };
  if (err?.name === 'AbortError') return { status: 504, code: 'upstream_timeout', message: 'The database took too long to answer.' };
  return { status: 502, code: 'upstream_error', message: 'The API could not reach its database. Try again shortly.' };
}

const OPENAPI_TYPE = { string: 'string', integer: 'integer', number: 'number', boolean: 'boolean' };
const OPENAPI_BODY = { string: { type: 'string' }, integer: { type: 'integer' }, number: { type: 'number' }, boolean: { type: 'boolean' }, object: { type: 'object' }, array: { type: 'array', items: {} } };

/** The registry (from era_api_catalog) as an OpenAPI 3.0 document. */
export function buildOpenApi(catalog, origin) {
  const apps = Array.isArray(catalog?.apps) ? catalog.apps : [];
  const nameOf = Object.fromEntries(apps.map((a) => [a.id, a.name]));
  const errorRef = (description) => ({ description, content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } });
  const paths = {};
  for (const ep of catalog?.endpoints || []) {
    const parameters = (ep.params || []).map((p) => ({
      name: p.name,
      in: p.in === 'path' ? 'path' : 'query',
      required: p.in === 'path' ? true : !!p.required,
      description: p.description,
      schema: { type: OPENAPI_TYPE[p.type] || 'string', ...(p.default !== undefined ? { default: p.default } : {}) },
      ...(p.example !== undefined ? { example: p.example } : {}),
    }));
    const isPost = String(ep.method || 'GET').toUpperCase() === 'POST';
    const bodyFields = Array.isArray(ep.body) ? ep.body : [];
    if (isPost) {
      parameters.push({
        name: 'Idempotency-Key', in: 'header', required: true,
        description: '8 to 64 letters, digits, - or _. Send the same key when you retry the same request: you get the original answer back and nothing is created twice.',
        schema: { type: 'string', minLength: 8, maxLength: 64 },
      });
    }
    const responses = {
      200: {
        description: 'OK. The payload is under `data`; `meta` says which app, endpoint and mode (sandbox, live or business) answered.',
        headers: {
          'X-RateLimit-Limit': { schema: { type: 'integer' }, description: 'Requests allowed per minute.' },
          'X-RateLimit-Remaining': { schema: { type: 'integer' }, description: 'Requests left in this minute.' },
          'X-Quota-Remaining': { schema: { type: 'integer' }, description: 'Requests left today (UTC).' },
        },
        content: { 'application/json': { schema: { type: 'object', properties: { data: {}, meta: { type: 'object' } } } } },
      },
      400: errorRef('A parameter, the body or the Idempotency-Key is missing or invalid.'),
      401: errorRef('Missing, malformed, expired or revoked key.'),
      403: errorRef(ep.access === 'business' ? 'Your key does not have the scope this endpoint needs.' : 'Your key is not approved for this app.'),
      404: errorRef('Nothing found.'),
      429: errorRef('Rate limit or daily quota reached. See Retry-After.'),
    };
    if (isPost) {
      responses[201] = { ...responses[200], description: 'Created. A request was recorded; follow the instructions in `data` (nothing has moved).' };
      responses[409] = errorRef('That Idempotency-Key was already used for a different request.');
      responses[422] = errorRef('The request is well formed but not allowed (a cap, an unverified business, a limit).');
    }
    const op = {
      operationId: String(ep.id).replace(/[^a-zA-Z0-9]+/g, '_'),
      summary: ep.summary,
      description: [ep.description, ep.scope ? `Needs the \`${ep.scope}\` scope on a business key.` : ''].filter(Boolean).join('\n\n') || undefined,
      tags: [nameOf[ep.app] || ep.app],
      parameters,
      responses,
    };
    if (isPost) {
      op.requestBody = {
        required: bodyFields.some((f) => f.required),
        content: { 'application/json': { schema: {
          type: 'object',
          properties: Object.fromEntries(bodyFields.map((f) => [f.name, { description: f.description, ...(OPENAPI_BODY[f.type] || { type: 'string' }), ...(f.example !== undefined ? { example: f.example } : {}) }])),
          required: bodyFields.filter((f) => f.required).map((f) => f.name),
        } } },
      };
    }
    paths[ep.path] = { ...(paths[ep.path] || {}), [isPost ? 'post' : 'get']: op };
  }
  return {
    openapi: '3.0.3',
    info: {
      title: 'ICANERA Era API',
      version: '2.0.0',
      description: 'One API across ICANERA, BodaGoEra, SupermarketEra and FarmAgentEra. Public data, plus private business endpoints (payment requests, inventory with expiry tracking, CMMS, ride and delivery booking requests) behind owner-issued scoped keys. The API never moves money and never books a ride by itself: a person confirms in the app. Start with a free sandbox key at /developers.',
    },
    servers: [{ url: `${origin}${BASE_PATH}` }],
    security: [{ bearerAuth: [] }, { apiKeyHeader: [] }],
    tags: apps.map((a) => ({ name: a.name, description: a.tagline })),
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', description: 'Authorization: Bearer era_test_... (sandbox), era_live_... (approved developer) or era_biz_... (a business key issued by its owner in ICAN).' },
        apiKeyHeader: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, status: { type: 'integer' } } } },
        },
      },
    },
  };
}

// ---------------------------------------------------------------------------- the handler

const errorBody = (status, code, message) => ({ error: { code, message, status } });

async function readJson(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    if (Array.isArray(req.body)) throw Object.assign(new Error('not an object'), { notObject: true });
    if (JSON.stringify(req.body).length > MAX_BODY_BYTES) throw Object.assign(new Error('too large'), { tooLarge: true });
    return req.body;
  }
  let raw = '';
  if (typeof req.body === 'string') raw = req.body;
  else if (Buffer.isBuffer(req.body)) raw = req.body.toString('utf8');
  else if (req.on) {
    raw = await new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on('data', (c) => { size += c.length; if (size > MAX_BODY_BYTES) { reject(Object.assign(new Error('too large'), { tooLarge: true })); } else chunks.push(c); });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }
  if (raw.length > MAX_BODY_BYTES) throw Object.assign(new Error('too large'), { tooLarge: true });
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Object.assign(new Error('not an object'), { notObject: true });
  return parsed;
}

const str = (v, max) => (v === undefined || v === null ? null : String(v).slice(0, max));

export function createEraHandler({ env = process.env, fetchImpl = globalThis.fetch, now = () => new Date() } = {}) {
  const cfg = () => {
    const url = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
    const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || '';
    return url && key ? { url, key } : null;
  };

  async function rpc(c, fn, args) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), RPC_TIMEOUT_MS);
    try {
      const r = await fetchImpl(`${c.url}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: { apikey: c.key, Authorization: `Bearer ${c.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(args || {}),
        signal: ctrl.signal,
      });
      const text = await r.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch { /* leave null */ }
      if (!r.ok) {
        const e = new Error(json?.message || `HTTP ${r.status}`);
        e.pg = json || {}; e.httpStatus = r.status;
        throw e;
      }
      return json;
    } finally {
      clearTimeout(timer);
    }
  }

  return async function handler(req, res) {
    const send = (status, body, headers = {}, { pretty = false, head = false } = {}) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, X-API-Key, Content-Type, Idempotency-Key');
      res.setHeader('Access-Control-Expose-Headers', EXPOSED_HEADERS);
      res.setHeader('Access-Control-Max-Age', '86400');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Era-Version', API_VERSION);
      res.setHeader('Cache-Control', 'no-store');
      // Answers depend on the credential, so no cache may reuse one caller's answer for another key.
      res.setHeader('Vary', 'Authorization, X-API-Key');
      for (const [k, v] of Object.entries(headers)) if (v !== undefined && v !== null) res.setHeader(k, String(v));
      res.end(head ? undefined : JSON.stringify(body, null, pretty ? 2 : 0));
    };

    if (req.method === 'OPTIONS') return send(204, null, {}, { head: true });

    const { path, query, pretty } = parseRoute(req.url);
    const isHead = req.method === 'HEAD';
    const opts = { pretty, head: isHead };
    const c = cfg();
    if (!c) return send(503, errorBody(503, 'not_configured', 'This server has no database connection configured.'), {}, opts);

    const fail = (e) => { const m = mapPgError(e); return send(m.status, errorBody(m.status, m.code, m.message), {}, opts); };
    const forwardedHost = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
    const origin = `${req.headers['x-forwarded-proto'] || 'https'}://${forwardedHost}`;

    // -------- no key needed
    if ((req.method === 'GET' || isHead) && (path === '' || path === '/ping' || path === '/catalog' || path === '/openapi.json')) {
      if (path === '') {
        return send(200, {
          api: 'ICANERA Era API', version: API_VERSION,
          message: 'Hello, builder. Get a free sandbox key in ten seconds at /developers.',
          links: { developers: `${origin}/developers`, ping: `${origin}${BASE_PATH}/ping`, catalog: `${origin}${BASE_PATH}/catalog`, openapi: `${origin}${BASE_PATH}/openapi.json` },
          try: `curl ${origin}${BASE_PATH}/whoami -H "Authorization: Bearer <your key>"`,
        }, { 'Cache-Control': 'public, s-maxage=300' }, opts);
      }
      if (path === '/ping') {
        const t0 = Date.now();
        let info = null; let state = 'ready';
        try { info = await rpc(c, 'era_api_public_info', {}); } catch (e) { state = mapPgError(e).code === 'not_installed' ? 'not_installed' : 'unreachable'; }
        if (info && !info.enabled) state = 'disabled';
        return send(200, { ok: state === 'ready', state, api: 'era', version: API_VERSION, time: now().toISOString(), db_ms: Date.now() - t0, ...(info || {}) }, {}, opts);
      }
      try {
        const catalog = await rpc(c, 'era_api_catalog', {});
        const body = path === '/catalog' ? catalog : buildOpenApi(catalog, origin);
        return send(200, body, { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' }, opts);
      } catch (e) { return fail(e); }
    }

    // -------- onboarding: no account, no key
    if (req.method === 'POST' && path.startsWith('/developers/')) {
      let b;
      try { b = await readJson(req); } catch { return send(400, errorBody(400, 'bad_json', 'Send a small JSON body.'), {}, opts); }
      try {
        if (path === '/developers/register') {
          const ipHash = hashIp(req.headers, req.socket?.remoteAddress, env.ERA_API_IP_SALT || 'era-api', now());
          const out = await rpc(c, 'era_api_request_access', {
            p_app_name: str(b.app_name, 200) ?? '', p_contact_name: str(b.contact_name, 200), p_contact_email: str(b.email, 300) ?? '',
            p_website: str(b.website, 400), p_description: str(b.description, 1000),
            p_apps: Array.isArray(b.apps) ? b.apps.slice(0, 4).map((a) => String(a).slice(0, 30)) : [],
            p_ip_hash: ipHash, p_hp: str(b.hp, 200),
          });
          return send(201, out, {}, opts);
        }
        if (path === '/developers/status') return send(200, await rpc(c, 'era_api_ticket_status', { p_ticket: str(b.ticket, 100) }), {}, opts);
        if (path === '/developers/key') return send(200, await rpc(c, 'era_api_issue_key', { p_ticket: str(b.ticket, 100), p_mode: str(b.mode, 10) }), {}, opts);
      } catch (e) { return fail(e); }
      return send(404, errorBody(404, 'unknown_endpoint', 'No such endpoint.'), {}, opts);
    }

    // -------- the data
    const isPost = req.method === 'POST';
    if (req.method !== 'GET' && !isHead && !isPost) {
      return send(405, errorBody(405, 'method_not_allowed', 'Use GET for data, POST for the few request-creating endpoints.'), { Allow: 'GET, HEAD, POST, OPTIONS' }, opts);
    }
    if (path.length > 200) return send(404, errorBody(404, 'unknown_endpoint', 'No such endpoint.'), {}, opts);

    const args = {
      p_key: extractKey(req.headers), p_method: isPost ? 'POST' : 'GET', p_path: path, p_query: query,
      p_ip_hash: hashIp(req.headers, req.socket?.remoteAddress, env.ERA_API_IP_SALT || 'era-api', now()),
    };
    if (isPost) {
      const ctype = String(req.headers['content-type'] || '').toLowerCase();
      if (ctype && !ctype.startsWith('application/json')) {
        return send(415, errorBody(415, 'unsupported_media_type', 'Send the body as application/json.'), {}, opts);
      }
      try { args.p_body = await readJson(req); } catch (e) {
        if (e?.tooLarge) return send(413, errorBody(413, 'payload_too_large', 'The body is limited to 16 KB.'), {}, opts);
        return send(400, errorBody(400, 'bad_json', 'Send a JSON object as the body.'), {}, opts);
      }
      const idem = String(req.headers['idempotency-key'] || '').trim();
      if (idem && !IDEM_RE.test(idem)) {
        return send(400, errorBody(400, 'bad_idempotency_key', 'Idempotency-Key must be 8 to 64 letters, digits, - or _.'), {}, opts);
      }
      args.p_idem = idem || null;
    }

    let answer;
    try { answer = await rpc(c, 'era_api_call', args); } catch (e) { return fail(e); }
    if (!answer || typeof answer.status !== 'number') return send(502, errorBody(502, 'upstream_error', 'Unexpected answer from the database.'), {}, opts);
    return send(answer.status, answer.body, answer.headers || {}, opts);
  };
}
