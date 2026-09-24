import { getSupabase } from '@/lib/supabase';
import { bucketMonthly, windowStart, DEFAULT_MONTHS, MAX_MONTHS, type TrendRow } from '@/lib/internal/marketTrends';

// ─── Market Explorer trends endpoint ───────────────────────────────
// Internal only — same x-internal-secret gate as /api/market-stats.
// Monthly analyser-report volume and average ADR / occupancy / revenue, per
// postcode area and nationally, over the last N months. See
// src/lib/internal/marketTrends.ts for the bucketing rules (live analyser
// rows only, every month present, zero-filled).
//
//   curl -H "x-internal-secret: <INTERNAL_API_SECRET>" \
//        "https://<host>/api/market-trends?months=12&area=NG"
//
// Query params (optional): months (default 12, max 24), area.

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const expected = process.env.INTERNAL_API_SECRET;
  if (!expected) return Response.json({ error: 'Not found' }, { status: 404 });
  if (request.headers.get('x-internal-secret') !== expected) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = getSupabase();
  if (!supabase) return Response.json({ error: 'Storage not configured' }, { status: 503 });

  const url = new URL(request.url);
  const monthsParam = url.searchParams.get('months');
  let months = DEFAULT_MONTHS;
  if (monthsParam !== null) {
    const parsed = Number(monthsParam);
    if (!Number.isInteger(parsed) || parsed < 1) return Response.json({ error: 'months must be a positive integer' }, { status: 400 });
    months = Math.min(parsed, MAX_MONTHS);
  }
  const areaParam = url.searchParams.get('area');
  const area = areaParam ? areaParam.trim().toUpperCase() : null;

  const now = new Date();
  const PAGE = 1000;
  const rows: TrendRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const query = supabase
      .from('analyser_reports')
      .select('postcode_area, created_at, adr, occupancy, gross_revenue, source, extraction_status')
      .eq('source', 'analyser')
      .gte('created_at', windowStart(months, now))
      .order('created_at')
      .range(from, from + PAGE - 1);
    // The national series needs every area, so the area filter is applied in
    // the bucketing, not the query.
    const { data, error } = await query;
    if (error) {
      console.error('[market-trends] query failed:', error);
      return Response.json({ error: 'Query failed' }, { status: 500 });
    }
    const page = (data ?? []) as unknown as TrendRow[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }

  return Response.json(bucketMonthly(rows, { months, now, area }));
}
