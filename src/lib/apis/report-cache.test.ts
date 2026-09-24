import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  __clearMemoryCache,
  forgetCachedReportId,
  getCachedReportId,
  setCachedReportId,
} from './report-cache.ts';

// These run with Supabase unconfigured, which is the important degradation
// path: the cache must fall back to memory-only and behave exactly as the
// original module-level Map did, so a storage outage can never break the live
// single-property analyser.

test('a miss returns null rather than throwing', async () => {
  __clearMemoryCache();
  assert.equal(await getCachedReportId('NG15GY_2bed'), null);
});

test('a stored id is returned back', async () => {
  __clearMemoryCache();
  await setCachedReportId('NG15GY_2bed', 'report-123', 60_000);
  assert.equal(await getCachedReportId('NG15GY_2bed'), 'report-123');
});

test('ids are isolated per postcode and bedroom count', async () => {
  __clearMemoryCache();
  await setCachedReportId('NG15GY_2bed', 'report-a', 60_000);
  await setCachedReportId('NG15GY_3bed', 'report-b', 60_000);
  await setCachedReportId('M11AE_2bed', 'report-c', 60_000);

  assert.equal(await getCachedReportId('NG15GY_2bed'), 'report-a');
  assert.equal(await getCachedReportId('NG15GY_3bed'), 'report-b');
  assert.equal(await getCachedReportId('M11AE_2bed'), 'report-c');
});

test('an expired id is not returned', async () => {
  __clearMemoryCache();
  // Already expired: buying a stale report back would return stale market data.
  await setCachedReportId('NG15GY_2bed', 'report-old', -1);
  assert.equal(await getCachedReportId('NG15GY_2bed'), null);
});

test('an unreadable id can be forgotten', async () => {
  __clearMemoryCache();
  await setCachedReportId('NG15GY_2bed', 'report-gone', 60_000);
  await forgetCachedReportId('NG15GY_2bed');
  assert.equal(await getCachedReportId('NG15GY_2bed'), null);
});

test('writing twice replaces the id', async () => {
  __clearMemoryCache();
  await setCachedReportId('NG15GY_2bed', 'report-old', 60_000);
  await setCachedReportId('NG15GY_2bed', 'report-new', 60_000);
  assert.equal(await getCachedReportId('NG15GY_2bed'), 'report-new');
});

test('every operation is safe with storage unconfigured', async () => {
  // Nothing here may throw — a cache failure and a cache miss must look the
  // same to the caller, which simply buys a new report.
  __clearMemoryCache();
  await assert.doesNotReject(() => getCachedReportId('X'));
  await assert.doesNotReject(() => setCachedReportId('X', 'y', 1000));
  await assert.doesNotReject(() => forgetCachedReportId('X'));
});
