/**
 * Era API administration console. One framework-free module, mounted by the "API" tab of every developer panel
 * (ICANERA, BodaGoEra, SupermarketEra, FarmAgentEra), so all four manage the same API the same way.
 *
 *   const { mountEraApiAdmin } = await import('/developers/admin.js');
 *   const ui = mountEraApiAdmin(element, {
 *     rpc:    (fn, args) => supabase.rpc(fn, args),                                   // -> { data, error }
 *     signIn: (email, password) => supabase.auth.signInWithPassword({ email, password }),
 *     theme:  'auto',   // optional: 'light' | 'dark' to force; otherwise it follows the panel it sits in
 *   });
 *   ui.destroy();
 *
 * It renders inside a Shadow DOM, so no app stylesheet (several force colours on every button and input) can
 * leak in, and it picks up the host's developer-panel theme through the --dp-* variables when they exist.
 *
 * Security: this UI is a convenience. Every action is a database function that re-checks the caller is a REAL signed-in
 * administrator (see era_api_is_admin in supabase/migrations/20261005100000_era_api.sql). The developer panel's
 * own PIN is never used or accepted here.
 */

const APPS = {
  icanera: { name: 'ICANERA', color: '#8b5cf6' },
  bodagoera: { name: 'BodaGoEra', color: '#f59e0b' },
  supermarketera: { name: 'SupermarketEra', color: '#10b981' },
  farmagentera: { name: 'FarmAgentEra', color: '#84cc16' },
  platform: { name: 'Platform', color: '#38bdf8' },
  business: { name: 'Your business', color: '#f43f5e' },
};
const FOUR = ['icanera', 'bodagoera', 'supermarketera', 'farmagentera'];
// The Products tab: what we offer, in the order a visitor meets it. Taglines come from /developers/catalog.json when it loads.
const PRODUCTS = [
  { id: 'icanera', kind: 'app', tagline: 'Coin price, valuation, supply, FX, tax rules, chain fees and the public business directory.' },
  { id: 'bodagoera', kind: 'app', tagline: 'Stages, ports, journey and delivery quotes, and rider-card checks.' },
  { id: 'supermarketera', kind: 'app', tagline: 'Stores, a product catalogue across every category, clearance deals and barcode lookups.' },
  { id: 'farmagentera', kind: 'app', tagline: 'Marketplace listings, a produce price board and crop knowledge.' },
  { id: 'platform', kind: 'app', tagline: 'Who you are, how much you have left, and one call that sees the whole family.' },
  { id: 'business', kind: 'business', tagline: 'Private, owner-issued: payment requests, inventory with expiry tracking, CMMS and booking requests.' },
];
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

