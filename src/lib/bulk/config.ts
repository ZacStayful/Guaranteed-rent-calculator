// ─── Bulk run configuration ───────────────────────────────────────
//
// All tunable from env so the first real batches can be run small and cautious
// without a redeploy.

/** Rows per upload. Larger backlogs run as sequential batches of this size. */
export function maxRows(): number {
  const n = Number(process.env.BULK_MAX_ROWS);
  return Number.isFinite(n) && n > 0 ? n : 100;
}

/**
 * Rows processed simultaneously inside one worker invocation.
 *
 * Defaults to 1, which is the right choice on Vercel Hobby: the function
 * ceiling there is 60s, and while a single row is typically 20-30s, three
 * sharing one invocation contend for CPU — the PDF render especially — which
 * is what pushes an invocation past the limit and gets a row killed AFTER its
 * Airbtics report has been paid for.
 *
 * One row per invocation, with the worker chaining into the next, keeps every
 * invocation comfortably inside the ceiling. On Pro (300s) raise this to 3.
 */
export function rowConcurrency(): number {
  const n = Number(process.env.BULK_ROW_CONCURRENCY);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * Global ceiling on rows running at once across every worker. This is the
 * Airbtics spend-rate throttle, not just a concurrency limit.
 */
export function maxInflight(): number {
  const n = Number(process.env.BULK_MAX_INFLIGHT);
  return Number.isFinite(n) && n > 0 ? n : 6;
}

/**
 * Roughly what one row costs in Airbtics credit. Used for the estimate shown
 * before a run is confirmed, and for the hard cap below.
 */
export const COST_PER_ROW_GBP = 0.5;

/** Hard ceiling on a single job's estimated spend. */
export function maxJobCostGbp(): number {
  const n = Number(process.env.BULK_MAX_JOB_COST_GBP);
  return Number.isFinite(n) && n > 0 ? n : 100;
}

/**
 * PIPELINE_FAKE=1 — return a deterministic analysis without calling any
 * external API.
 *
 * Simply unsetting the API keys does NOT give a free dry run: geocodePostcode
 * throws without GOOGLE_PLACES_API_KEY, so every row would fail at the first
 * step and none of the job machinery downstream would ever be exercised. This
 * flag is what makes it possible to test parsing, matching, claiming,
 * concurrency, retries, cancellation and the whole UI for £0.
 */
export function isPipelineFake(): boolean {
  return process.env.PIPELINE_FAKE === '1';
}

/**
 * MONDAY_DRY_RUN=1 — log the exact column payload that would be written and
 * report success, without touching the board.
 *
 * Pairs with PIPELINE_FAKE to exercise everything against the REAL Monday
 * board (matching included, which is the part most worth testing against real
 * data) while mutating nothing.
 */
export function isMondayDryRun(): boolean {
  return process.env.MONDAY_DRY_RUN === '1';
}
