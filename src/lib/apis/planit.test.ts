import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildPlanItUrl, countLargeApplications, trailingWindows, PlanItRateLimited } from './planit.ts';

const win = { lat: 52.9548, lng: -1.1581, radiusKm: 10, startDate: new Date('2025-09-05T00:00:00Z'), endDate: new Date('2026-09-05T00:00:00Z') };

test('URL carries the documented parameters and a count-only page size', () => {
  const u = new URL(buildPlanItUrl(win));
  assert.equal(u.origin + u.pathname, 'https://www.planit.org.uk/api/applics/json');
  assert.equal(u.searchParams.get('lat'), '52.95480');
  assert.equal(u.searchParams.get('lng'), '-1.15810');
  assert.equal(u.searchParams.get('krad'), '10');
  assert.equal(u.searchParams.get('app_size'), 'Large');
  assert.equal(u.searchParams.get('start_date'), '2025-09-05');
  assert.equal(u.searchParams.get('end_date'), '2026-09-05');
  assert.equal(u.searchParams.get('pg_sz'), '1');
});

test('trailing windows are contiguous 12-month spans ending today', () => {
  const { current, previous } = trailingWindows(new Date('2026-09-05T10:00:00Z'));
  assert.equal(current[0].toISOString().slice(0, 10), '2025-09-05');
  assert.equal(current[1].toISOString().slice(0, 10), '2026-09-05');
  assert.equal(previous[1].toISOString().slice(0, 10), '2025-09-04');
  assert.equal(previous[0].toISOString().slice(0, 10), '2024-09-04');
});

function fakeFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  return (async () =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })) as unknown as typeof fetch;
}

test('reads total from the envelope', async () => {
  assert.equal(await countLargeApplications(win, fakeFetch(200, { total: 17, records: [{}] })), 17);
  assert.equal(await countLargeApplications(win, fakeFetch(200, { total: '3' })), 3);
});

test('non-OK or malformed responses give null, never a fake zero', async () => {
  assert.equal(await countLargeApplications(win, fakeFetch(403, { error: 'blocked' })), null);
  assert.equal(await countLargeApplications(win, fakeFetch(200, { records: [] })), null);
  const failing = (async () => { throw new Error('boom'); }) as unknown as typeof fetch;
  assert.equal(await countLargeApplications(win, failing), null);
});

test('429 throws PlanItRateLimited with Retry-After (null when absent)', async () => {
  await assert.rejects(
    countLargeApplications(win, fakeFetch(429, {}, { 'retry-after': '30' })),
    (err: unknown) => err instanceof PlanItRateLimited && err.retryAfterSeconds === 30,
  );
  await assert.rejects(
    countLargeApplications(win, fakeFetch(429, {})),
    (err: unknown) => err instanceof PlanItRateLimited && err.retryAfterSeconds === null,
  );
});