const CSS = `
:host{display:block;
  --c-card:var(--dp-card,#0f172a);--c-bd:var(--dp-card-bd,#1e293b);--c-inner:var(--dp-inner,#0b1224);--c-inner-bd:var(--dp-inner-bd,#1e293b);
  --c-input:var(--dp-input,#0b1224);--c-input-bd:var(--dp-input-bd,#334155);--c-txt:var(--dp-txt,#e2e8f0);--c-sub:var(--dp-sub,#94a3b8);--c-mute:var(--dp-muted,#64748b);
  --brand:#0ea5e9;--ok:#10b981;--warn:#f59e0b;--bad:#ef4444;--gold:#c9a24b;--serif:Georgia,"Iowan Old Style","Palatino Linotype",Palatino,"Times New Roman",serif;
  font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--c-txt)}
@media (prefers-color-scheme: light){:host{--c-card:var(--dp-card,#fff);--c-bd:var(--dp-card-bd,#e2e8f0);--c-inner:var(--dp-inner,#f8fafc);--c-inner-bd:var(--dp-inner-bd,#e2e8f0);--c-input:var(--dp-input,#fff);--c-input-bd:var(--dp-input-bd,#cbd5e1);--c-txt:var(--dp-txt,#0f172a);--c-sub:var(--dp-sub,#475569);--c-mute:var(--dp-muted,#64748b)}}
:host([data-era-theme=light]){--c-card:#fff;--c-bd:#e2e8f0;--c-inner:#f8fafc;--c-inner-bd:#e2e8f0;--c-input:#fff;--c-input-bd:#cbd5e1;--c-txt:#0f172a;--c-sub:#475569;--c-mute:#64748b}
:host([data-era-theme=dark]){--c-card:#0f172a;--c-bd:#1e293b;--c-inner:#0b1224;--c-inner-bd:#1e293b;--c-input:#0b1224;--c-input-bd:#334155;--c-txt:#e2e8f0;--c-sub:#94a3b8;--c-mute:#64748b}
*{box-sizing:border-box}
.wrap{display:grid;gap:14px}
.card{background:var(--c-card);border:1px solid var(--c-bd);border-radius:16px;padding:16px}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center} .between{justify-content:space-between}
.grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:12px} .grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
@media(max-width:760px){.grid4,.grid2{grid-template-columns:1fr 1fr}} @media(max-width:480px){.grid4,.grid2{grid-template-columns:1fr}}
h2,h3,h4,p{margin:0} h3{font-size:16px;font-weight:700} h4{font-size:14px;font-weight:700} h2,h3,h4,.big,.serif{font-family:var(--serif)}
.lab{font:700 10px/1.2 system-ui;letter-spacing:.12em;text-transform:uppercase;color:var(--c-mute)}
.big{font-size:24px;font-weight:900;margin-top:4px} .sub{font-size:11.5px;color:var(--c-sub)} .mute{color:var(--c-mute);font-size:12px}
.btn{font:700 12px system-ui;color:var(--c-txt);background:transparent;border:1px solid var(--c-input-bd);border-radius:11px;padding:7px 12px;cursor:pointer;display:inline-flex;gap:6px;align-items:center}
.btn:hover{border-color:var(--brand)} .btn[disabled]{opacity:.4;cursor:not-allowed}
.btn.primary{background:linear-gradient(135deg,#06b6d4,#0284c7);border-color:transparent;color:#fff}
.btn.green{background:linear-gradient(135deg,#10b981,#059669);border-color:transparent;color:#fff}
.btn.danger{color:var(--bad);border-color:#ef444488;background:linear-gradient(rgba(239,68,68,.1),rgba(239,68,68,.1))}
.btn.sm{padding:4px 9px;font-size:11px;border-radius:9px}
input,select,textarea{font:13px system-ui;color:var(--c-txt);background:var(--c-input);border:1px solid var(--c-input-bd);border-radius:10px;padding:8px 10px;width:100%;outline:none}
input:focus,select:focus,textarea:focus{border-color:var(--brand)} input[type=number]{width:96px} input[type=checkbox]{width:auto}
label.f{display:block} label.f>span{display:block;margin-bottom:4px} label.chk{display:inline-flex;gap:6px;align-items:center;border:1px solid var(--c-inner-bd);border-radius:10px;padding:5px 10px;cursor:pointer}
.tabs{display:flex;gap:2px;flex-wrap:wrap;border-bottom:1px solid var(--c-bd);padding:0 4px}
.tab{font:600 13px var(--serif);letter-spacing:.02em;color:var(--c-sub);background:transparent;border:1px solid transparent;border-bottom:0;border-radius:9px 9px 0 0;margin-bottom:-1px;padding:9px 16px;cursor:pointer;display:inline-flex;gap:6px;align-items:center}
.tab:hover{color:var(--c-txt)}
.tab[aria-selected=true]{color:var(--c-txt);background:var(--c-card);border-color:var(--c-bd);box-shadow:inset 0 2px 0 var(--gold)}
.tab:focus-visible,.mrow:focus-visible,.plate-h:focus-visible,.chip:focus-visible{outline:2px solid var(--brand);outline-offset:-2px}
.n{font:800 10px system-ui;border-radius:99px;padding:1px 6px;background:var(--warn);color:#111} .n.red{background:var(--bad);color:#fff}
.pill{display:inline-flex;gap:5px;align-items:center;font:700 10px system-ui;letter-spacing:.05em;text-transform:uppercase;border:1px solid var(--c-inner-bd);border-radius:99px;padding:2px 8px;color:var(--c-sub)}
.pill.ok{color:var(--ok);border-color:#10b98155} .pill.warn{color:var(--warn);border-color:#f59e0b55} .pill.bad{color:var(--bad);border-color:#ef444455}
.dot{width:8px;height:8px;border-radius:50%;display:inline-block}
.msg{border:1px solid;border-radius:12px;padding:10px 12px;font-size:12.5px} .msg.ok{border-color:#10b98155;color:var(--ok)} .msg.bad{border-color:#ef444455;color:var(--bad)} .msg.warn{border-color:#f59e0b55;color:var(--warn)}
.item{border:1px solid var(--c-inner-bd);background:var(--c-inner);border-radius:14px;padding:14px;display:grid;gap:10px}
table{width:100%;border-collapse:collapse;font-size:12.5px} th{text-align:left;font:700 10px system-ui;letter-spacing:.1em;text-transform:uppercase;color:var(--c-mute);padding:6px 8px;border-bottom:1px solid var(--c-bd)}
td{padding:7px 8px;border-bottom:1px solid var(--c-inner-bd);vertical-align:top} .scroll{overflow-x:auto} code{font:12px ui-monospace,Menlo,monospace}
.sw{position:relative;width:42px;height:24px;border-radius:99px;border:1px solid #64748bb3;background-image:linear-gradient(rgba(100,116,139,.55),rgba(100,116,139,.55));cursor:pointer;padding:0;flex:none}
.sw[aria-checked=true]{background-image:linear-gradient(#10b981,#10b981);border-color:#059669}
.sw i{position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;transition:left .15s} .sw[aria-checked=true] i{left:20px}
pre{margin:0;padding:10px;border:1px solid var(--c-inner-bd);border-radius:10px;background:var(--c-inner);overflow:auto;font-size:11.5px}
.empty{padding:26px;text-align:center;color:var(--c-mute);font-size:12.5px}

/* ---- Products: the catalogue ---- */
.mast{position:relative;text-align:center;padding:26px 18px 20px;background:var(--c-card);border:1px solid var(--c-bd);border-radius:6px}
.mast::before{content:"";position:absolute;inset:5px;border:1px solid var(--c-inner-bd);border-radius:3px;pointer-events:none}
.orn{display:flex;align-items:center;gap:12px;color:var(--gold);font-size:11px;max-width:340px;margin:0 auto 10px}
.orn::before,.orn::after{content:"";flex:1;height:1px;background:linear-gradient(90deg,transparent,var(--gold))} .orn::after{transform:scaleX(-1)}
.mast h2{font-size:30px;font-weight:400;letter-spacing:.03em;line-height:1.15}
.mast .est{font:italic 13.5px var(--serif);color:var(--c-sub);margin-top:6px}
.ledger{display:flex;justify-content:center;flex-wrap:wrap;margin-top:18px;border-top:1px solid var(--c-inner-bd);padding-top:14px}
.ledger>div{padding:0 22px;border-left:1px solid var(--c-inner-bd);min-width:96px} .ledger>div:first-child{border-left:0}
.ledger b{display:block;font:400 26px var(--serif)} .ledger span{font:700 9.5px system-ui;letter-spacing:.14em;text-transform:uppercase;color:var(--c-mute)}
.bar{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.bar input[type=search]{flex:1;min-width:200px;border-radius:99px;padding:8px 14px}
.chip{font:600 12px var(--serif);color:var(--c-sub);background:transparent;border:1px solid var(--c-inner-bd);border-radius:99px;padding:6px 13px;cursor:pointer}
.chip[aria-pressed=true]{color:var(--c-txt);border-color:var(--gold);background:linear-gradient(rgba(201,162,75,.14),rgba(201,162,75,.14))}
.plate{background:var(--c-card);border:1px solid var(--c-bd);border-top:3px solid var(--ac);border-radius:4px;overflow:hidden}
.plate-h{all:unset;box-sizing:border-box;display:flex;width:100%;align-items:center;gap:16px;padding:16px 18px;cursor:pointer}
.plate-h:hover{background:var(--c-inner)}
.num{font:italic 400 28px var(--serif);color:var(--ac);min-width:46px;text-align:center;padding-right:16px;border-right:1px solid var(--c-inner-bd)}
.ph{flex:1;min-width:0;display:grid;gap:2px} .pt{font:400 21px var(--serif);letter-spacing:.02em} .ptag{font:italic 13px/1.4 var(--serif);color:var(--c-sub)}
.pc{text-align:right;white-space:nowrap;display:grid;gap:4px;justify-items:end} .pc small{font-size:11.5px;color:var(--c-sub)}
.chev{color:var(--c-mute);transition:transform .15s;display:inline-block} [aria-expanded=true]>.chev{transform:rotate(90deg)}
.menu{list-style:none;margin:0;padding:4px 0 10px;border-top:1px solid var(--c-inner-bd)}
.menu li+li{border-top:1px dashed var(--c-inner-bd)}
.mrow{all:unset;box-sizing:border-box;display:flex;align-items:baseline;gap:9px;width:100%;padding:9px 18px 9px 80px;cursor:pointer}
.mrow:hover{background:var(--c-inner)}
.mname{font:400 15.5px var(--serif)} .off .mname{color:var(--c-mute);text-decoration:line-through}
.lead{flex:1;min-width:20px;border-bottom:2px dotted var(--c-input-bd);transform:translateY(-4px);opacity:.7}
.mpath{font:11.5px ui-monospace,Menlo,monospace;color:var(--c-sub)}
.detail{padding:4px 18px 16px 80px;display:grid;gap:10px}
.detail p{font:italic 14px/1.55 var(--serif);color:var(--c-sub);max-width:70ch}
.facts{display:flex;flex-wrap:wrap;gap:6px 18px} .facts div{font-size:12px;color:var(--c-sub)} .facts b{color:var(--c-txt)}
@media(max-width:620px){.mrow,.detail{padding-left:18px}.mrow{flex-wrap:wrap}.lead{display:none}.plate-h{gap:12px;padding:14px}.num{min-width:34px;padding-right:12px;font-size:22px}.pc{display:none}.ledger>div{padding:0 12px}}
.colophon{text-align:center;font:italic 12.5px var(--serif);color:var(--c-mute);padding:6px 0 2px}
`;

