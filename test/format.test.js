import { test } from 'node:test';
import assert from 'node:assert/strict';
import { duration, utcTime, percent } from '../src/format.js';

test('a duration names its two largest units', () => {
  assert.equal(duration(0), '0 s');
  assert.equal(duration(40), '40 s');
  assert.equal(duration(420), '7 min');
  assert.equal(duration(76320), '21 h 12 min');
  assert.equal(duration(273600), '3 d 4 h');
});

test('a negative or fractional duration is floored at zero', () => {
  assert.equal(duration(-5), '0 s');
  assert.equal(duration(59.9), '59 s');
});

test('times are shown in UTC to the minute', () => {
  assert.equal(utcTime(1792000000), '2026-10-14 17:46 UTC');
});

test('a fee fraction reads as a percentage without trailing zeros', () => {
  assert.equal(percent(0.006), '0.6 %');
  assert.equal(percent(0.01), '1 %');
  assert.equal(percent(0), '0 %');
  assert.equal(percent(0.0025), '0.25 %');
});
