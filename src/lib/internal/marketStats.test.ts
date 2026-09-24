import { test } from 'node:test';
import assert from 'node:assert/strict';

import { aggregateMarketStats, average, type ReportRow } from './marketStats.ts';

function row(over: Partial<ReportRow> = {}): ReportRow {
  return {
    postcode_area: 'NG', bedrooms: 2, adr: 100, occupancy: 0.6, gross_revenue: 20000, net_revenue: 14000,
    property_value_low: 180000, property_value_high: 220000, extraction_status: 'ok',
    ...over,
  };
}

test('legacy rows (no signals) keep the original shape and null the new fields', () => {
  const res = aggregateMarketStats([row(), row({ adr: 120 })], [], { minSamples: 2, now: new Date('2026-01-01T00:00:00Z') });
  assert.equal(res.areas.length, 1);
  const a = res.areas[0];
  assert.equal(a.postcode_area, 'NG');
  assert.equal(a.total_sample_count, 2);
  assert.deepEqual(a.by_bedrooms[0], {
    bedrooms: 2, sample_count: 2, avg_adr: 110, avg_occupancy: 60, avg_gross_revenue: 20000, avg_net_revenue: 14000,
    avg_property_value_low: 180000, avg_property_value_high: 220000,
    avg_rating: null, avg_review_count: null, avg_listing_age: null, avg_listing_density: null,
  });
  assert.equal(a.competition, null);
  assert.equal(a.demand, null);
  assert.equal(res.generated_at, '2026-01-01T00:00:00.000Z');
  assert.equal(res.min_samples_threshold, 2);
});

test('min_samples drops a group below the threshold and the area if nothing is left', () => {
  const res = aggregateMarketStats([row(), row({ bedrooms: 3 }), row({ bedrooms: 3 })], [], { minSamples: 2 });
  assert.deepEqual(res.areas[0].by_bedrooms.map((b) => b.bedrooms), [3]);
  assert.equal(aggregateMarketStats([row()], [], { minSamples: 2 }).areas.length, 0);
});

test('mixed-unit occupancy is normalised per row', () => {
  const res = aggregateMarketStats([row({ occupancy: 0.5 }), row({ occupancy: 70 })], [], { minSamples: 1 });
  assert.equal(res.areas[0].by_bedrooms[0].avg_occupancy, 60);
});

test('competition averages only over rows that carry each value', () => {
  const rows = [
    row({ comp_avg_rating: 4.6, comp_avg_review_count: 40, listing_density: 12 }),
    row({ comp_avg_rating: null, comp_avg_review_count: 20, listing_density: null }),
    row(), // no signals at all
  ];
  const c = aggregateMarketStats(rows, [], { minSamples: 1 }).areas[0].competition!;
  assert.equal(c.sample_count, 2);
  assert.equal(c.avg_rating, 4.6);
  assert.equal(c.avg_review_count, 30);
  assert.equal(c.avg_listing_density, 12);
  assert.equal(c.avg_listing_age, null);
});

test('demand shares count rows with a driver over rows with a known count, and join planning', () => {
  const rows = [
    row({ demand_hospitals: 2, demand_universities: 0, demand_transport: 1, demand_events: 10 }),
    row({ demand_hospitals: 0, demand_universities: 1, demand_transport: 3, demand_events: 30 }),
    row(), // unknown → excluded from shares
  ];
  const planning = [{ postcode_area: 'ng', large_apps_12m: 14, large_apps_prev_12m: 9, fetched_at: '2026-09-01T00:00:00Z' }];
  const d = aggregateMarketStats(rows, planning, { minSamples: 1 }).areas[0].demand!;
  assert.equal(d.sample_count, 2);
  assert.equal(d.share_hospital, 0.5);
  assert.equal(d.share_university, 0.5);
  assert.equal(d.share_transport, 1);
  assert.equal(d.avg_events, 20);
  assert.equal(d.large_planning_apps_12m, 14);
  assert.equal(d.large_planning_apps_prev_12m, 9);
  assert.equal(d.planning_fetched_at, '2026-09-01T00:00:00Z');
});

test('planning data alone yields a demand block with null shares', () => {
  const planning = [{ postcode_area: 'NG', large_apps_12m: 3, large_apps_prev_12m: null, fetched_at: 'x' }];
  const d = aggregateMarketStats([row()], planning, { minSamples: 1 }).areas[0].demand!;
  assert.equal(d.sample_count, 0);
  assert.equal(d.share_hospital, null);
  assert.equal(d.large_planning_apps_12m, 3);
});

test('only qualifying (min_samples) rows feed the area summaries', () => {
  const rows = [
    row({ bedrooms: 1, comp_avg_review_count: 999 }), // dropped group
    row({ bedrooms: 2, comp_avg_review_count: 10 }),
    row({ bedrooms: 2, comp_avg_review_count: 20 }),
  ];
  const a = aggregateMarketStats(rows, [], { minSamples: 2 }).areas[0];
  assert.equal(a.competition!.avg_review_count, 15);
});

test('average ignores null/NaN and returns null for nothing', () => {
  assert.equal(average([null, undefined, NaN]), null);
  assert.equal(average([1, null, 2], 1), 1.5);
});