const NOT_INSTALLED = /PGRST202|42883|Could not find the function|does not exist/i;

export function mountEraApiAdmin(host, { rpc, signIn, theme } = {}) {
  let forced = theme === 'light' || theme === 'dark' ? theme : null;
  const root = host.shadowRoot || host.attachShadow({ mode: 'open' });
  root.textContent = '';
  const style = document.createElement('style'); style.textContent = CSS; root.append(style);
  const app = document.createElement('div'); app.className = 'wrap'; root.append(app);
  let dead = false;
  const S = { gate: 'checking', ov: null, tab: 'requests', pending: [], clients: [], status: '', endpoints: [], calls: [], callsFor: null, msg: null, busy: null, openClient: null, chain: null, cat: null, q: '', pf: 'all', closed: new Set(), openRow: new Set(), countries: {} };

  // ---------------------------------------------------------------- theme
  // A host that publishes the developer-panel variables (--dp-*) is followed as-is. Otherwise sample the panel's
  // background and pick light or dark so the console matches whichever panel it is embedded in.
  function applyTheme() {
    if (forced) { host.setAttribute('data-era-theme', forced); return; }
    if (getComputedStyle(host).getPropertyValue('--dp-card').trim()) { host.removeAttribute('data-era-theme'); return; }
    let lum = null;
    for (let el = host; el; el = el.parentElement) {
      const m = getComputedStyle(el).backgroundColor.match(/rgba?\(([^)]+)\)/);
      if (!m) continue;
      const [r, g, b, a = 1] = m[1].split(',').map(parseFloat);
      if (a > 0.5) { lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; break; }
    }
    if (lum == null) { host.removeAttribute('data-era-theme'); return; }
    host.setAttribute('data-era-theme', lum < 0.5 ? 'dark' : 'light');
  }

  // ---------------------------------------------------------------- helpers
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v == null) continue;
      if (k === 'class') el.className = v; else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (k === 'checked' || k === 'disabled' || k === 'selected') { if (v) el[k] = true; el.setAttribute(k, ''); }
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  }
  const fmt = (n) => (n == null ? '–' : Number(n).toLocaleString());
  const when = (d) => (d ? new Date(d).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'never');
  let flashTimer;
  function flash(text, bad) { S.msg = { text, bad: !!bad }; render(); clearTimeout(flashTimer); flashTimer = setTimeout(() => { S.msg = null; if (!dead) render(); }, bad ? 7000 : 3000); }
  async function call(fn, args = {}) {
    const { data, error } = await rpc(fn, args);
    if (error) { const e = new Error(error.message || 'Request failed'); e.code = error.code; e.notInstalled = NOT_INSTALLED.test(`${error.code} ${error.message}`); throw e; }
    return data;
  }
  async function act(key, fn, ok) {
    S.busy = key; render();
    try { const out = await fn(); S.busy = null; if (ok) flash(typeof ok === 'function' ? ok(out) : ok); await loadAll(); return true; }
    catch (e) { S.busy = null; flash(e.message, true); return false; }
  }

  // ---------------------------------------------------------------- loading
  async function gate() {
    S.gate = 'checking'; render();
    try {
      const ok = await call('era_api_is_admin');
      S.gate = ok === true ? 'ok' : 'locked';
    } catch (e) { S.gate = e.notInstalled ? 'missing' : 'locked'; }
    if (S.gate === 'ok') await loadAll(); else render();
  }
  async function loadAll() {
    try {
      const [ov, pending, clients, endpoints, calls] = await Promise.all([
        call('era_api_admin_overview'), call('era_api_admin_list_clients', { p_status: 'pending', p_limit: 100 }),
        call('era_api_admin_list_clients', { p_status: S.status || null, p_limit: 200 }), call('era_api_admin_list_endpoints'),
        call('era_api_admin_recent_calls', { p_client_id: S.callsFor, p_limit: 100 }),
      ]);
      S.ov = ov; S.pending = pending || []; S.clients = clients || []; S.endpoints = endpoints || []; S.calls = calls || [];
    } catch (e) { if (!dead) { S.msg = { text: e.message, bad: true }; } }
    // The business layer (owner keys, payment requests, booking requests, gas) is a second pair of migrations.
    // Until it is applied the rest of the console works and this tab explains what to run.
    try { S.chain = await call('era_api_admin_get_chain'); } catch (e) { S.chain = e.notInstalled ? null : (S.chain || null); }
    render();
  }

  // ---------------------------------------------------------------- pieces
  const tile = (label, value, sub, color) => h('div', { class: 'card' }, h('div', { class: 'lab' }, label), h('div', { class: 'big', style: color ? `color:${color}` : '' }, value), sub ? h('div', { class: 'sub' }, sub) : null);
  function sparkline(vals) {
    const w = 220, hgt = 38, max = Math.max(1, ...vals), pts = vals.map((v, i) => `${(i / (vals.length - 1 || 1)) * w},${hgt - 3 - (v / max) * (hgt - 8)}`).join(' ');
    const NS = 'http://www.w3.org/2000/svg'; const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', `0 0 ${w} ${hgt}`); svg.setAttribute('width', '100%'); svg.setAttribute('height', hgt); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Calls per hour, last 24 hours');
    const pl = document.createElementNS(NS, 'polyline'); pl.setAttribute('points', pts); pl.setAttribute('fill', 'none'); pl.setAttribute('stroke', '#0ea5e9'); pl.setAttribute('stroke-width', '2'); pl.setAttribute('stroke-linejoin', 'round'); svg.append(pl); return svg;
  }
  const toggle = (label, hint, checked, onChange) => h('div', { class: 'row between', style: 'gap:12px;align-items:flex-start' },
    h('div', {}, h('div', { style: 'font-weight:700;font-size:13px' }, label), hint ? h('div', { class: 'mute' }, hint) : null),
    h('button', { class: 'sw', type: 'button', role: 'switch', 'aria-checked': String(checked), 'aria-label': label, onclick: () => onChange(!checked) }, h('i')));
  const appChips = (list) => h('span', { class: 'row', style: 'gap:4px' }, ...(list || []).map((a) => h('span', { class: 'pill' }, h('i', { class: 'dot', style: `background:${(APPS[a] || {}).color || '#888'}` }), (APPS[a] || { name: a }).name)));
  const flagOf = (cc) => (/^[A-Z]{2}$/.test(cc || '') ? String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : '');
  const where = (c) => (c.country_code ? h('span', { class: 'pill', title: 'Country the developer registered from' }, `${flagOf(c.country_code)} ${(S.countries[c.country_code] || {}).name || c.country_code}`) : null);
  const acctPill = (c) => (c.kind === 'developer' ? h('span', { class: 'pill', title: c.has_account ? 'Signed in with a developer account' : 'Registered without an account (ticket)' }, c.has_account ? '👤 account' : '🎟 ticket') : null);
  const statusPill = (s) => h('span', { class: 'pill ' + (s === 'approved' ? 'ok' : s === 'pending' ? 'warn' : 'bad') }, s);

  // ---------------------------------------------------------------- gate screens
  function lockedView() {
    const email = h('input', { type: 'email', autocomplete: 'username', placeholder: 'you@company.com', 'aria-label': 'Email' });
    const pass = h('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Password', 'aria-label': 'Password' });
    const err = h('p', { class: 'msg bad', role: 'alert', style: 'display:none' });
    const note = h('div', { style: 'display:none' });
    const form = h('form', { class: 'item', onsubmit: async (e) => {
      e.preventDefault(); err.style.display = 'none'; note.style.display = 'none';
      try {
        const { error } = await signIn(email.value.trim(), pass.value);
        if (error) throw new Error(/invalid login/i.test(error.message || '') ? 'That email or password is not right.' : error.message);
        pass.value = '';
        let ok = false; try { ok = (await call('era_api_is_admin')) === true; } catch { /* below */ }
        if (ok) { S.gate = 'ok'; await loadAll(); return; }
        const sql = `INSERT INTO public.era_api_admins (user_id, note)\nSELECT id, 'founder' FROM auth.users WHERE lower(email) = lower('${email.value.replace(/'/g, '')}');`;
        note.style.display = 'block'; note.textContent = '';
        note.append(h('p', { class: 'msg warn' }, 'That account is signed in but is not an API administrator. Platform developers and franchise admins are admins automatically; anyone else can be added once, in the Supabase SQL editor:'), h('pre', {}, sql));
      } catch (ex) { err.textContent = ex.message; err.style.display = 'block'; }
    } }, h('label', { class: 'f' }, h('span', { class: 'lab' }, 'Email'), email), h('label', { class: 'f' }, h('span', { class: 'lab' }, 'Password'), pass), err, h('div', {}, h('button', { class: 'btn primary', type: 'submit' }, 'Sign in')), note);
    return h('div', { class: 'card' }, h('h3', {}, '🔒 Sign in with your own account'),
      h('p', { class: 'sub', style: 'margin:8px 0 14px' }, 'This tab approves developers, issues access and can switch the whole API off. The developer panel PIN is built into the public app, so it cannot protect that. Use the account of a platform developer (or an API admin).'), form);
  }

  // ---------------------------------------------------------------- tabs
  function requestsTab() {
    if (!S.pending.length) return h('div', { class: 'card empty' }, '🎉 No applications waiting. New ones from the developer page show up here.');
    return h('div', { class: 'wrap' }, ...S.pending.map((c) => {
      const apps = FOUR.map((a) => h('label', { class: 'chk' }, h('input', { type: 'checkbox', value: a, checked: (c.requested_apps || []).includes(a) }), h('i', { class: 'dot', style: `background:${APPS[a].color}` }), APPS[a].name));
      const rate = h('input', { type: 'number', min: 1, max: 6000, value: c.live_rate_per_min, 'aria-label': 'Requests per minute' });
      const quota = h('input', { type: 'number', min: 1, max: 1000000, value: c.live_daily_quota, 'aria-label': 'Requests per day', style: 'width:120px' });
      const note = h('input', { type: 'text', placeholder: 'Note for the developer (optional)', maxlength: 200, 'aria-label': 'Note' });
      const picked = () => apps.map((l) => l.querySelector('input')).filter((i) => i.checked).map((i) => i.value);
      return h('div', { class: 'item' },
        h('div', { class: 'row between' }, h('div', {}, h('h4', {}, c.app_name), h('div', { class: 'sub' }, `${c.contact_name || 'Unnamed'} · ${c.contact_email} · ${when(c.created_at)}`)), h('div', { class: 'row' }, where(c), acctPill(c), statusPill(c.status))),
        c.description ? h('p', { class: 'sub', style: 'white-space:pre-wrap' }, c.description) : null,
        c.website ? h('div', { class: 'sub' }, 'Website: ', h('a', { href: c.website, target: '_blank', rel: 'noopener noreferrer nofollow', style: 'color:var(--brand)' }, c.website)) : null,
        h('div', {}, h('div', { class: 'lab', style: 'margin-bottom:6px' }, 'Approve live access to'), h('div', { class: 'row' }, ...apps)),
        h('div', { class: 'row' }, h('label', { class: 'f' }, h('span', { class: 'lab' }, 'per minute'), rate), h('label', { class: 'f' }, h('span', { class: 'lab' }, 'per day'), quota), h('label', { class: 'f', style: 'flex:1;min-width:180px' }, h('span', { class: 'lab' }, 'note'), note)),
        h('div', { class: 'row' },
          h('button', { class: 'btn green', type: 'button', disabled: S.busy === 'a' + c.id, onclick: () => { const g = picked(); if (!g.length) return flash('Pick at least one app to approve.', true); act('a' + c.id, () => call('era_api_admin_review', { p_client_id: c.id, p_decision: 'approve', p_granted_apps: g, p_rate_per_min: Number(rate.value) || null, p_daily_quota: Number(quota.value) || null, p_note: note.value || null }), `${c.app_name} approved.`); } }, '✓ Approve'),
          h('button', { class: 'btn danger', type: 'button', disabled: S.busy === 'r' + c.id, onclick: () => { if (confirm(`Reject ${c.app_name}? Their keys stop working.`)) act('r' + c.id, () => call('era_api_admin_review', { p_client_id: c.id, p_decision: 'reject', p_note: note.value || null }), `${c.app_name} rejected.`); } }, '✕ Reject'),
          h('span', { class: 'mute' }, 'Their sandbox key already works. Approving lets them reveal a live key for the apps ticked.')));
    }));
  }

  // The catalogue: every service we offer, grouped by product, laid out like the menu of a classic restaurant.
  function productsTab() {
    const cat = S.cat || {};
    const meta = new Map((cat.endpoints || []).map((e) => [e.id, e]));
    const tagOf = new Map((cat.apps || []).map((a) => [a.id, a.tagline]));
    const all = (S.endpoints.length ? S.endpoints : (cat.endpoints || []).map((e) => ({ ...e, enabled: true }))).map((e) => ({ ...(meta.get(e.id) || {}), ...e }));
    const live = all.filter((e) => e.enabled !== false).length;
    const stat = (n, label) => h('div', {}, h('b', {}, fmt(n)), h('span', {}, label));

    const list = h('div', { class: 'wrap' });
    const KINDS = [['all', 'All services'], ['app', 'Public data'], ['business', 'For businesses']];
    const chips = h('div', { class: 'row', role: 'group', 'aria-label': 'Filter products' });
    const search = h('input', { type: 'search', placeholder: 'Search services, paths or scopes…', 'aria-label': 'Search services', value: S.q, oninput: (e) => { S.q = e.target.value; paint(); } });
    const toggleAll = h('button', { class: 'btn sm', type: 'button' });

    function paint() {
      const q = S.q.trim().toLowerCase();
      chips.textContent = '';
      chips.append(...KINDS.map(([id, label]) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(S.pf === id), onclick: () => { S.pf = id; paint(); } }, label)));
      const hit = (e) => !q || [e.summary, e.path, e.description, e.scope, e.method, e.app].some((v) => v && String(v).toLowerCase().includes(q));
      const groups = PRODUCTS.map((p, i) => ({ p, i, rows: all.filter((e) => e.app === p.id && hit(e)) }))
        .filter((g) => g.rows.length && (S.pf === 'all' || g.p.kind === S.pf));
      const allOpen = groups.every((g) => !S.closed.has(g.p.id));
      toggleAll.textContent = allOpen ? 'Fold all' : 'Unfold all';
      toggleAll.onclick = () => { groups.forEach((g) => (allOpen ? S.closed.add(g.p.id) : S.closed.delete(g.p.id))); paint(); };
      list.textContent = '';
      if (!groups.length) { list.append(h('div', { class: 'card empty' }, all.length ? 'Nothing on the menu matches that. Try a shorter word.' : 'No services found yet. Run the API migrations, then refresh.')); return; }
      list.append(...groups.map(({ p, i, rows }) => {
        const color = (APPS[p.id] || {}).color || '#888';
        const open = !!q || !S.closed.has(p.id);
        const off = rows.filter((e) => e.enabled === false).length;
        return h('section', { class: 'plate', style: `--ac:${color}` },
          h('button', { class: 'plate-h', type: 'button', 'aria-expanded': String(open), onclick: () => { if (S.closed.has(p.id)) S.closed.delete(p.id); else S.closed.add(p.id); paint(); } },
            h('span', { class: 'num', 'aria-hidden': 'true' }, ROMAN[i] || i + 1),
            h('span', { class: 'ph' }, h('span', { class: 'pt' }, (APPS[p.id] || { name: p.id }).name), h('span', { class: 'ptag' }, tagOf.get(p.id) || p.tagline)),
            h('span', { class: 'pc' },
              h('span', { class: 'pill ' + (off === 0 ? 'ok' : off === rows.length ? 'bad' : 'warn') }, off === 0 ? 'All live' : off === rows.length ? 'Switched off' : `${off} off`),
              h('small', {}, `${rows.length} service${rows.length === 1 ? '' : 's'} · ${p.kind === 'business' ? 'owner key' : 'approved key'}`)),
            h('span', { class: 'chev', 'aria-hidden': 'true' }, '›')),
          open ? h('ul', { class: 'menu' }, ...rows.map(row)) : null);
      }));
    }

    function row(e) {
      const isOpen = S.openRow.has(e.id);
      const url = location.origin + '/api/v1' + (e.example_path || e.path);
      const copy = h('button', { class: 'btn sm', type: 'button', onclick: () => {
        const done = (t) => { copy.textContent = t; setTimeout(() => { copy.textContent = 'Copy URL'; }, 1600); };
        if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => done('Copied ✓'), () => done('Select & copy by hand')); else done('Select & copy by hand');
      } }, 'Copy URL');
      return h('li', { class: e.enabled === false ? 'off' : '' },
        h('button', { class: 'mrow', type: 'button', 'aria-expanded': String(isOpen), onclick: () => { if (S.openRow.has(e.id)) S.openRow.delete(e.id); else S.openRow.add(e.id); paint(); } },
          h('span', { class: 'mname' }, e.summary || e.path), e.enabled === false ? h('span', { class: 'pill bad' }, 'off') : null, h('i', { class: 'lead' }),
          e.method ? h('span', { class: 'pill' }, e.method) : null, h('span', { class: 'mpath' }, e.path)),
        isOpen ? h('div', { class: 'detail' },
          e.description ? h('p', {}, e.description) : null,
          h('div', { class: 'facts' },
            e.access ? h('div', {}, 'Access: ', h('b', {}, e.access === 'business' ? `owner key · ${e.scope || 'any scope'}` : 'any key approved for this app')) : null,
            h('div', {}, 'Cached: ', h('b', {}, e.cache_seconds ? `${e.cache_seconds}s` : 'never')),
            h('div', {}, 'Last 24h: ', h('b', {}, `${fmt(e.calls_24h)} calls`), e.errors_24h > 0 ? h('b', { style: 'color:var(--bad)' }, ` · ${fmt(e.errors_24h)} errors`) : null)),
          h('pre', {}, `${e.method || 'GET'} ${url}`),
          h('div', { class: 'row' }, copy, h('a', { class: 'btn sm', href: '/developers/#playground', target: '_blank', rel: 'noopener', style: 'text-decoration:none' }, 'Try it live ↗'))) : null);
    }

    paint();
    return h('div', { class: 'wrap' },
      h('div', { class: 'mast' },
        h('div', { class: 'orn', 'aria-hidden': 'true' }, '◆'),
        h('h2', {}, 'The Era Catalogue'),
        h('p', { class: 'est' }, 'Every service we offer, from one key. Public data, and private tools for the businesses that run on it.'),
        h('div', { class: 'ledger' }, stat(PRODUCTS.length, 'Products'), stat(all.length, 'Services'), stat(live, 'Switched on'), stat(all.reduce((n, e) => n + (e.calls_24h || 0), 0), 'Calls · 24h'))),
      h('div', { class: 'bar' }, search, chips, toggleAll),
      list,
      h('p', { class: 'colophon' }, 'Switch a single service off, or tune its cache, in the Endpoints tab.'));
  }

  function appsTab() {
    const sel = h('select', { 'aria-label': 'Filter by status', style: 'width:auto', onchange: (e) => { S.status = e.target.value; loadAll(); } },
      ...[['', 'All apps'], ['pending', 'Pending'], ['approved', 'Approved'], ['suspended', 'Suspended'], ['rejected', 'Rejected']].map(([v, l]) => h('option', { value: v, selected: S.status === v }, l)));
    const list = S.clients.filter((c) => !c.is_system);
    return h('div', { class: 'wrap' }, h('div', { class: 'row between' }, sel, h('span', { class: 'mute' }, `${list.length} app(s)`)),
      !list.length ? h('div', { class: 'card empty' }, 'Nothing here yet.') : null,
      ...list.map((c) => h('div', { class: 'item' },
        h('div', { class: 'row between' }, h('div', {}, h('h4', {}, c.app_name), h('div', { class: 'sub' }, `${c.contact_email} · registered ${when(c.created_at)}`)), h('div', { class: 'row' }, where(c), acctPill(c), statusPill(c.status), h('span', { class: 'pill' }, `${fmt(c.calls_24h)} calls / 24h`))),
        h('div', { class: 'row' }, c.status === 'approved' ? appChips(c.granted_apps) : appChips(c.requested_apps), c.status === 'approved' ? h('span', { class: 'sub' }, `${fmt(c.live_rate_per_min)}/min · ${fmt(c.live_daily_quota)}/day`) : null),
        (c.keys || []).length ? h('div', { class: 'scroll' }, h('table', {}, h('thead', {}, h('tr', {}, ...['Key', 'Mode', 'Created', 'Last used', ''].map((x) => h('th', {}, x)))),
          h('tbody', {}, ...c.keys.map((k) => h('tr', {}, h('td', {}, h('code', {}, k.prefix + '…')), h('td', {}, k.mode), h('td', {}, when(k.created_at)), h('td', {}, when(k.last_used_at)),
            h('td', {}, k.revoked_at ? h('span', { class: 'pill' }, 'revoked' + (k.revoked_reason ? ': ' + k.revoked_reason : '')) : h('button', { class: 'btn sm danger', type: 'button', onclick: () => { if (confirm(`Revoke ${k.prefix}…? It stops working immediately.`)) act('k' + k.id, () => call('era_api_admin_revoke_key', { p_key_id: k.id, p_reason: 'revoked by an administrator' }), 'Key revoked.'); } }, 'Revoke'))))))) : null,
        h('div', { class: 'row' },
          c.status === 'approved' ? h('button', { class: 'btn sm danger', type: 'button', onclick: () => { if (confirm(`Suspend ${c.app_name}? All its keys stop working until you reinstate it.`)) act('s' + c.id, () => call('era_api_admin_review', { p_client_id: c.id, p_decision: 'suspend', p_note: 'suspended' }), `${c.app_name} suspended.`); } }, 'Suspend') : null,
          c.status === 'suspended' || c.status === 'rejected' ? h('button', { class: 'btn sm green', type: 'button', onclick: () => act('i' + c.id, () => call('era_api_admin_review', { p_client_id: c.id, p_decision: 'reinstate' }), `${c.app_name} reinstated.`) }, 'Reinstate') : null,
          h('button', { class: 'btn sm', type: 'button', onclick: () => { S.callsFor = c.id; S.tab = 'activity'; loadAll(); } }, 'See its calls')))));
  }

  function endpointsTab() {
    return h('div', { class: 'card' }, h('p', { class: 'sub', style: 'margin-bottom:10px' }, 'Switch a single endpoint off the moment you are not comfortable exposing it. Callers get a clear 503 and it disappears from the public docs.'),
      h('div', { class: 'scroll' }, h('table', {}, h('thead', {}, h('tr', {}, ...['On', 'Endpoint', 'App', 'Cache s', '24h', 'Errors'].map((x) => h('th', {}, x)))),
        h('tbody', {}, ...S.endpoints.map((e) => {
          const cache = h('input', { type: 'number', min: 0, max: 3600, value: e.cache_seconds, 'aria-label': 'Cache seconds for ' + e.path, style: 'width:78px', onchange: () => act('c' + e.id, () => call('era_api_admin_set_endpoint', { p_id: e.id, p_cache_seconds: Number(cache.value) }), 'Cache time saved.') });
          return h('tr', {}, h('td', {}, h('button', { class: 'sw', type: 'button', role: 'switch', 'aria-checked': String(e.enabled), 'aria-label': (e.enabled ? 'Switch off ' : 'Switch on ') + e.path, onclick: () => act('e' + e.id, () => call('era_api_admin_set_endpoint', { p_id: e.id, p_enabled: !e.enabled }), e.enabled ? `${e.path} switched off.` : `${e.path} switched on.`) }, h('i'))),
            h('td', {}, h('code', {}, e.path), h('div', { class: 'mute' }, e.summary)), h('td', {}, appChips([e.app])), h('td', {}, cache), h('td', {}, fmt(e.calls_24h)), h('td', { style: e.errors_24h > 0 ? 'color:var(--bad);font-weight:700' : '' }, fmt(e.errors_24h)));
        })))));
  }

  function businessTab() {
    if (!S.chain) {
      return h('div', { class: 'card' }, h('h4', {}, 'The business layer is not installed yet'),
        h('p', { class: 'sub', style: 'margin:8px 0 10px' }, 'Business keys, payment requests, inventory, CMMS, booking requests and gas estimates come from two more files. Run them in the SQL editor, in this order, then refresh:'),
        h('pre', {}, 'supabase/migrations/20261006100000_era_api_business.sql\nsupabase/migrations/20261006100100_era_api_business_endpoints.sql'));
    }
    const o = S.ov || {};
    return h('div', { style: 'display:grid;gap:14px' },
      h('div', { class: 'grid4' },
        tile('Business keys', fmt(o.business_keys_active), 'active, owner-issued'),
        tile('Payment requests · 24h', fmt(o.payment_requests_24h), 'created through the API. None moves money.'),
        tile('Booking links · 24h', fmt(o.booking_requests_24h), 'ride and delivery requests')),
      h('div', { class: 'card', style: 'display:grid;gap:14px' }, h('h4', {}, 'Business rules'),
        toggle('Payment keys need a verified business', 'On: only businesses whose profile is verified can mint a live key that creates payment requests. Test keys are always allowed.', !!((S.ov || {}).settings || {}).require_verified_for_payments,
          (v) => act('sw4', () => call('era_api_admin_save_settings', { p_patch: { require_verified_for_payments: v } }), v ? 'Payment keys now need a verified business.' : 'Any owner may mint payment keys.'))),
      h('div', { class: 'card' }, h('h4', {}, 'Blockchain gas inputs'),
        h('p', { class: 'sub', style: 'margin:6px 0 10px' }, 'The gas endpoint estimates a network fee from these two numbers and says how old they are. We do not call out to a node, so keep them current. Leave both empty to make the endpoint answer “not configured”.'),
        h('div', { class: 'scroll' }, h('table', {}, h('thead', {}, h('tr', {}, ...['Network', 'Gas price (gwei)', 'Coin price (USD)', 'Source', 'Updated', ''].map((x) => h('th', {}, x)))),
          h('tbody', {}, ...S.chain.map((c) => {
            const g = h('input', { type: 'number', min: 0, max: 100000, step: 'any', value: c.gas_price_gwei ?? '', 'aria-label': 'Gas price in gwei for ' + c.network, style: 'width:110px' });
            const u = h('input', { type: 'number', min: 0, step: 'any', value: c.native_usd ?? '', 'aria-label': c.native_symbol + ' price in USD for ' + c.network, style: 'width:120px' });
            const src = h('input', { type: 'text', maxlength: 80, value: c.source || '', placeholder: 'where the numbers came from', 'aria-label': 'Source for ' + c.network, style: 'width:190px' });
            return h('tr', {}, h('td', {}, h('b', {}, c.network), h('div', { class: 'mute' }, c.native_symbol)), h('td', {}, g), h('td', {}, u), h('td', {}, src), h('td', { class: 'mute' }, when(c.updated_at)),
              h('td', {}, h('button', { class: 'btn sm primary', type: 'button', onclick: () => act('chain' + c.network, () => call('era_api_admin_save_chain', { p_network: c.network, p_gas_price_gwei: g.value === '' ? null : Number(g.value), p_native_usd: u.value === '' ? null : Number(u.value), p_source: src.value }), c.network + ' saved.') }, 'Save')));
          }))))));
  }

  function activityTab() {
    const who = S.callsFor ? S.clients.concat(S.pending).find((c) => c.id === S.callsFor) : null;
    return h('div', { class: 'card' }, h('div', { class: 'row between', style: 'margin-bottom:10px' }, h('h4', {}, who ? `Calls by ${who.app_name}` : 'Latest calls (all apps)'), S.callsFor ? h('button', { class: 'btn sm', type: 'button', onclick: () => { S.callsFor = null; loadAll(); } }, 'Show all') : null),
      !S.calls.length ? h('div', { class: 'empty' }, 'No calls logged yet. (The public playground key is counted but not logged call by call.)') :
        h('div', { class: 'scroll' }, h('table', {}, h('thead', {}, h('tr', {}, ...['When', 'App', 'Mode', 'Endpoint', 'Status', 'ms', 'Error (private)'].map((x) => h('th', {}, x)))),
          h('tbody', {}, ...S.calls.map((c) => h('tr', {}, h('td', {}, when(c.at)), h('td', {}, c.app_name || '–'), h('td', {}, c.mode || '–'), h('td', {}, h('code', {}, c.endpoint || '(no route)')),
            h('td', {}, h('span', { class: 'pill ' + (c.status >= 500 ? 'bad' : c.status >= 400 ? 'warn' : 'ok') }, c.status)), h('td', {}, c.ms ?? '–'), h('td', { class: 'mute' }, c.error || '')))))));
  }

  // ---------------------------------------------------------------- main render
  function render() {
    if (dead) return;
    applyTheme();
    app.textContent = '';
    if (S.gate === 'checking') { app.append(h('div', { class: 'card empty' }, 'Checking access…')); return; }
    if (S.gate === 'missing') {
      app.append(h('div', { class: 'card' }, h('h3', {}, 'The developer API is not switched on for this server yet'),
        h('p', { class: 'sub', style: 'margin:8px 0 12px' }, 'Run these four files in the Supabase SQL editor (in this order), then check again. This can also appear if you are offline.'),
        h('pre', {}, 'supabase/migrations/20261005100000_era_api.sql\nsupabase/migrations/20261005100100_era_api_endpoints.sql\nsupabase/migrations/20261006100000_era_api_business.sql\nsupabase/migrations/20261006100100_era_api_business_endpoints.sql'),
        h('div', { style: 'margin-top:12px' }, h('button', { class: 'btn primary', type: 'button', onclick: gate }, 'Check again')))); return;
    }
    if (S.gate === 'locked') { app.append(lockedView()); return; }

    const o = S.ov || {}; const st = o.settings || {}; const cl = o.clients || {};
    app.append(...[
      h('div', { class: 'row between' }, h('div', {}, h('h3', {}, 'Developer API'), h('p', { class: 'sub' }, 'One API across ICANERA, BodaGoEra, SupermarketEra and FarmAgentEra. Approve developers, watch business keys, set gas inputs, switch things off.')),
        h('div', { class: 'row' }, h('a', { class: 'btn', href: '/developers', target: '_blank', rel: 'noopener', style: 'text-decoration:none' }, '↗ Public page'), h('button', { class: 'btn', type: 'button', onclick: loadAll }, '⟳ Refresh'))),
      S.msg ? h('div', { class: 'msg ' + (S.msg.bad ? 'bad' : 'ok'), role: S.msg.bad ? 'alert' : 'status' }, S.msg.text) : null,
      st.enabled === false ? h('div', { class: 'msg warn' }, '⚠ The API is switched OFF: every call answers 503 right now.') : null,
      h('div', { class: 'grid4' },
        tile('Waiting for you', fmt(cl.pending), 'applications to review', cl.pending > 0 ? 'var(--warn)' : ''),
        tile('Approved apps', fmt(cl.approved), `${fmt(o.keys_active)} developer keys · ${fmt(o.business_keys_active)} business keys`),
        h('div', { class: 'card' }, h('div', { class: 'lab' }, 'Calls · 24h'), h('div', { class: 'big' }, fmt(o.calls_24h)), o.hourly ? sparkline(o.hourly) : null),
        tile('Errors · 24h', fmt(o.errors_24h), `${fmt(o.limited_24h)} rate-limited`, o.errors_24h > 0 ? 'var(--bad)' : 'var(--ok)')),
      h('div', { class: 'card', style: 'display:grid;gap:14px' }, h('h4', {}, 'Switches'),
        toggle('API on', 'Master switch. Off = every call answers 503 at once.', st.enabled !== false, (v) => { if (!v && !confirm('Switch the WHOLE API off? Every developer will start getting 503s.')) return; act('sw1', () => call('era_api_admin_save_settings', { p_patch: { enabled: v } }), v ? 'API is on.' : 'API is off.'); }),
        toggle('Sandbox on', 'Fixture-data keys, including the public playground on /developers.', st.sandbox_enabled !== false, (v) => act('sw2', () => call('era_api_admin_save_settings', { p_patch: { sandbox_enabled: v } }), v ? 'Sandbox is on.' : 'Sandbox is off.')),
        toggle('Accept new sign-ups', 'The public “get a key” form. Off = the form politely says come back later.', st.signups_open !== false, (v) => act('sw3', () => call('era_api_admin_save_settings', { p_patch: { signups_open: v } }), v ? 'Sign-ups open.' : 'Sign-ups paused.')),
        (() => {
          const r = h('input', { type: 'number', min: 1, max: 6000, value: st.sandbox_rate_per_min, 'aria-label': 'Sandbox requests per minute' }); const d = h('input', { type: 'number', min: 1, max: 1000000, value: st.sandbox_daily_quota, style: 'width:120px', 'aria-label': 'Sandbox requests per day' });
          return h('div', { class: 'row' }, h('span', { class: 'sub' }, 'Sandbox keys:'), r, h('span', { class: 'sub' }, '/ min'), d, h('span', { class: 'sub' }, '/ day'), h('button', { class: 'btn sm', type: 'button', onclick: () => act('lim', () => call('era_api_admin_save_settings', { p_patch: { sandbox_rate_per_min: Number(r.value), sandbox_daily_quota: Number(d.value) } }), 'Sandbox limits saved.') }, 'Save'));
        })()),
      h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'API administration' },
        ...[['products', 'Products'], ['requests', 'Requests', cl.pending], ['apps', 'Apps & keys'], ['business', 'Business & gas'], ['endpoints', 'Endpoints'], ['activity', 'Activity', o.errors_24h, true]].map(([id, label, n, red]) =>
          h('button', { class: 'tab', role: 'tab', type: 'button', 'aria-selected': String(S.tab === id), onclick: () => { S.tab = id; render(); } }, label, n > 0 ? h('span', { class: 'n' + (red ? ' red' : '') }, n) : null))),
      S.tab === 'products' ? productsTab() : S.tab === 'requests' ? requestsTab() : S.tab === 'apps' ? appsTab() : S.tab === 'business' ? businessTab() : S.tab === 'endpoints' ? endpointsTab() : activityTab()].filter(Boolean));
  }

  // Descriptions, methods and scopes for the Products tab. Optional: without it the tab still lists what the database knows.
  fetch('/developers/catalog.json').then((r) => (r.ok ? r.json() : null)).then((c) => { if (c && !dead) { S.cat = c; if (S.gate === 'ok' && S.tab === 'products') render(); } }).catch(() => {});

  // Country names for the badges: the same list the developer page and the apps use. Optional.
  fetch('/developers/countries.json').then((r) => (r.ok ? r.json() : null)).then((c) => { if (c && !dead) { S.countries = Object.fromEntries((c.countries || []).map((x) => [x.code, x])); if (S.gate === 'ok') render(); } }).catch(() => {});

  gate();
  return {
    destroy() { dead = true; clearTimeout(flashTimer); root.textContent = ''; },
    refresh: loadAll,
    /** 'light' | 'dark' to force, anything else to follow the panel again. Call it when the panel's theme toggles. */
    setTheme(t) { forced = t === 'light' || t === 'dark' ? t : null; applyTheme(); },
  };
}
