// The rider homepage's smart decisions: which busy places to nudge a rider to add, and which work mode fits now.
// Run with: node --test tests/riderSmarts.test.js   (npm run test:rider-smarts)
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const { findUncoveredHotspots, recommendMode, shouldAutoSwitch, hourlyFromTimestamps, AUTO_COOLDOWN_MS, MANUAL_OVERRIDE_MS } =
  await import(pathToFileURL(path.join(root, 'mybodaguy', 'utils', 'riderSmarts.ts')).href);

const NTINDA = { lat: 0.3476, lng: 32.6165 };
const cell = (over = {}) => ({ ...NTINDA, label: 'Ntinda Shopping Centre, Ntinda Road, Kampala', requests: 9, customers: 7, recent: 4, lastAt: null, ...over });
const area = (over = {}) => ({ name: 'Kololo', latitude: 0.3333, longitude: 32.5891, is_home: false, ...over });
const flat = (n) => new Array(24).fill(n);
const at = (hour) => new Date(2026, 9, 26, hour, 0, 0);
const snapshot = (over = {}) => ({ cells: [], hourly: flat(0), pendingNearby: 0, ridersOnline: 0, ...over });
const base = { now: at(12), currentMode: 'normal', snapshot: null, ownHourly: null, ownPending: 0, ownActive: 0, kmFromHome: null };

test('a busy place the rider does not cover becomes a "hot" nudge named after the place', () => {
  const [h] = findUncoveredHotspots([cell()], [area()]);
  assert.equal(h.label, 'Ntinda Shopping Centre');
  assert.equal(h.level, 'hot');
  assert.equal(h.customers, 7);
});

test('a place within 3 km of an existing area is already covered', () => {
  assert.deepEqual(findUncoveredHotspots([cell()], [area({ latitude: 0.3500, longitude: 32.6200 })]), []);
});

test('an area covers a place by name even without coordinates', () => {
  assert.deepEqual(findUncoveredHotspots([cell()], [area({ name: 'Ntinda', latitude: null, longitude: null })]), []);
});

test('too little demand is not worth a nudge', () => {
  assert.deepEqual(findUncoveredHotspots([cell({ customers: 2 })], []), []);
  assert.deepEqual(findUncoveredHotspots([cell({ requests: 3 })], []), []);
});

test('broad but not recent demand is only a quiet "warm" hint', () => {
  assert.equal(findUncoveredHotspots([cell({ recent: 1 })], [])[0].level, 'warm');
});

test('neighbouring cells merge into one suggestion, hottest first', () => {
  const near = cell({ lat: NTINDA.lat + 0.008, lng: NTINDA.lng, customers: 4, requests: 5, recent: 1 });
  const far = cell({ lat: 0.4500, lng: 32.7500, label: 'Gayaza', customers: 3, requests: 4, recent: 0 });
  const out = findUncoveredHotspots([far, near, cell()], []);
  assert.equal(out.length, 2);
  assert.equal(out[0].label, 'Ntinda Shopping Centre');
  assert.equal(out[0].requests, 14);
  assert.equal(out[1].label, 'Gayaza');
});

test('requests waiting with few riders online -> VIP, confidently', () => {
  const rec = recommendMode({ ...base, snapshot: snapshot({ pendingNearby: 4, ridersOnline: 1 }) });
  assert.equal(rec.mode, 'vip');
  assert.ok(rec.confidence >= 0.6);
});

test('requests waiting but plenty of riders -> not VIP on that alone', () => {
  const rec = recommendMode({ ...base, snapshot: snapshot({ pendingNearby: 2, ridersOnline: 6 }) });
  assert.notEqual(rec.mode, 'vip');
});

test('far from home in the evening -> Return', () => {
  const rec = recommendMode({ ...base, now: at(19), kmFromHome: 8.2 });
  assert.equal(rec.mode, 'return');
});

test('far from home at midday is not "going home"', () => {
  assert.notEqual(recommendMode({ ...base, now: at(12), kmFromHome: 8.2 }).mode, 'return');
});

test('a quiet hour against a busy day -> Discount; a peak hour -> VIP', () => {
  const hourly = flat(2); hourly[8] = 60; hourly[7] = 30; hourly[9] = 30;
  const snap = snapshot({ hourly, ridersOnline: 5 });
  assert.equal(recommendMode({ ...base, now: at(14), snapshot: snap }).mode, 'discount');
  assert.equal(recommendMode({ ...base, now: at(8), snapshot: snap }).mode, 'vip');
});

test('late night never suggests a discount', () => {
  const hourly = flat(5); hourly[8] = 80;
  assert.notEqual(recommendMode({ ...base, now: at(23), snapshot: snapshot({ hourly }) }).mode, 'discount');
});

test('with no history, rush hour is only a low-confidence hint (never auto-applied)', () => {
  const rec = recommendMode({ ...base, now: at(8) });
  assert.equal(rec.mode, 'vip');
  assert.ok(rec.confidence < 0.6);
});

test('mid-job the mode is left alone', () => {
  const rec = recommendMode({ ...base, currentMode: 'discount', ownActive: 1, snapshot: snapshot({ pendingNearby: 5, ridersOnline: 1 }) });
  assert.equal(rec.mode, 'discount');
});

test('auto switch: needs a confident, different suggestion after the cooldown and outside a manual hold', () => {
  const rec = { mode: 'vip', confidence: 0.85, reason: '' };
  const ok = { rec, currentMode: 'normal', now: 10 * AUTO_COOLDOWN_MS, lastAutoAt: 0, overrideUntil: 0 };
  assert.equal(shouldAutoSwitch(ok), true);
  assert.equal(shouldAutoSwitch({ ...ok, currentMode: 'vip' }), false);
  assert.equal(shouldAutoSwitch({ ...ok, rec: { ...rec, confidence: 0.4 } }), false);
  assert.equal(shouldAutoSwitch({ ...ok, lastAutoAt: ok.now - 1000 }), false);
  assert.equal(shouldAutoSwitch({ ...ok, overrideUntil: ok.now + MANUAL_OVERRIDE_MS }), false);
});

test('hourlyFromTimestamps buckets by local hour and ignores junk', () => {
  const h = hourlyFromTimestamps([at(8).toISOString(), at(8).toISOString(), at(17).toISOString(), 'nope']);
  assert.equal(h[8], 2);
  assert.equal(h[17], 1);
  assert.equal(h.reduce((s, n) => s + n, 0), 3);
});
