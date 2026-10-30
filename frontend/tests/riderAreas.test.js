// The Areas page's "this place is already covered" check.
// Run with: node --test tests/riderAreas.test.js   (npm run test:rider-areas)
import test from 'node:test';
import { register } from 'node:module';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

// riderAreas.ts imports './riderSmarts' without an extension, as Vite allows.
register('./tsResolve.mjs', import.meta.url);

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const { coveringArea, formatKm } =
  await import(pathToFileURL(path.join(root, 'mybodaguy', 'utils', 'riderAreas.ts')).href);

const NTINDA = { latitude: 0.3476, longitude: 32.6165 };
const area = (id, name, over = {}) => ({ id, name, ...NTINDA, ...over });

test('a pin within 3 km of a saved area is covered by it', () => {
  const hit = coveringArea(0.3500, 32.6200, [area('a', 'Ntinda')]);
  assert.equal(hit.area.name, 'Ntinda');
  assert.ok(hit.km < 1);
});

test('a pin farther than 3 km is not covered', () => {
  assert.equal(coveringArea(0.3133, 32.5811, [area('a', 'Ntinda')]), null); // Kampala centre, ~5 km away
});

test('the nearest covering area wins', () => {
  const hit = coveringArea(0.3480, 32.6170, [area('far', 'Bukoto', { latitude: 0.3600, longitude: 32.6300 }), area('near', 'Ntinda')]);
  assert.equal(hit.area.id, 'near');
});

test('areas without coordinates never cover anything', () => {
  assert.equal(coveringArea(0.3476, 32.6165, [area('a', 'No pin', { latitude: null, longitude: null })]), null);
});

test('moving an area\'s own pin does not report itself', () => {
  assert.equal(coveringArea(0.3476, 32.6165, [area('a', 'Ntinda')], 'a'), null);
});

test('a narrower radius only finds a spot saved right here', () => {
  const home = area('h', 'Home');
  assert.equal(coveringArea(0.3500, 32.6200, [home], undefined, 0.2), null);       // ~0.5 km away
  assert.equal(coveringArea(0.3477, 32.6166, [home], undefined, 0.2).area.id, 'h'); // ~15 m away
});

test('distance reads in metres under a kilometre', () => {
  assert.equal(formatKm(0.347), '350 m');
  assert.equal(formatKm(1.24), '1.2 km');
});
