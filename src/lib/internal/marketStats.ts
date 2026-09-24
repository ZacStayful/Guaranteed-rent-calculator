// ─── Market Explorer aggregation ───────────────────────────────────
//
// Pure aggregation behind /api/market-stats, split out of the route so it is
// unit-testable. Groups analyser_reports rows by postcode area + bedrooms,
// drops groups below `minSamples`, and returns the per-bedroom averages plus
// two area-level summaries the Market Explorer uses:
//
//   competition  — how crowded/entrenched the local market is (review depth,
//                  listing age, listing density). Averaged over the area's
//                  qualifying rows that carry each value.
//   demand       — what drives bookings there: the share of reports with a
//                  hospital / university / transport hub nearby, the average
//                  event count, and the large planning-application count from
//                  area_planning_signals (contractor demand proxy).
//
// Every average is over non-null values only; a field with no data is null,
// never 0. Units match what the frontend expects (see route comments).

import { occupancyToPercent } from '@/lib/utils/occupancy';

export interface ReportRow {
  postcode_area: string | null;
  bedrooms: number | null;
  adr: number | null;
  occupancy: number | null; // MIXED units, normalised via occupancyToPercent
  gross_revenue: number | null;
  net_revenue: number | null;
  property_value_low: number | null;
  property_value_high: number | null;
  extraction_status: string | null;
  // Market signals (null on rows the migration could not backfill)
  comp_avg_rating?: number | null;
  comp_avg_review_count?: number | null;
  comp_avg_listing_age?: number | null;
  listing_density?: number | null;
  demand_hospitals?: number | null;
  demand_universities?: number | null;
  demand_transport?: number | null;
  demand_events?: number | null;
}

export interface PlanningRow {
  postcode_area: string;
  large_apps_12m: number | null;
  large_apps_prev_12m: number | null;
  fetched_at: string;
}

export interface BedroomAgg {
  bedrooms: number;
  sample_count: number;
  avg_adr: number | null;
  avg_occupancy: number | null;
  avg_gross_revenue: number | null;
  avg_net_revenue: number | null;
  avg_property_value_low: number | null;
  avg_property_value_high: number | null;
  avg_rating: number | null;
  avg_review_count: number | null;
  avg_listing_age: number | null;
  avg_listing_density: number | null;
}

export interface AreaCompetition {
  sample_count: number; // rows with at least one competition signal
  avg_rating: number | null;
  avg_review_count: number | null;
  avg_listing_age: number | null;
  avg_listing_density: number | null;
}

export interface AreaDemand {
  sample_count: number; // rows with demand-driver counts
  share_hospital: number | null; // 0–1
  share_university: number | null;
  share_transport: number | null;
  avg_events: number | null;
  large_planning_apps_12m: number | null;
  large_planning_apps_prev_12m: number | null;
  planning_fetched_at: string | null;
}

export interface AreaStats {
  postcode_area: string;
  total_sample_count: number;
  by_bedrooms: BedroomAgg[];
  competition: AreaCompetition | null;
  demand: AreaDemand | null;
}

export interface MarketStatsResponse {
  areas: AreaStats[];
  min_samples_threshold: number;
  generated_at: string;
}

export const SELECT_COLUMNS =
  'postcode_area, bedrooms, adr, occupancy, gross_revenue, net_revenue, property_value_low, property_value_high, extraction_status, ' +
  'comp_avg_rating, comp_avg_review_count, comp_avg_listing_age, listing_density, ' +
  'demand_hospitals, demand_universities, demand_transport, demand_events';

function isNum(v: unknown): v is number {
  return typeof v === 'number' && !Number.isNaN(v);
}

export function average(values: (number | null | undefined)[], decimals = 0): number | null {
  const nonNull = values.filter(isNum);
  if (nonNull.length === 0) return null;
  const mean = nonNull.reduce((sum, v) => sum + v, 0) / nonNull.length;
  const factor = 10 ** decimals;
  return Math.round(mean * factor) / factor;
}

/** Share (0–1) of rows whose count is > 0, over rows that have a count at all. */
function share(values: (number | null | undefined)[]): number | null {
  const known = values.filter(isNum);
  if (known.length === 0) return null;
  return Math.round((known.filter((v) => v > 0).length / known.length) * 1000) / 1000;
}

