import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRoute, extractKey, hashIp, mapPgError, buildOpenApi, createEraHandler } from '../api/_lib/eraApi.js';

// ---------------------------------------------------------------- pure helpers
test('parseRoute: path, query, pretty', () => {
  assert.deepEqual(parseRoute('/api/v1/icanera/coin/price?currency=UGX&pretty=1'), { path: '/icanera/coin/price', query: { currency: 'UGX' }, pretty: true });
  assert.deepEqual(parseRoute('/api/v1/'), { path: '', query: {}, pretty: false });
  assert.deepEqual(parseRoute('/api/v1'), { path: '', query: {}, pretty: false });
  assert.equal(parseRoute('/api/v1//icanera///coin/').path, '/icanera/coin');
  assert.equal(parseRoute('/api/v1/x?a=1&a=2').query.a, '1', 'first value wins');
  assert.equal(parseRoute('/api/v1/x?pretty=0').pretty, false);
});

test('extractKey reads the Authorization header or X-API-Key, never the URL', () => {
  assert.equal(extractKey({ authorization: 'Bearer era_test_abc' }), 'era_test_abc');
  assert.equal(extractKey({ authorization: 'bearer   era_live_x' }), 'era_live_x');
  assert.equal(extractKey({ 'x-api-key': ' era_test_def ' }), 'era_test_def');
  assert.equal(extractKey({ authorization: 'Basic abc' }), null);
  assert.equal(extractKey({}), null);
  assert.equal(extractKey({ authorization: `Bearer ${'a'.repeat(500)}` }), null, 'absurdly long keys are not forwarded');
});

test('hashIp is a daily pseudonym that never contains the address', () => {
  const d1 = new Date('2026-10-05T10:00:00Z'); const d2 = new Date('2026-10-06T10:00:00Z');
  const h = hashIp({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }, '', 's', d1);
  assert.match(h, /^[0-9a-f]{32}$/);
  assert.ok(!h.includes('203'), 'address not embedded');
  assert.equal(h, hashIp({ 'x-real-ip': '203.0.113.9' }, '', 's', d1), 'same caller, same day, same hash');
  assert.notEqual(h, hashIp({ 'x-real-ip': '203.0.113.9' }, '', 's', d2), 'rotates daily');
  assert.notEqual(h, hashIp({ 'x-real-ip': '203.0.113.10' }, '', 's', d1));
  assert.equal(hashIp({}, '', 's', d1), null);
  assert.ok(hashIp({}, '198.51.100.1', 's', d1), 'falls back to the socket address');
});

test('mapPgError: our own validation messages pass through, everything else is generic', () => {
  assert.deepEqual(mapPgError({ pg: { code: '22023', message: 'Give your app a name.' } }), { status: 400, code: 'bad_request', message: 'Give your app a name.' });
  assert.equal(mapPgError({ pg: { code: 'ERA29', message: 'Too many sign-ups.' } }).status, 429);
  assert.equal(mapPgError({ pg: { code: 'P0002', message: 'That ticket is not valid.' } }).status, 404);
  assert.equal(mapPgError({ pg: { code: '42501', message: 'nope' } }).status, 403);
  assert.equal(mapPgError({ pg: { code: 'PGRST202' }, httpStatus: 404 }).code, 'not_installed');
  const leak = mapPgError({ pg: { code: 'XX000', message: 'relation "secret_table" does not exist' } });
  assert.equal(leak.status, 502);
  assert.ok(!leak.message.includes('secret_table'), 'internal errors never leak');
  assert.equal(mapPgError({ name: 'AbortError' }).status, 504);
});

const CATALOG = {
  version: 'v1',
  apps: [{ id: 'icanera', name: 'ICANERA', tagline: 'Coins.' }],
  endpoints: [
    { id: 'icanera.tax_rules', app: 'icanera', path: '/icanera/tax/{country}', summary: 'Tax', description: 'd',
      params: [{ name: 'country', in: 'path', type: 'string', required: true, example: 'UG', description: 'ISO' }] },
    { id: 'icanera.coin_price', app: 'icanera', path: '/icanera/coin/price', summary: 'Price',
      params: [{ name: 'currency', in: 'query', type: 'string', required: false, default: 'USD', example: 'UGX', description: 'code' },
               { name: 'limit', in: 'query', type: 'integer', description: 'n' }] },
  ],
};

