// ─── Worker kick ──────────────────────────────────────────────────
//
// Nudges the worker to start now rather than waiting up to a minute for the
// next cron tick. Purely a latency improvement: cron is the durability
// guarantee, so a failed kick is logged and ignored.

/** Authorises a self-call to the worker. */
export function internalSecret(): string | null {
  return process.env.INTERNAL_API_SECRET || null;
}

function baseUrl(request: Request): string | null {
  if (process.env.BULK_WORKER_URL) return process.env.BULK_WORKER_URL;
  // VERCEL_URL is the deployment host, without a scheme.
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  try {
    return new URL(request.url).origin;
  } catch {
    return null;
  }
}

/**
 * Fire-and-forget request to the worker. Never awaited by the caller and never
 * throws — the job is already durable in Postgres by the time this runs.
 */
export function kickWorker(request: Request): void {
  const secret = internalSecret();
  const base = baseUrl(request);
  if (!secret || !base) {
    console.log('[bulk] worker kick skipped (INTERNAL_API_SECRET or base URL unset) — cron will pick it up');
    return;
  }

  void fetch(`${base}/api/admin/bulk/worker`, {
    method: 'GET',
    headers: { 'x-internal-secret': secret },
  }).catch((err) => {
    console.log('[bulk] worker kick failed, cron will pick it up:', err?.message ?? err);
  });
}
