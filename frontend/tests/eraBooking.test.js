import test from 'node:test';
import assert from 'node:assert/strict';
import { isBookingCode, findRidersArgs, rideRequestArgs, minutesLeft, canBook, statusLine } from '../src/mybodaguy/services/eraBooking.ts';

const intent = (over = {}) => ({
  code: 'BKA1B2C3D4E5F60718293A', status: 'awaiting_confirmation', kind: 'delivery', requested_by: 'Alpha Mart Ltd',
  pickup: { label: 'Alpha Store 1', lat: 0.3318, lng: 32.5728 }, dropoff: { label: null, lat: 0.3476, lng: 32.6025 },
  notes: 'Fragile', quote: { total_ugx: 6500 }, expires_at: '2026-10-05T12:20:00Z', ride_id: null, ...over,
});
const now = new Date('2026-10-05T12:00:00Z');

test('isBookingCode accepts BK + 20 hex and nothing else', () => {
  assert.equal(isBookingCode('BKA1B2C3D4E5F60718293A'), true);
  assert.equal(isBookingCode('bka1b2c3d4e5f60718293a'), false, 'the URL matcher upper-cases first');
  for (const bad of ['', 'BK123', 'XX' + 'A'.repeat(20), 'BK' + 'G'.repeat(20), 'BK' + 'A'.repeat(21), null, 5]) assert.equal(isBookingCode(bad), false, String(bad));
});

test('the rider search uses the intent coordinates and excludes nobody', () => {
  const a = findRidersArgs(intent());
  assert.equal(a.p_pickup_lat, 0.3318); assert.equal(a.p_dropoff_lng, 32.6025); assert.deepEqual(a.p_exclude_rider_ids, []); assert.equal(a.p_limit, 5);
});

test('a delivery request maps to mbg_request_ride and carries NO price from the business', () => {
  const a = rideRequestArgs(intent(), 'rider-1', 'wallet');
  assert.equal(a.p_service_type, 'delivery'); assert.equal(a.p_delivery_mode, 'normal'); assert.equal(a.p_rider_id, 'rider-1');
  assert.equal(a.p_pickup_location, 'Alpha Store 1'); assert.equal(a.p_dropoff_location, 'Drop-off point', 'a missing label gets a neutral name');
  assert.equal(a.p_payment_method, 'wallet'); assert.equal(a.p_expense_classification, 'personal_expense'); assert.equal(a.p_cart, null);
  assert.match(a.p_order_notes, /^Alpha Mart Ltd: Fragile$/);
  assert.ok(!Object.keys(a).some((k) => /fare|price|total|amount/i.test(k)), 'no price-like argument exists to be tampered with');
});

test('a ride request has no delivery mode or expense class, and cash is passed through', () => {
  const a = rideRequestArgs(intent({ kind: 'ride', notes: null }), 'r2', 'cash');
  assert.equal(a.p_service_type, 'ride'); assert.equal(a.p_delivery_mode, null); assert.equal(a.p_expense_classification, null);
  assert.equal(a.p_payment_method, 'cash'); assert.equal(a.p_order_notes, 'Requested by Alpha Mart Ltd');
});

test('notes are capped so a business cannot push a huge string into the ride', () => {
  assert.ok(rideRequestArgs(intent({ notes: 'x'.repeat(5000) }), 'r', 'wallet').p_order_notes.length <= 500);
});

test('only an open, unexpired link can be booked', () => {
  assert.equal(minutesLeft('2026-10-05T12:20:00Z', now), 20);
  assert.equal(minutesLeft('2026-10-05T11:59:00Z', now), 0);
  assert.equal(minutesLeft('garbage', now), 0);
  assert.equal(canBook(intent(), now), true);
  for (const status of ['booked', 'cancelled', 'expired']) assert.equal(canBook(intent({ status }), now), false, status);
  assert.equal(canBook(intent({ expires_at: '2026-10-05T11:00:00Z' }), now), false);
  assert.equal(canBook(null, now), false);
});

test('status lines tell the customer what to do next', () => {
  assert.match(statusLine(intent(), now), /20 more minutes/);
  assert.match(statusLine(intent({ status: 'booked' }), now), /Booked/);
  assert.match(statusLine(intent({ status: 'expired' }), now), /expired/);
  assert.match(statusLine(intent({ expires_at: '2026-10-05T11:00:00Z' }), now), /expired/);
});