test('buildOpenApi produces a usable OpenAPI 3 document', () => {
  const doc = buildOpenApi(CATALOG, 'https://icanera.space');
  assert.equal(doc.openapi, '3.0.3');
  assert.deepEqual(doc.servers, [{ url: 'https://icanera.space/api/v1' }]);
  assert.deepEqual(Object.keys(doc.paths).sort(), ['/icanera/coin/price', '/icanera/tax/{country}']);
  const tax = doc.paths['/icanera/tax/{country}'].get;
  assert.equal(tax.operationId, 'icanera_tax_rules');
  assert.deepEqual(tax.parameters[0], { name: 'country', in: 'path', required: true, description: 'ISO', schema: { type: 'string' }, example: 'UG' });
  const price = doc.paths['/icanera/coin/price'].get.parameters;
  assert.equal(price[0].required, false);
  assert.equal(price[0].schema.default, 'USD');
  assert.equal(price[1].schema.type, 'integer');
  assert.deepEqual(tax.tags, ['ICANERA']);
  for (const code of ['200', '400', '401', '403', '404', '429']) assert.ok(tax.responses[code], `documents ${code}`);
  assert.ok(doc.components.securitySchemes.bearerAuth && doc.components.securitySchemes.apiKeyHeader);
  JSON.stringify(doc); // serialisable
});

// ---------------------------------------------------------------- the handler, against a fake database
function fakeRes() {
  const r = { statusCode: 0, headers: {}, body: undefined, ended: false };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = String(v); };
  r.end = (b) => { r.body = b; r.ended = true; };
  return r;
}
const fakeReq = (method, url, { headers = {}, body } = {}) => ({ method, url, headers: { host: 'icanera.space', ...headers }, body, socket: { remoteAddress: '198.51.100.7' } });

function setup(responder, env) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const fn = url.split('/rpc/')[1];
    const args = JSON.parse(init.body);
    calls.push({ fn, args, headers: init.headers });
    const out = await responder(fn, args);
    if (out instanceof Error) throw out;
    const status = out?.__status || 200;
    return { ok: status < 300, status, text: async () => JSON.stringify(out?.__status ? out.json : out) };
  };
  const handler = createEraHandler({ env: env || { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon' }, fetchImpl, now: () => new Date('2026-10-05T10:00:00Z') });
  return { handler, calls };
}
const run = async (handler, req) => { const res = fakeRes(); await handler(req, res); return res; };
const json = (res) => (res.body ? JSON.parse(res.body) : null);

test('every answer carries CORS and the rate-limit headers are exposed to browsers', async () => {
  const { handler } = setup(() => ({ status: 200, body: { data: 1 }, headers: {} }));
  const res = await run(handler, fakeReq('GET', '/api/v1/whoami', { headers: { authorization: 'Bearer era_test_k' } }));
  assert.equal(res.headers['access-control-allow-origin'], '*');
  assert.match(res.headers['access-control-expose-headers'], /X-RateLimit-Remaining/);
  assert.match(res.headers['access-control-allow-headers'], /Authorization/);
  assert.equal(res.headers['x-era-version'], 'v1');
});

test('answers vary by credential, so a cache can never hand one key\'s answer to another', async () => {
  const { handler } = setup(() => ({ status: 200, body: { data: 1 }, headers: { 'cache-control': 'private, max-age=30' } }));
  const res = await run(handler, fakeReq('GET', '/api/v1/icanera/coin/price', { headers: { authorization: 'Bearer era_test_k' } }));
  assert.match(res.headers.vary, /Authorization/);
  assert.match(res.headers.vary, /X-API-Key/);
  const ping = await run(setup(() => ({ enabled: true })).handler, fakeReq('GET', '/api/v1/ping'));
  assert.match(ping.headers.vary, /Authorization/, 'every response carries it, not only data calls');
});

test('OPTIONS preflight answers 204 without touching the database', async () => {
  const { handler, calls } = setup(() => { throw new Error('must not be called'); });
  const res = await run(handler, fakeReq('OPTIONS', '/api/v1/whoami'));
  assert.equal(res.statusCode, 204);
  assert.equal(calls.length, 0);
  assert.equal(res.headers['access-control-allow-origin'], '*');
});

test('a data call forwards the key, path, query and a hashed caller id, and relays status, headers and body', async () => {
  const { handler, calls } = setup(() => ({
    status: 200,
    headers: { 'x-ratelimit-limit': 60, 'x-ratelimit-remaining': 59, 'cache-control': 'private, max-age=30' },
    body: { data: { price: 1 }, meta: { mode: 'sandbox' } },
  }));
  const res = await run(handler, fakeReq('GET', '/api/v1/icanera/coin/price?currency=UGX', { headers: { authorization: 'Bearer era_test_abc', 'x-forwarded-for': '203.0.113.9' } }));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].fn, 'era_api_call');
  assert.equal(calls[0].args.p_key, 'era_test_abc');
  assert.equal(calls[0].args.p_path, '/icanera/coin/price');
  assert.deepEqual(calls[0].args.p_query, { currency: 'UGX' });
  assert.equal(calls[0].args.p_method, 'GET');
  assert.match(calls[0].args.p_ip_hash, /^[0-9a-f]{32}$/);
  assert.ok(!JSON.stringify(calls[0].args).includes('203.0.113.9'), 'the raw address is never sent to the database');
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['x-ratelimit-remaining'], '59');
  assert.equal(res.headers['cache-control'], 'private, max-age=30');
  assert.deepEqual(json(res), { data: { price: 1 }, meta: { mode: 'sandbox' } });
});

