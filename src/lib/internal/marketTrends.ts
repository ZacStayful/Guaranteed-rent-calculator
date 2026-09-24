// ─── Market Explorer trends ────────────────────────────────────────
//
// Monthly buckets behind /api/market-trends: how many analyser reports were
// run (investor enquiries), and the average ADR / occupancy / gross revenue
// of those reports, per postcode area and nationally, for the last N months.
//
// Only rows from the LIVE analyser (source = 'analyser') are bucketed: the
// Monday PDF backfill stamped created_at with the import date, not the date
// the report was made, so it would show up as one fake spike. Every month in
// the window is present (zero-filled, averages null) so the frontend never
// gap-fills.

import { occupancyToPercent } from '@/lib/utils/occupancy';

export interface TrendRow {
  postcode_area: string | null;
  created_at: string;
  adr: number | null;
  occupancy: number | null; // mixed units, normalised
  gross_revenue: number | null;
  source: string | null;
  extraction_status: string | null;
}

export interface MonthBucket {
  month: string; // YYYY-MM (UTC)
  reports: number;
  avg_adr: number | null;
  avg_occupancy: number | null; // 0–100
  avg_gross_revenue: number | null;
}

export interface MarketTrendsResponse {
  months: string[];
  national: MonthBucket[];
  areas: Record<string, MonthBucket[]>;
  generated_at: string;
}

export const MAX_MONTHS = 24;
export const DEFAULT_MONTHS = 12;

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The N month keys ending with the month containing `now`, oldest first. */
export function monthKeys(months: number, now: Date): string[] {
  const out: string[] = [];
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));
  for (let i = 0; i < months; i++) {
    out.push(monthKey(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1))));
  }
  return out;
}

/** ISO timestamp of the first instant of the window (for the DB query). */
export function windowStart(months: number, now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1)).toISOString();
}

function avg(values: number[], decimals: number): number | null {
  if (values.length === 0) return null;
  const f = 10 ** decimals;
  return Math.round((values.reduce((s, v) => s + v, 0) / values.length) * f) / f;
}

function bucket(month: string, rows: TrendRow[]): MonthBucket {
  const num = (v: number | null) => (typeof v === 'number' && !Number.isNaN(v) ? v : null);
  const adr = rows.map((r) => num(r.adr)).filter((v): v is number => v !== null);
  const occ = rows.map((r) => occupancyToPercent(r.occupancy)).filter((v): v is number => v !== null);
  const rev = rows.map((r) => num(r.gross_revenue)).filter((v): v is number => v !== null);
  return { month, reports: rows.length, avg_adr: avg(adr, 0), avg_occupancy: avg(occ, 1), avg_gross_revenue: avg(rev, 0) };
}

export function bucketMonthly(rows: TrendRow[], opts: { months: number; now: Date; area?: string | null }): MarketTrendsResponse {
  const months = monthKeys(opts.months, opts.now);
  const inWindow = new Set(months);
  const wanted = opts.area ? opts.area.toUpperCase() : null;

  const national = new Map<string, TrendRow[]>();
  const byArea = new Map<string, Map<string, TrendRow[]>>();

  for (const r of rows) {
    if (r.source !== 'analyser') continue;
    if (r.extraction_status === 'error') continue;
    const d = new Date(r.created_at);
    if (Number.isNaN(d.getTime())) continue;
    const m = monthKey(d);
    if (!inWindow.has(m)) continue;
    if (!national.has(m)) national.set(m, []);
    national.get(m)!.push(r);
    const area = r.postcode_area?.toUpperCase() ?? null;
    if (!area || (wanted && area !== wanted)) continue;
    if (!byArea.has(area)) byArea.set(area, new Map());
    const am = byArea.get(area)!;
    if (!am.has(m)) am.set(m, []);
    am.get(m)!.push(r);
  }

  const areas: Record<string, MonthBucket[]> = {};
  for (const [area, am] of [...byArea.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    areas[area] = months.map((m) => bucket(m, am.get(m) ?? []));
  }

  return {
    months,
    national: months.map((m) => bucket(m, national.get(m) ?? [])),
    areas,
    generated_at: opts.now.toISOString(),
  };
}
