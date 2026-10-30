// The store-delivery "Deliver within" step: presets, bounds, and the deadline shown to the customer.
// Run with: node --test tests/deliveryWindow.test.js   (npm run test:delivery-window)
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const { presetsWithin, clampHours, formatWindow, deadlineLabel, isTightWindow, DEFAULT_WINDOW_HOURS } =
  await import(pathToFileURL(path.join(root, 'mybodaguy', 'utils', 'deliveryWindow.ts')).href);

const at = (h, m = 0, day = 29) => new Date(2026, 9, day, h, m, 0);

test('only presets the server accepts are offered', () => {
  assert.deepEqual(presetsWithin({ min: 1, max: 48 }).map(p => p.hours), [1, 3, 6, 24, 48]);
  assert.deepEqual(presetsWithin({ min: 2, max: 24 }).map(p => p.hours), [3, 6, 24]);
});

test('a typed value is rounded and kept inside the bounds', () => {
  const b = { min: 1, max: 48 };
  assert.equal(clampHours(0, b), 1);
  assert.equal(clampHours(-5, b), 1);
  assert.equal(clampHours(9999, b), 48);
  assert.equal(clampHours(4.6, b), 5);
  assert.equal(clampHours(NaN, b), DEFAULT_WINDOW_HOURS);
});

test('hours read naturally', () => {
  assert.equal(formatWindow(1), '1 hr');
  assert.equal(formatWindow(3), '3 hrs');
  assert.equal(formatWindow(24), '1 day');
  assert.equal(formatWindow(48), '2 days');
  assert.equal(formatWindow(30), '30 hrs');
});

test('the deadline is a clock time today, then "Tomorrow", then a weekday', () => {
  assert.match(deadlineLabel(at(10, 0), 3, 'en-US'), /^1:00\s?PM$/);
  assert.match(deadlineLabel(at(22, 0), 3, 'en-US'), /^Tomorrow 1:00\s?AM$/);
  assert.match(deadlineLabel(at(10, 0), 24, 'en-US'), /^Tomorrow 10:00\s?AM$/);
  assert.match(deadlineLabel(at(10, 0), 48, 'en-US'), /^Sat 10:00\s?AM$/); // 29 Oct 2026 is a Thursday
});

test('a window is tight when the trip plus handover would use most of it', () => {
  assert.equal(isTightWindow(50, 1), true);   // 70 min of 45 usable
  assert.equal(isTightWindow(15, 1), false);  // 35 min of 45 usable
  assert.equal(isTightWindow(50, 3), false);
  assert.equal(isTightWindow(null, 1), false);
});
