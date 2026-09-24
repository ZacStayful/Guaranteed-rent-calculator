import { getSupabase } from '@/lib/supabase';
import { internalSecret } from '@/lib/bulk/kick';
import { countLargeApplications, trailingWindows, PlanItRateLimited, PLANIT_TIMEOUT_MS } from '@/lib/apis/planit';

// ─── Contractor-demand refresh ─────────────────────────────────────
//
// Monthly cron (vercel.json) that fills area_planning_signals: for every
// postcode area with analyser reports, the number of LARGE planning
// applications started within RADIUS_KM of the area's reports' mean
// coordinates over the last 12 months, and the 12 months before. The Market
// Explorer reads this through /api/market-stats as a contractor-demand proxy.
//
//   curl -H "x-internal-secret: <INTERNAL_API_SECRET>" https://<host>/api/internal/refresh-planning
//   curl ".../api/internal/refresh-planning?dry=1" — list what would be fetched
//
// Auth: Vercel Cron's `Authorization: Bearer $CRON_SECRET`, or the shared
// internal secret for manual runs (same as the bulk worker).
//
// Budget: stalest areas first, stop at ~50s, and stop for the run on a 429 —
// whatever is left is picked up next time. Failures leave the previous value.

export const runtime = 'nodejs';
export const maxDuration = 60;

const RADIUS_KM = 10;
const BUDGET_MS = 50_000;
const PAUSE_MS = 400; // be a polite client
// Worst case for one area: two requests at the full timeout plus the pauses.
// Don't start an area unless it can finish inside the budget.
const AREA_WORST_CASE_MS = 2 * PLANIT_TIMEOUT_MS + 2 * PAUSE_MS;
const PAGE = 1000; // PostgREST max_rows default — page or lose rows silently

function authorise(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true;
  const secret = internalSecret();
  if (secret && request.headers.get('x-internal-secret') === secret) return true;
  return false;
}

interface Centroid {
  postcode_area: string;
  lat: number;
  lng: number;
  reports: number;
}

/** Mean coordinates of each area's reports (the market's centre of mass). */
async function areaCentroids(supabase: NonNullable<ReturnType<typeof getSupabase>>): Promise<Centroid[]> {
  const rows: { postcode_area: string; lat: number; lng: number }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('analyser_reports')
      .select('postcode_area, lat, lng')
      .not('postcode_area', 'is', null)
      .not('lat', 'is', null)
      .not('lng', 'is', null)
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`centroids query failed: ${error.message}`);
    const page = (data ?? []) as typeof rows;
    rows.push(...page);
    if (page.length < PAGE) break;
  }

  const acc = new Map<string, { lat: number; lng: number; n: number }>();
  for (const r of rows) {
    const key = r.postcode_area.toUpperCase();
    const cur = acc.get(key) ?? { lat: 0, lng: 0, n: 0 };
    cur.lat += Number(r.lat);
    cur.lng += Number(r.lng);
    cur.n += 1;
    acc.set(key, cur);
  }
  return [...acc.entries()].map(([postcode_area, v]) => ({
    postcode_area,
    lat: v.lat / v.n,
    lng: v.lng / v.n,
    reports: v.n,
  }));
}

export async function GET(request: Request) {
  if (!internalSecret() && !process.env.CRON_SECRET) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }
  if (!authorise(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return Response.json({ error: 'Storage not configured' }, { status: 503 });
  }

  const dry = new URL(request.url).searchParams.get('dry') === '1';
  const started = Date.now();
  const now = new Date();

  let centroids: Centroid[];
  try {
    centroids = await areaCentroids(supabase);
  } catch (err) {
    console.error('[refresh-planning]', err);
    return Response.json({ error: 'Could not compute area centroids' }, { status: 500 });
  }

  // Stalest first so a budget-limited run still rotates through every area,
  // and keep the previous counts so a one-sided failure can't erase them.
  type Existing = { postcode_area: string; fetched_at: string; large_apps_12m: number | null; large_apps_prev_12m: number | null };
  const { data: existingRows } = await supabase
    .from('area_planning_signals')
    .select('postcode_area, fetched_at, large_apps_12m, large_apps_prev_12m');
  const existing = new Map(((existingRows ?? []) as Existing[]).map((e) => [e.postcode_area, e]));
  centroids.sort((a, b) =>
    (existing.get(a.postcode_area)?.fetched_at ?? '').localeCompare(existing.get(b.postcode_area)?.fetched_at ?? ''),
  );

  if (dry) {
    return Response.json({ dry: true, radius_km: RADIUS_KM, areas: centroids });
  }

  const { current, previous } = trailingWindows(now);
  const done: string[] = [];
  const skipped: string[] = [];
  let rateLimited: number | null = null;

  for (const c of centroids) {
    if (Date.now() - started > BUDGET_MS - AREA_WORST_CASE_MS || rateLimited !== null) {
      skipped.push(c.postcode_area);
      continue;
    }
    try {
      const base = { lat: c.lat, lng: c.lng, radiusKm: RADIUS_KM };
      const cur = await countLargeApplications({ ...base, startDate: current[0], endDate: current[1] });
      await new Promise((r) => setTimeout(r, PAUSE_MS));
      const prev = await countLargeApplications({ ...base, startDate: previous[0], endDate: previous[1] });
      await new Promise((r) => setTimeout(r, PAUSE_MS));

      if (cur === null && prev === null) {
        skipped.push(c.postcode_area);
        continue;
      }
      const old = existing.get(c.postcode_area);
      const { error } = await supabase.from('area_planning_signals').upsert(
        {
          postcode_area: c.postcode_area,
          lat: Math.round(c.lat * 1e5) / 1e5,
          lng: Math.round(c.lng * 1e5) / 1e5,
          radius_km: RADIUS_KM,
          // A failed window keeps last run's value rather than becoming null.
          large_apps_12m: cur ?? old?.large_apps_12m ?? null,
          large_apps_prev_12m: prev ?? old?.large_apps_prev_12m ?? null,
          fetched_at: now.toISOString(),
          source: 'planit',
        },
        { onConflict: 'postcode_area' },
      );
      if (error) {
        console.error(`[refresh-planning] upsert ${c.postcode_area} failed:`, error.message);
        skipped.push(c.postcode_area);
      } else {
        done.push(c.postcode_area);
      }
    } catch (err) {
      if (err instanceof PlanItRateLimited) {
        rateLimited = err.retryAfterSeconds ?? -1;
        skipped.push(c.postcode_area);
        console.warn('[refresh-planning] rate limited; stopping this run');
      } else {
        console.error(`[refresh-planning] ${c.postcode_area} failed:`, err);
        skipped.push(c.postcode_area);
      }
    }
  }

  return Response.json({
    refreshed: done,
    skipped,
    rate_limited: rateLimited !== null,
    took_ms: Date.now() - started,
  });
}