test('keys in the URL are ignored (they would end up in logs and browser history)', async () => {
  const { handler, calls } = setup(() => ({ status: 401, headers: {}, body: { error: { code: 'missing_key' } } }));
  const res = await run(handler, fakeReq('GET', '/api/v1/whoami?api_key=era_live_leaked&key=era_live_leaked2'));
  assert.equal(calls[0].args.p_key, null);
  assert.equal(res.statusCode, 401);
});

test('errors from the database layer are relayed as-is (401, 403, 429 with Retry-After)', async () => {
  const { handler } = setup(() => ({ status: 429, headers: { 'retry-after': 12, 'x-ratelimit-remaining': 0 }, body: { error: { code: 'rate_limited', message: 'slow down', status: 429 } } }));
  const res = await run(handler, fakeReq('GET', '/api/v1/whoami', { headers: { authorization: 'Bearer era_test_k' } }));
  assert.equal(res.statusCode, 429);
  assert.equal(res.headers['retry-after'], '12');
  assert.equal(json(res).error.code, 'rate_limited');
});

test('PUT, DELETE and PATCH are a 405 and never reach the database', async () => {
  const { handler, calls } = setup(() => { throw new Error('must not be called'); });
  for (const m of ['PUT', 'DELETE', 'PATCH']) {
    const res = await run(handler, fakeReq(m, '/api/v1/icanera/coin/price', { headers: { authorization: 'Bearer era_test_k' } }));
    assert.equal(res.statusCode, 405, m);
    assert.equal(res.headers.allow, 'GET, HEAD, POST, OPTIONS');
  }
  assert.equal(calls.length, 0);
});

const BIZ = { authorization: 'Bearer era_biz_k', 'content-type': 'application/json', 'idempotency-key': 'order-1042-try1' };

test('POST forwards the JSON body and the Idempotency-Key, and relays 201 and the replay header', async () => {
  const { handler, calls } = setup(() => ({ status: 201, headers: { 'x-idempotent-replay': 'true' }, body: { data: { payment_code: 'PAY_X' } } }));
  const res = await run(handler, fakeReq('POST', '/api/v1/business/payments', { headers: BIZ, body: { amount: 45000, description: 'Order 1042' } }));
  assert.equal(res.statusCode, 201);
  assert.equal(res.headers['x-idempotent-replay'], 'true');
  assert.equal(calls[0].fn, 'era_api_call');
  assert.equal(calls[0].args.p_method, 'POST');
  assert.equal(calls[0].args.p_path, '/business/payments');
  assert.deepEqual(calls[0].args.p_body, { amount: 45000, description: 'Order 1042' });
  assert.equal(calls[0].args.p_idem, 'order-1042-try1');
  assert.equal(calls[0].args.p_key, 'era_biz_k');
});

test('POST reads a raw JSON stream too (not only a parsed body)', async () => {
  const { handler, calls } = setup(() => ({ status: 201, headers: {}, body: { data: 1 } }));
  const req = fakeReq('POST', '/api/v1/business/bookings', { headers: BIZ });
  const listeners = {};
  req.on = (ev, fn) => { listeners[ev] = fn; };
  const pending = run(handler, req);
  await new Promise((r) => setTimeout(r, 5));
  listeners.data(Buffer.from('{"kind":"ride"}')); listeners.end();
  await pending;
  assert.deepEqual(calls[0].args.p_body, { kind: 'ride' });
});