function competitionFor(rows: ReportRow[]): AreaCompetition | null {
  const withSignal = rows.filter(
    (r) => isNum(r.comp_avg_rating) || isNum(r.comp_avg_review_count) || isNum(r.comp_avg_listing_age) || isNum(r.listing_density),
  );
  if (withSignal.length === 0) return null;
  return {
    sample_count: withSignal.length,
    avg_rating: average(rows.map((r) => r.comp_avg_rating), 2),
    avg_review_count: average(rows.map((r) => r.comp_avg_review_count), 1),
    avg_listing_age: average(rows.map((r) => r.comp_avg_listing_age), 2),
    avg_listing_density: average(rows.map((r) => r.listing_density), 3),
  };
}

function demandFor(rows: ReportRow[], planning: PlanningRow | undefined): AreaDemand | null {
  const withCounts = rows.filter((r) => isNum(r.demand_hospitals) || isNum(r.demand_universities) || isNum(r.demand_transport));
  if (withCounts.length === 0 && !planning) return null;
  return {
    sample_count: withCounts.length,
    share_hospital: share(rows.map((r) => r.demand_hospitals)),
    share_university: share(rows.map((r) => r.demand_universities)),
    share_transport: share(rows.map((r) => r.demand_transport)),
    avg_events: average(rows.map((r) => r.demand_events), 1),
    large_planning_apps_12m: planning?.large_apps_12m ?? null,
    large_planning_apps_prev_12m: planning?.large_apps_prev_12m ?? null,
    planning_fetched_at: planning?.fetched_at ?? null,
  };
}

export function aggregateMarketStats(
  rows: ReportRow[],
  planning: PlanningRow[],
  opts: { minSamples: number; now?: Date },
): MarketStatsResponse {
  const { minSamples } = opts;
  const planningByArea = new Map(planning.map((p) => [p.postcode_area.toUpperCase(), p]));

  const grouped = new Map<string, Map<number, ReportRow[]>>();
  for (const row of rows) {
    if (row.postcode_area === null || row.bedrooms === null) continue;
    const area = row.postcode_area.toUpperCase();
    if (!grouped.has(area)) grouped.set(area, new Map());
    const byBedrooms = grouped.get(area)!;
    if (!byBedrooms.has(row.bedrooms)) byBedrooms.set(row.bedrooms, []);
    byBedrooms.get(row.bedrooms)!.push(row);
  }

  const areas: AreaStats[] = [];

  for (const [postcodeArea, byBedrooms] of grouped) {
    const bedroomAggs: BedroomAgg[] = [];
    const qualifying: ReportRow[] = [];

    for (const [bedroomCount, groupRows] of byBedrooms) {
      if (groupRows.length < minSamples) continue;
      qualifying.push(...groupRows);
      bedroomAggs.push({
        bedrooms: bedroomCount,
        sample_count: groupRows.length,
        avg_adr: average(groupRows.map((r) => r.adr), 0),
        avg_occupancy: average(groupRows.map((r) => occupancyToPercent(r.occupancy)), 1),
        avg_gross_revenue: average(groupRows.map((r) => r.gross_revenue), 0),
        avg_net_revenue: average(groupRows.map((r) => r.net_revenue), 0),
        avg_property_value_low: average(groupRows.map((r) => r.property_value_low), 0),
        avg_property_value_high: average(groupRows.map((r) => r.property_value_high), 0),
        avg_rating: average(groupRows.map((r) => r.comp_avg_rating), 2),
        avg_review_count: average(groupRows.map((r) => r.comp_avg_review_count), 1),
        avg_listing_age: average(groupRows.map((r) => r.comp_avg_listing_age), 2),
        avg_listing_density: average(groupRows.map((r) => r.listing_density), 3),
      });
    }

    if (bedroomAggs.length === 0) continue;
    bedroomAggs.sort((a, b) => a.bedrooms - b.bedrooms);

    areas.push({
      postcode_area: postcodeArea,
      total_sample_count: bedroomAggs.reduce((sum, b) => sum + b.sample_count, 0),
      by_bedrooms: bedroomAggs,
      competition: competitionFor(qualifying),
      demand: demandFor(qualifying, planningByArea.get(postcodeArea)),
    });
  }

  areas.sort((a, b) => a.postcode_area.localeCompare(b.postcode_area));

  return {
    areas,
    min_samples_threshold: minSamples,
    generated_at: (opts.now ?? new Date()).toISOString(),
  };
}
