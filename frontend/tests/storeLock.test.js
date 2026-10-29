// The store-delivery shop's "one store per delivery" rule: open only the tapped product's store, refuse a second store at once.
// Run with: node --test tests/storeLock.test.js   (npm run test:store-lock)
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const { cartStoreId, decideAdd, switchNeedsConfirm, rankStores, formatDistance } =
  await import(pathToFileURL(path.join(root, 'mybodaguy', 'utils', 'storeLock.ts')).href);

const p = (id, store) => ({ id, supermarket_id: store });

test('an empty basket belongs to no store', () => {
  assert.equal(cartStoreId({}, {}), null);
  assert.equal(cartStoreId({ a: 0 }, { a: p('a', 'S1') }), null);
});

test('the basket belongs to the store of its products', () => {
  assert.equal(cartStoreId({ a: 2, b: 0 }, { a: p('a', 'S1'), b: p('b', 'S2') }), 'S1');
});

test('the first product tapped while viewing every store locks the shop to its store', () => {
  assert.deepEqual(decideAdd(p('a', 'S1'), null, ''), { kind: 'lock', storeId: 'S1' });
  assert.deepEqual(decideAdd(p('a', 'S1'), null, null), { kind: 'lock', storeId: 'S1' });
});

test('adding while a store is already open, or from the basket store, just adds', () => {
  assert.deepEqual(decideAdd(p('a', 'S1'), null, 'S1'), { kind: 'add' });
  assert.deepEqual(decideAdd(p('b', 'S1'), 'S1', 'S1'), { kind: 'add' });
  assert.deepEqual(decideAdd(p('b', 'S1'), 'S1', ''), { kind: 'add' });
});

test('a product from another store than the basket is a conflict, named at once', () => {
  assert.deepEqual(decideAdd(p('c', 'S2'), 'S1', 'S1'), { kind: 'conflict', cartStoreId: 'S1', productStoreId: 'S2' });
  assert.deepEqual(decideAdd(p('c', 'S2'), 'S1', ''), { kind: 'conflict', cartStoreId: 'S1', productStoreId: 'S2' });
});

test('switching stores only needs confirming when the basket would be lost', () => {
  assert.equal(switchNeedsConfirm(null, 'S2'), false);
  assert.equal(switchNeedsConfirm('S1', 'S1'), false);
  assert.equal(switchNeedsConfirm('S1', 'S2'), true);
});

test('stores rank nearest first, local before abroad, unmeasured last (never dropped)', () => {
  const ranked = rankStores([
    { id: 'far', distanceKm: 4.2, abroad: false },
    { id: 'abroad', distanceKm: 0.1, abroad: true },
    { id: 'unknown', distanceKm: null, abroad: false },
    { id: 'near', distanceKm: 0.4, abroad: false },
  ]);
  assert.deepEqual(ranked.map(s => s.id), ['near', 'far', 'unknown', 'abroad']);
});

test('distance reads in metres under a kilometre', () => {
  assert.equal(formatDistance(0.43), '430m');
  assert.equal(formatDistance(2.04), '2.0km');
  assert.equal(formatDistance(null), null);
});
