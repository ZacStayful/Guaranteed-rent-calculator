import { test } from 'node:test';
import assert from 'node:assert/strict';
import { occupancyToPercent } from './occupancy.ts';

test('converts a 0–1 fraction to a percentage', () => {
  assert.equal(occupancyToPercent(0.5), 50);
  // 0.556 → 55.60000000000001 in float; the route's average() rounds to 1dp
  // downstream, so the helper only needs to be within float tolerance here.
  assert.ok(Math.abs((occupancyToPercent(0.556) as number) - 55.6) < 1e-9);
});

test('passes a 0–100 percentage through unchanged', () => {
  assert.equal(occupancyToPercent(55.6), 55.6);
});

test('reads a stored 1.0 as 100% (fraction), not 1%', () => {
  assert.equal(occupancyToPercent(1), 100);
});

test('handles the fraction lower bound', () => {
  assert.equal(occupancyToPercent(0), 0);
});

test('passes a high percentage through', () => {
  assert.equal(occupancyToPercent(69.6), 69.6);
});

test('returns null for null', () => {
  assert.equal(occupancyToPercent(null), null);
});

test('returns null for undefined', () => {
  assert.equal(occupancyToPercent(undefined), null);
});

test('returns null for NaN', () => {
  assert.equal(occupancyToPercent(Number.NaN), null);
});
