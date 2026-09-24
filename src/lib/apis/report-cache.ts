// ─── Durable Airbtics report-id cache ─────────────────────────────
//
// Creating an Airbtics report costs ~£0.50; reading an existing one is free.
// airbtics.ts caches the report id for 24h, but in a module-level Map that dies
// with the serverless invocation — so in production the cache almost never hits
// and nearly every run buys a fresh report.
//
// This backs that same cache with Postgres. Two consequences:
//
//   • Repeated postcode + bedroom combinations stop re-buying reports, at any
//     scale and on any plan.
//   • A bulk row killed at Vercel Hobby's 60s function ceiling has already paid
//     for its report; on retry it now re-reads that report instead of buying a
//     second one. That turns "£1 spent, row failed" into "row took two
//     attempts, cost 50p, succeeded".
//
// Degrades to memory-only when Supabase isn't configured, which is exactly the
// behaviour before this existed — so the live single-property path is never
// made worse by a storage outage.

import { getSupabase } from "../supabase.ts";

const TABLE = "airbtics_report_cache";

/** Mirrors the durable store so repeat lookups in one invocation are free. */
const memory = new Map<string, { reportId: string; expiresAt: number }>();

/**
 * Look up a cached report id.
 *
 * Checks the in-process map first, then Postgres. Never throws — a cache miss
 * and a cache failure are the same thing to the caller: buy a new report.
 */
export async function getCachedReportId(cacheKey: string): Promise<string | null> {
  const local = memory.get(cacheKey);
  if (local && Date.now() < local.expiresAt) return local.reportId;

  const supabase = getSupabase();
  if (!supabase) return null;

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("report_id, expires_at")
      .eq("cache_key", cacheKey)
      .maybeSingle();

    if (error || !data) return null;

    const expiresAt = new Date(data.expires_at).getTime();
    if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt) return null;

    // Warm the local map so a second lookup in this invocation is free.
    memory.set(cacheKey, { reportId: data.report_id, expiresAt });
    return data.report_id;
  } catch (err) {
    console.error("[Airbtics cache] lookup failed:", err);
    return null;
  }
}

/**
 * Record a freshly purchased report id.
 *
 * Fire-and-forget in spirit: a failed write only costs a future cache miss, so
 * it must never break the analysis that just paid for the report.
 */
export async function setCachedReportId(
  cacheKey: string,
  reportId: string,
  ttlMs: number,
): Promise<void> {
  const expiresAt = Date.now() + ttlMs;
  memory.set(cacheKey, { reportId, expiresAt });

  const supabase = getSupabase();
  if (!supabase) return;

  try {
    const { error } = await supabase
      .from(TABLE)
      .upsert(
        {
          cache_key: cacheKey,
          report_id: reportId,
          expires_at: new Date(expiresAt).toISOString(),
        },
        { onConflict: "cache_key" },
      );
    if (error) console.error("[Airbtics cache] write failed:", error.message);
  } catch (err) {
    console.error("[Airbtics cache] write failed:", err);
  }
}

/** Drop a report id that turned out to be unreadable (deleted upstream). */
export async function forgetCachedReportId(cacheKey: string): Promise<void> {
  memory.delete(cacheKey);
  const supabase = getSupabase();
  if (!supabase) return;
  try {
    await supabase.from(TABLE).delete().eq("cache_key", cacheKey);
  } catch (err) {
    console.error("[Airbtics cache] delete failed:", err);
  }
}

/** Test seam. */
export function __clearMemoryCache(): void {
  memory.clear();
}
