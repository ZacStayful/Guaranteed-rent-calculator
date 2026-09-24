// ─── PlanIt: UK planning applications ─────────────────────────────
//
// Public, keyless API (https://www.planit.org.uk/api/). Used as a proxy for
// CONTRACTOR demand per postcode area: the count of large planning
// applications started within a radius of the area's centre over the last 12
// months, and the 12 months before that (for a direction). Nothing else from
// the response is stored.
//
// Etiquette the API enforces: a real User-Agent (403 otherwise) and a rate
// limit (429 + Retry-After). One count costs one request with pg_sz=1, so a
// full refresh is two requests per area, run monthly.

const BASE = 'https://www.planit.org.uk/api/applics/json';
const USER_AGENT = 'StayfulMarketExplorer/1.0 (+https://stayful.co.uk; hello@stayful.co.uk)';

export interface PlanItWindow {
  lat: number;
  lng: number;
  radiusKm: number;
  startDate: Date; // inclusive
  endDate: Date; // inclusive
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Exactly the request we send — exported so it can be tested without the network. */
export function buildPlanItUrl(w: PlanItWindow): string {
  const url = new URL(BASE);
  url.searchParams.set('lat', w.lat.toFixed(5));
  url.searchParams.set('lng', w.lng.toFixed(5));
  url.searchParams.set('krad', String(w.radiusKm));
  url.searchParams.set('app_size', 'Large');
  url.searchParams.set('start_date', ymd(w.startDate));
  url.searchParams.set('end_date', ymd(w.endDate));
  url.searchParams.set('pg_sz', '1');
  url.searchParams.set('select', 'uid');
  return url.toString();
}

/** The two 12-month windows ending today: [prev, current]. */
export function trailingWindows(now: Date): { current: [Date, Date]; previous: [Date, Date] } {
  const end = new Date(now);
  const start = new Date(now);
  start.setUTCFullYear(start.getUTCFullYear() - 1);
  const prevEnd = new Date(start);
  prevEnd.setUTCDate(prevEnd.getUTCDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setUTCFullYear(prevStart.getUTCFullYear() - 1);
  return { current: [start, end], previous: [prevStart, prevEnd] };
}

export class PlanItRateLimited extends Error {
  retryAfterSeconds: number | null;
  constructor(retryAfterSeconds: number | null) {
    super('PlanIt rate limit');
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

type Fetch = typeof fetch;

/**
 * Number of large applications in the window, or null when the API gave no
 * usable answer (blocked, malformed, network). Throws PlanItRateLimited on
 * 429 so a batch caller can stop for this run rather than hammer the API.
 */
export const PLANIT_TIMEOUT_MS = 10_000;

export async function countLargeApplications(w: PlanItWindow, fetchImpl: Fetch = fetch, timeoutMs = PLANIT_TIMEOUT_MS): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(buildPlanItUrl(w), {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (res.status === 429) {
      // Retry-After may be absent, seconds, or an HTTP-date; only seconds are useful here.
      const raw = res.headers.get('retry-after');
      const ra = raw === null ? NaN : Number(raw);
      throw new PlanItRateLimited(Number.isFinite(ra) ? ra : null);
    }
    if (!res.ok) {
      console.warn(`[planit] HTTP ${res.status}`);
      return null;
    }
    const body = (await res.json()) as { total?: unknown };
    const total = typeof body?.total === 'number' ? body.total : Number(body?.total);
    return Number.isFinite(total) && total >= 0 ? Math.round(total) : null;
  } catch (err) {
    if (err instanceof PlanItRateLimited) throw err;
    console.warn('[planit] request failed:', (err as Error)?.message ?? err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