test('POST without an Idempotency-Key is forwarded as null so the database answers 400 with its own message', async () => {
  const { handler, calls } = setup(() => ({ status: 400, headers: {}, body: { error: { code: 'idempotency_key_required' } } }));
  const res = await run(handler, fakeReq('POST', '/api/v1/business/payments', { headers: { authorization: 'Bearer era_biz_k', 'content-type': 'application/json' }, body: { amount: 1 } }));
  assert.equal(calls[0].args.p_idem, null);
  assert.equal(res.statusCode, 400);
});

test('POST rejects a malformed Idempotency-Key, a non-JSON body, an array, bad JSON and an oversize body before the database', async () => {
  const { handler, calls } = setup(() => { throw new Error('must not be called'); });
  const bad = await run(handler, fakeReq('POST', '/api/v1/business/payments', { headers: { ...BIZ, 'idempotency-key': 'a b!' }, body: {} }));
  assert.equal(bad.statusCode, 400); assert.equal(json(bad).error.code, 'bad_idempotency_key');
  const ct = await run(handler, fakeReq('POST', '/api/v1/business/payments', { headers: { ...BIZ, 'content-type': 'text/plain' }, body: {} }));
  assert.equal(ct.statusCode, 415);
  const arr = await run(handler, fakeReq('POST', '/api/v1/business/payments', { headers: BIZ, body: [1, 2] }));
  assert.equal(arr.statusCode, 400);
  const str = await run(handler, fakeReq('POST', '/api/v1/business/payments', { headers: BIZ, body: '{not json' }));
  assert.equal(str.statusCode, 400); assert.equal(json(str).error.code, 'bad_json');
  const big = await run(handler, fakeReq('POST', '/api/v1/business/payments', { headers: BIZ, body: { note: 'x'.repeat(20000) } }));
  assert.equal(big.statusCode, 413);
  assert.equal(calls.length, 0);
});

test('POST to a data path never carries a body for GET and a GET never sends p_body or p_idem', async () => {
  const { handler, calls } = setup(() => ({ status: 200, headers: {}, body: { data: 1 } }));
  await run(handler, fakeReq('GET', '/api/v1/whoami', { headers: { authorization: 'Bearer era_test_k', 'idempotency-key': 'order-1042-try1' } }));
  assert.ok(!('p_body' in calls[0].args) && !('p_idem' in calls[0].args));
});

test('the 422 database state (ERA22) maps to 422', () => {
  assert.equal(mapPgError({ pg: { code: 'ERA22', message: 'verify the business first' } }).status, 422);
});

test('CORS lets browsers send the Idempotency-Key header and read the replay header', async () => {
  const res = await run(setup(() => ({})).handler, fakeReq('OPTIONS', '/api/v1/business/payments'));
  assert.match(res.headers['access-control-allow-headers'], /Idempotency-Key/);
  assert.match(res.headers['access-control-expose-headers'], /X-Idempotent-Replay/);
});

test('buildOpenApi documents POST endpoints with a request body, Idempotency-Key and 201/409/422', () => {
  const doc = buildOpenApi({
    apps: [{ id: 'business', name: 'Your business', tagline: 't' }],
    endpoints: [
      { id: 'business.payment_create', app: 'business', method: 'POST', path: '/business/payments', summary: 'Create', scope: 'payments:request', access: 'business',
        params: [], body: [{ name: 'amount', type: 'number', required: true, example: 45000, description: 'Amount' }, { name: 'stops', type: 'array', required: false, description: 's' }] },
      { id: 'business.payments', app: 'business', method: 'GET', path: '/business/payments', summary: 'List', scope: 'payments:read', access: 'business', params: [] },
    ],
  }, 'https://icanera.space');
  const post = doc.paths['/business/payments'].post;
  const get = doc.paths['/business/payments'].get;
  assert.ok(post && get, 'GET and POST live under the same path');
  assert.ok(post.parameters.some((p) => p.name === 'Idempotency-Key' && p.in === 'header' && p.required));
  assert.ok(!get.parameters.some((p) => p.name === 'Idempotency-Key'));
  assert.deepEqual(post.requestBody.content['application/json'].schema.required, ['amount']);
  assert.equal(post.requestBody.content['application/json'].schema.properties.amount.type, 'number');
  assert.equal(post.requestBody.content['application/json'].schema.properties.stops.type, 'array');
  for (const code of ['201', '409', '422']) assert.ok(post.responses[code], code);
  assert.match(post.description, /payments:request/);
  assert.match(doc.components.securitySchemes.bearerAuth.description, /era_biz_/);
});

