import { getSupabase } from '@/lib/supabase';
import { aggregateMarketStats, SELECT_COLUMNS, type ReportRow, type PlanningRow } from '@/lib/internal/marketStats';

// ─── Market Explorer aggregation endpoint ──────────────────────────
// Internal only — same x-internal-secret gate as /api/reports/count.
// Feeds the "Market Explorer" area-browsing feature in Stayful Intelligence
// (intelligence.stayful.co.uk). Aggregates analyser_reports by postcode_area
// + bedrooms so the frontend never touches the raw per-lead rows. The
// aggregation itself lives in src/lib/internal/marketStats.ts (unit-tested).
//
//   curl -H "x-internal-secret: <INTERNAL_API_SECRET>" \
//        "https://<host>/api/market-stats?area=NG&bedrooms=2&min_samples=5"
//
// Query params (all optional):
//   area          UK postcode area letter prefix, e.g. "NG". Omit for all areas.
//   bedrooms      Filter to one bedroom count.
//   min_samples   Default 5. Any (postcode_area, bedrooms) combination with
//                 fewer than this many samples is dropped entirely — never
//                 returned with a "low confidence" flag. An area whose every
//                 bedroom group falls below the threshold is omitted outright.
//
// Units, matching what the frontend expects (NOT the raw DB units):
//   avg_adr                  GBP/night, rounded to the nearest pound
//   avg_occupancy            PERCENTAGE 0–100, one decimal place.
//                             analyser_reports.occupancy holds MIXED units —
//                             the live analyser writes a 0–1 fraction, the
//                             Monday PDF-backfill rows stored a 0–100 percentage
//                             — so each row is normalised via occupancyToPercent.
//   avg_gross_revenue / avg_net_revenue
//   avg_property_value_low / avg_property_value_high
//                             GBP, rounded to the nearest pound
//   avg_rating               0–5 (reviewed comparables only)
//   avg_review_count / avg_listing_age (years) / avg_listing_density (per km²)
//   competition / demand     per-area summaries, see marketStats.ts
//
// Every average is computed only over the rows in its group that have a
// non-null value for that specific field; a field with no data is null (never
// 0, never NaN). Rows with extraction_status = 'error' (failed PDF extraction
// from the Monday backfill pipeline) are excluded.

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const expected = process.env.INTERNAL_API_SECRET;
  if (!expected) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  const provided = request.headers.get('x-internal-secret');
  if (provided !== expected) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return Response.json({ error: 'Storage not configured' }, { status: 503 });
  }

  const url = new URL(request.url);
  const areaParam = url.searchParams.get('area');
  const bedroomsParam = url.searchParams.get('bedrooms');
  const minSamplesParam = url.searchParams.get('min_samples');

  const area = areaParam ? areaParam.trim().toUpperCase() : null;

  let bedrooms: number | null = null;
  if (bedroomsParam !== null) {
    const parsed = Number(bedroomsParam);
    if (!Number.isInteger(parsed) || parsed < 0) {
      return Response.json({ error: 'bedrooms must be a non-negative integer' }, { status: 400 });
    }
    bedrooms = parsed;
  }

  let minSamples = 5;
  if (minSamplesParam !== null) {
    const parsed = Number(minSamplesParam);
    if (!Number.isInteger(parsed) || parsed < 1) {
      return Response.json({ error: 'min_samples must be a positive integer' }, { status: 400 });
    }
    minSamples = parsed;
  }

  // PostgREST caps a single response at max_rows (1,000 by default), so page
  // through explicitly — a bare .range(0, 49999) would silently truncate.
  const PAGE = 1000;
  const rows: ReportRow[] = [];
  for (let from = 0; ; from += PAGE) {
    let query = supabase
      .from('analyser_reports')
      .select(SELECT_COLUMNS)
      .not('postcode_area', 'is', null)
      .not('bedrooms', 'is', null)
      .or('extraction_status.is.null,extraction_status.eq.ok')
      .order('id')
      .range(from, from + PAGE - 1);
    if (area) query = query.eq('postcode_area', area);
    if (bedrooms !== null) query = query.eq('bedrooms', bedrooms);

    const { data, error } = await query;
    if (error) {
      console.error('[market-stats] query failed:', error);
      return Response.json({ error: 'Query failed' }, { status: 500 });
    }
    const page = (data ?? []) as unknown as ReportRow[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }

  // Contractor-demand proxy (large planning applications), refreshed monthly
  // by /api/internal/refresh-planning. Missing table or rows → simply absent.
  let planning: PlanningRow[] = [];
  const planningQuery = supabase
    .from('area_planning_signals')
    .select('postcode_area, large_apps_12m, large_apps_prev_12m, fetched_at');
  const { data: planningData, error: planningError } = area
    ? await planningQuery.eq('postcode_area', area)
    : await planningQuery;
  if (planningError) {
    console.warn('[market-stats] planning signals unavailable:', planningError.message);
  } else {
    planning = (planningData ?? []) as PlanningRow[];
  }

  return Response.json(aggregateMarketStats(rows, planning, { minSamples }));
}
