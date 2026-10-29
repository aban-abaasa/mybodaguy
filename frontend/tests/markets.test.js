// Which markets are new to a rider, and the words that tell them.
// Run with: node --test tests/markets.test.js   (npm run test:markets)
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const { findNewMarkets, describeNewMarkets, businessTypeLabel } =
  await import(pathToFileURL(path.join(root, 'mybodaguy', 'utils', 'markets.ts')).href);

const m = (id, over = {}) => ({ id, name: `Market ${id}`, location: 'Ntinda', business_type: 'supermarket', ...over });

test('the first check records every market and announces none', () => {
  const { fresh, known } = findNewMarkets(null, [m('a'), m('b')]);
  assert.deepEqual(fresh, []);
  assert.deepEqual([...known].sort(), ['a', 'b']);
});

test('a market the rider has not been told about is new, and only once', () => {
  const first = findNewMarkets(new Set(['a']), [m('a'), m('b')]);
  assert.deepEqual(first.fresh.map(x => x.id), ['b']);
  const again = findNewMarkets(first.known, [m('a'), m('b')]);
  assert.deepEqual(again.fresh, []);
});

test('a market that goes away is still remembered, so coming back is not "new"', () => {
  const { known } = findNewMarkets(new Set(['a', 'b']), [m('a')]);
  assert.ok(known.has('b'));
  assert.deepEqual(findNewMarkets(known, [m('a'), m('b')]).fresh, []);
});

test('one new market is named with its type and place', () => {
  assert.deepEqual(describeNewMarkets([m('a', { name: 'Sunrise Hotel', business_type: 'hotel', location: 'Kololo' })]),
    { title: 'New market: Sunrise Hotel', body: 'Hotel · Kololo' });
});

test('a place is optional in the one-market message', () => {
  assert.equal(describeNewMarkets([m('a', { location: null })]).body, 'Supermarket');
});

test('several new markets are counted, with the first three named', () => {
  assert.deepEqual(describeNewMarkets([m('a'), m('b')]), { title: '2 new markets', body: 'Market a, Market b' });
  const five = describeNewMarkets(['a', 'b', 'c', 'd', 'e'].map(id => m(id)));
  assert.equal(five.title, '5 new markets');
  assert.equal(five.body, 'Market a, Market b, Market c +2 more');
});

test('an unfamiliar business type reads as words', () => {
  assert.equal(businessTypeLabel('pharmacy_shop'), 'Pharmacy shop');
  assert.equal(businessTypeLabel('restaurant_cafe'), 'Restaurant & Café');
  assert.equal(businessTypeLabel(null), 'Supermarket');
});