test('HEAD answers like GET without a body', async () => {
  const { handler } = setup(() => ({ status: 200, headers: {}, body: { data: 1 } }));
  const res = await run(handler, fakeReq('HEAD', '/api/v1/whoami', { headers: { authorization: 'Bearer era_test_k' } }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, undefined);
});

test('?pretty=1 indents the JSON', async () => {
  const { handler } = setup(() => ({ status: 200, headers: {}, body: { data: { a: 1 } } }));
  const res = await run(handler, fakeReq('GET', '/api/v1/whoami?pretty=1', { headers: { authorization: 'Bearer era_test_k' } }));
  assert.match(res.body, /\n  "data"/);
});

test('an unreachable database is a generic 502 that leaks nothing', async () => {
  const { handler } = setup(() => new Error('connect ECONNREFUSED 10.0.0.5:5432 password=hunter2'));
  const res = await run(handler, fakeReq('GET', '/api/v1/whoami', { headers: { authorization: 'Bearer era_test_k' } }));
  assert.equal(res.statusCode, 502);
  assert.ok(!res.body.includes('hunter2') && !res.body.includes('10.0.0.5'));
});

test('a server without Supabase configuration answers 503 not_configured', async () => {
  const handler = createEraHandler({ env: {}, fetchImpl: async () => { throw new Error('no'); } });
  const res = await run(handler, fakeReq('GET', '/api/v1/ping'));
  assert.equal(res.statusCode, 503);
  assert.equal(json(res).error.code, 'not_configured');
});

test('the service-role key is preferred when present, the anon key otherwise', async () => {
  const a = setup(() => ({ status: 200, headers: {}, body: {} }), { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_ANON_KEY: 'anon' });
  await run(a.handler, fakeReq('GET', '/api/v1/whoami'));
  assert.equal(a.calls[0].headers.apikey, 'service');
  const b = setup(() => ({ status: 200, headers: {}, body: {} }), { VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_ANON_KEY: 'anon' });
  await run(b.handler, fakeReq('GET', '/api/v1/whoami'));
  assert.equal(b.calls[0].headers.apikey, 'anon');
});

test('/ping reports ready, disabled and not_installed', async () => {
  let h = setup(() => ({ enabled: true, signups_open: true, endpoints: 20, version: 'v1' })).handler;
  let body = json(await run(h, fakeReq('GET', '/api/v1/ping')));
  assert.equal(body.ok, true); assert.equal(body.state, 'ready'); assert.equal(body.endpoints, 20); assert.equal(typeof body.db_ms, 'number');
  h = setup(() => ({ enabled: false })).handler;
  body = json(await run(h, fakeReq('GET', '/api/v1/ping')));
  assert.equal(body.ok, false); assert.equal(body.state, 'disabled');
  h = setup(() => ({ __status: 404, json: { code: 'PGRST202', message: 'Could not find the function' } })).handler;
  const res = await run(h, fakeReq('GET', '/api/v1/ping'));
  assert.equal(res.statusCode, 200, 'ping itself still answers');
  assert.equal(json(res).state, 'not_installed');
});

test('/catalog and /openapi.json need no key and are cacheable', async () => {
  const { handler, calls } = setup(() => CATALOG);
  const cat = await run(handler, fakeReq('GET', '/api/v1/catalog'));
  assert.equal(cat.statusCode, 200);
  assert.match(cat.headers['cache-control'], /s-maxage=60/);
  assert.equal(json(cat).endpoints.length, 2);
  const oa = await run(handler, fakeReq('GET', '/api/v1/openapi.json', { headers: { 'x-forwarded-proto': 'https', host: 'bodagoera.icanera.space' } }));
  assert.equal(json(oa).servers[0].url, 'https://bodagoera.icanera.space/api/v1');
  assert.ok(calls.every((c) => c.fn === 'era_api_catalog'));
  assert.ok(calls.every((c) => !('p_key' in c.args)));
});

test('the root path greets a curious developer and points at /developers', async () => {
  const { handler, calls } = setup(() => { throw new Error('no db needed'); });
  const res = await run(handler, fakeReq('GET', '/api/v1'));
  assert.equal(res.statusCode, 200);
  assert.match(json(res).message, /\/developers/);
  assert.equal(calls.length, 0);
});

test('onboarding: register sends a hashed caller id and the honeypot, and returns 201', async () => {
  const { handler, calls } = setup(() => ({ client_id: 'c1', status: 'pending', ticket: 'era_tk_x', sandbox_key: { key: 'era_test_y', prefix: 'era_test_y' } }));
  const res = await run(handler, fakeReq('POST', '/api/v1/developers/register', {
    headers: { 'x-forwarded-for': '203.0.113.9' },
    body: { app_name: 'Farm Dash', email: 'ada@example.com', apps: ['farmagentera', 'icanera', 'a', 'b', 'c', 'd'], hp: '' , contact_name: 'Ada' },
  }));
  assert.equal(res.statusCode, 201);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(calls[0].fn, 'era_api_request_access');
  assert.equal(calls[0].args.p_contact_email, 'ada@example.com');
  assert.equal(calls[0].args.p_apps.length, 4, 'at most four apps are forwarded');
  assert.match(calls[0].args.p_ip_hash, /^[0-9a-f]{32}$/);
  assert.equal(json(res).ticket, 'era_tk_x');
});

test('onboarding: validation errors from the database come back as a clean 400', async () => {
  const { handler } = setup(() => ({ __status: 400, json: { code: '22023', message: 'Give your app a name (2 to 80 characters).' } }));
  const res = await run(handler, fakeReq('POST', '/api/v1/developers/register', { body: { app_name: 'x', email: 'a@b.dev', apps: ['icanera'] } }));
  assert.equal(res.statusCode, 400);
  assert.equal(json(res).error.message, 'Give your app a name (2 to 80 characters).');
});

test('onboarding: status and key take the ticket in the BODY, never the URL', async () => {
  const { handler, calls } = setup((fn) => (fn === 'era_api_ticket_status' ? { status: 'approved' } : { key: 'era_live_z', mode: 'live' }));
  const s = await run(handler, fakeReq('POST', '/api/v1/developers/status', { body: { ticket: 'era_tk_abc' } }));
  const k = await run(handler, fakeReq('POST', '/api/v1/developers/key', { body: { ticket: 'era_tk_abc', mode: 'live' } }));
  assert.equal(json(s).status, 'approved');
  assert.equal(json(k).key, 'era_live_z');
  assert.deepEqual(calls.map((c) => c.fn), ['era_api_ticket_status', 'era_api_issue_key']);
  assert.equal(calls[1].args.p_mode, 'live');
  assert.equal(k.headers['cache-control'], 'no-store', 'a key response is never cached');
  // a GET with a ticket in the URL is just an unknown data path: it never reaches the ticket functions
  const before = calls.length;
  await run(handler, fakeReq('GET', '/api/v1/developers/status?ticket=era_tk_abc'));
  assert.equal(calls[before].fn, 'era_api_call');
  assert.ok(!calls.slice(before).some((c) => c.fn === 'era_api_ticket_status' || c.fn === 'era_api_issue_key'));
});

test('onboarding: oversized or malformed bodies are refused before the database', async () => {
  const { handler, calls } = setup(() => { throw new Error('must not be called'); });
  let res = await run(handler, fakeReq('POST', '/api/v1/developers/register', { body: 'x'.repeat(40000) }));
  assert.equal(res.statusCode, 400);
  res = await run(handler, fakeReq('POST', '/api/v1/developers/register', { body: '{not json' }));
  assert.equal(res.statusCode, 400);
  assert.equal(calls.length, 0);
});

test('onboarding: over-long fields are cut down before they reach the database', async () => {
  const { handler, calls } = setup(() => ({ status: 'pending' }));
  await run(handler, fakeReq('POST', '/api/v1/developers/register', { body: { app_name: 'n'.repeat(5000), email: 'e'.repeat(5000), description: 'd'.repeat(5000), apps: ['icanera'] } }));
  assert.ok(calls[0].args.p_app_name.length <= 200 && calls[0].args.p_contact_email.length <= 300 && calls[0].args.p_description.length <= 1000);
});
