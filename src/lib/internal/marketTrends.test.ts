import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bucketMonthly, monthKeys, windowStart, type TrendRow } from './marketTrends.ts';

const now = new Date('2026-09-05T12:00:00Z');
const row = (created_at: string, over: Partial<TrendRow> = {}): TrendRow => ({
  postcode_area: 'NG', created_at, adr: 100, occupancy: 0.6, gross_revenue: 20000, source: 'analyser', extraction_status: 'ok', ...over,
});

test('month keys run oldest → newest and end with the current month', () => {
  assert.deepEqual(monthKeys(3, now), ['2026-07', '2026-08', '2026-09']);
  assert.equal(windowStart(3, now), '2026-07-01T00:00:00.000Z');
  assert.deepEqual(monthKeys(2, new Date('2026-01-15T00:00:00Z')), ['2025-12', '2026-01']);
});

test('every month is present, zero-filled with null averages', () => {
  const res = bucketMonthly([row('2026-08-10T10:00:00Z')], { months: 3, now });
  assert.deepEqual(res.national.map((b) => b.reports), [0, 1, 0]);
  assert.equal(res.national[0].avg_adr, null);
  assert.equal(res.national[1].avg_adr, 100);
  assert.equal(res.national[1].avg_occupancy, 60);
  assert.deepEqual(res.areas.NG.map((b) => b.reports), [0, 1, 0]);
});

test('backfill and errored rows are excluded, rows outside the window ignored', () => {
  const rows = [
    row('2026-08-10T10:00:00Z', { source: 'monday_backfill' }),
    row('2026-08-10T10:00:00Z', { extraction_status: 'error' }),
    row('2026-01-10T10:00:00Z'),
    row('2026-08-31T23:59:59Z'),
  ];
  const res = bucketMonthly(rows, { months: 3, now });
  assert.deepEqual(res.national.map((b) => b.reports), [0, 1, 0]);
});

test('UTC month boundaries', () => {
  const res = bucketMonthly([row('2026-07-31T23:30:00Z'), row('2026-08-01T00:30:00Z')], { months: 3, now });
  assert.deepEqual(res.national.map((b) => b.reports), [1, 1, 0]);
});

test('area filter keeps national totals but only the requested area', () => {
  const rows = [row('2026-08-10T00:00:00Z'), row('2026-08-11T00:00:00Z', { postcode_area: 'M' })];
  const res = bucketMonthly(rows, { months: 2, now, area: 'm' });
  assert.equal(res.national[0].reports, 2); // August, the first of the two months
  assert.deepEqual(Object.keys(res.areas), ['M']);
});

test('mixed-unit occupancy is normalised', () => {
  const res = bucketMonthly([row('2026-09-01T00:00:00Z', { occupancy: 0.5 }), row('2026-09-02T00:00:00Z', { occupancy: 70 })], { months: 1, now });
  assert.equal(res.national[0].avg_occupancy, 60);
});
