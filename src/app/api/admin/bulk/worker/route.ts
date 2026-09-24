import { randomUUID } from 'node:crypto';
import { after } from 'next/server';
import { getAdminSession } from '@/lib/auth/guard';
import {
  claimRows, countByStatus, finishJob, getJobRows, updateClaimedRow,
  StorageNotConfiguredError, type BulkJobRow,
} from '@/lib/bulk/jobs';
import { maxInflight, rowConcurrency } from '@/lib/bulk/config';
import { bulkSideEffectGate, ConsecutiveFailureBreaker } from '@/lib/bulk/gate';
import { internalSecret } from '@/lib/bulk/kick';
import { normaliseAnalysisInput } from '@/lib/pipeline/input';
import { runAnalysis } from '@/lib/pipeline/runAnalysis';
import { getLeadQualification } from '@/lib/analysis';

export const runtime = 'nodejs';
// 60 is the ceiling on Vercel Hobby. Route segment config must be a static
// literal, so this cannot be read from the environment — on Pro, raise it to
// 300 and set BULK_WORKER_BUDGET_MS to match. See docs/BULK_UPLOAD.md.
export const maxDuration = 60;

// How long this invocation may keep claiming new work. Must stay under the
// deployed maxDuration with room for in-flight rows to land.
function budgetMs(): number {
  const n = Number(process.env.BULK_WORKER_BUDGET_MS);
  return Number.isFinite(n) && n > 0 ? n : 55_000;
}

// Reserve enough to let in-flight rows finish and the job be finalised, rather
// than being cut off mid-write.
//
// NOTE on Hobby: a worst-case row (~70s — Airbtics alone polls up to 25s, plus
// the PDF render and two Monday calls) exceeds the 60s function ceiling
// outright, so no reserve can guarantee it completes. Such a row is killed
// after its Airbtics report has been paid for, reclaimed once the claim goes
// stale, and retried. This is a real limitation of running on Hobby, not a
// tuning problem — see docs/BULK_UPLOAD.md.
function reserveMs(): number {
  return Math.min(20_000, Math.floor(budgetMs() * 0.4));
}

const STAGGER_MS = 500;

/**
 * Serialises PDF rendering across concurrent rows.
 *
 * @react-pdf/renderer is CPU- and memory-hungry; three concurrent 6-page
 * renders in a 1-2GB function is a plausible OOM. Only the render is locked —
 * the API-fetch phases, which are the slow part, stay concurrent.
 */
function createRenderLock() {
  let tail: Promise<unknown> = Promise.resolve();
  return function withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = tail.then(fn, fn);
    tail = run.catch(() => {});
    return run;
  };
}

/**
 * Fire a successor invocation.
 *
 * Uses `after()` so the request goes out once this response has been flushed,
 * and is never awaited — the job is already durable in Postgres, so a failed
 * kick costs latency, not correctness. Cron remains the final backstop.
 */
function kickSelf(request: Request): void {
  const secret = internalSecret();
  if (!secret) {
    console.log('[bulk] cannot chain (INTERNAL_API_SECRET unset) — falling back to cron');
    return;
  }
  const origin = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : new URL(request.url).origin;

  after(() => {
    void fetch(`${origin}/api/admin/bulk/worker`, {
      headers: { 'x-internal-secret': secret },
    }).catch((err) => {
      console.log('[bulk] chain kick failed, cron will pick it up:', err?.message ?? err);
    });
  });
}

function authorise(request: Request): boolean {
  // Vercel Cron sends this automatically when CRON_SECRET is set.
  const cronSecret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true;

  // Manual kicks (the Run button, self-chaining) use the shared internal secret.
  const secret = internalSecret();
  if (secret && request.headers.get('x-internal-secret') === secret) return true;

  return false;
}

async function processRow(row: BulkJobRow, claimToken: string, renderLock: ReturnType<typeof createRenderLock>) {
  const marked = await updateClaimedRow(row.id, claimToken, {
    status: 'running',
    started_at: new Date().toISOString(),
  });
  // Lost the claim (this worker went stale and someone else took the row) —
  // stop before spending anything.
  if (!marked) {
    console.log(`[bulk] row ${row.row_number}: claim lost, skipping`);
    return { gated: false, skipped: true };
  }

  const normalised = normaliseAnalysisInput({
    address: row.input_address,
    postcode: row.input_postcode,
    bedrooms: row.input_bedrooms,
    guests: row.input_guests,
    email: row.input_email,
    phone: row.input_phone,
    // Long-let rent is deliberately left unset so PropertyData estimates it,
    // exactly as when a lead ticks "Not sure" on the public form.
  });

  if (!normalised.ok) {
    await updateClaimedRow(row.id, claimToken, {
      status: 'failed',
      error_code: 'invalid_input',
      error_message: normalised.error,
      finished_at: new Date().toISOString(),
    });
    return { gated: false, skipped: false };
  }

  const outcome = await runAnalysis(normalised.input, {
    reportSource: 'bulk',
    // Never consume a lead's free analyses on our own batch job.
    incrementUsage: false,
    // Write to the item that was shown and approved at preview time.
    mondayItemId: row.monday_item_id,
    sideEffectGate: bulkSideEffectGate,
    renderLock,
  });

  if (!outcome.ok) {
    const retryable = outcome.stage !== 'geocode';
    await updateClaimedRow(row.id, claimToken, {
      // A geocode failure will fail again on retry, so don't burn a second
      // attempt on it; anything else may be transient.
      status: retryable && row.attempts < row.max_attempts ? 'pending' : 'failed',
      error_code: outcome.errorCode,
      error_message: outcome.error,
      finished_at: new Date().toISOString(),
    });
    return { gated: false, skipped: false };
  }

  const { result } = outcome;
  const gated = Boolean(outcome.sideEffectsSkippedReason);
  const uplift = result.recommendation?.upliftPct ?? null;

  await updateClaimedRow(row.id, claimToken, {
    status: gated ? 'failed' : 'succeeded',
    error_code: gated ? 'no_str_data' : null,
    error_message: outcome.sideEffectsSkippedReason ?? null,
    report_id: outcome.reportId,
    gross_revenue: result.shortLet.annualRevenue,
    net_revenue: result.financials.shortLetNetAnnual,
    long_let_monthly: result.recommendation?.longLetMonthly ?? result.longLet.monthlyRent,
    recommendation: result.recommendation?.recommendation ?? null,
    qualification: uplift === null ? null : getLeadQualification(uplift),
    uplift_pct: uplift,
    data_quality_level: result.dataQuality.level,
    comparables_found: result.dataQuality.comparablesFound,
    monday_synced: outcome.mondaySynced,
    pdf_uploaded: outcome.pdfUploaded,
    finished_at: new Date().toISOString(),
  });

  return { gated, skipped: false };
}

/** Mark any running job whose rows are all terminal as complete. */
async function finaliseJobs(jobIds: Set<string>) {
  for (const jobId of jobIds) {
    try {
      const rows = await getJobRows(jobId);
      const counts = countByStatus(rows);
      if (counts.pending === 0 && counts.claimed === 0 && counts.running === 0) {
        await finishJob(jobId, 'completed');
        console.log(`[bulk] job ${jobId} complete: ${counts.succeeded} done, ${counts.failed} failed, ${counts.skipped} skipped`);
      }
    } catch (err) {
      console.error(`[bulk] could not finalise job ${jobId}:`, err);
    }
  }
}

export async function GET(request: Request) {
  // Cron / internal secret, or a signed-in admin poking it by hand.
  if (!authorise(request)) {
    const session = await getAdminSession().catch(() => null);
    if (!session) {
      // 404 rather than 401 so the endpoint isn't discoverable.
      return Response.json({ error: 'Not found' }, { status: 404 });
    }
  }

  const started = Date.now();
  const claimDeadline = budgetMs() - reserveMs();
  const claimToken = randomUUID();
  const renderLock = createRenderLock();
  const breaker = new ConsecutiveFailureBreaker();
  const touchedJobs = new Set<string>();
  let processed = 0;
  let chainedAhead = false;

  try {
    while (Date.now() - started < claimDeadline) {
      const rows = await claimRows({
        limit: rowConcurrency(),
        claimToken,
        maxInflight: maxInflight(),
      });

      // Nothing to do — the common and cheapest path.
      if (rows.length === 0) break;

      for (const row of rows) touchedJobs.add(row.job_id);

      // ── Chain AHEAD, before doing the work ──────────────────────
      // The successor used to be kicked at the very end of this handler, which
      // meant an invocation killed mid-row (Vercel Hobby cuts functions off at
      // 60s) took the whole chain down with it and the job idled until the next
      // cron sweep — which on Hobby is only daily.
      //
      // Firing it now means the successor is already running before this
      // invocation can die. Overlap is safe by construction: claiming is atomic
      // (FOR UPDATE SKIP LOCKED) so two workers never get the same row, and
      // p_max_inflight still caps how many run at once. Each invocation spawns
      // exactly one successor, so the number of live chains stays flat.
      if (!chainedAhead) {
        chainedAhead = true;
        kickSelf(request);
      }

      const results = await Promise.allSettled(
        rows.map((row, i) =>
          // Stagger so concurrent Airbtics report requests don't land together.
          new Promise((r) => setTimeout(r, i * STAGGER_MS)).then(() =>
            processRow(row, claimToken, renderLock),
          ),
        ),
      );

      for (const settled of results) {
        if (settled.status === 'rejected') {
          console.error('[bulk] row threw:', settled.reason);
          breaker.record(true);
          continue;
        }
        if (settled.value.skipped) continue;
        processed++;
        breaker.record(settled.value.gated);
      }

      if (breaker.tripped) {
        for (const jobId of touchedJobs) {
          await finishJob(jobId, 'paused', breaker.reason);
        }
        console.warn(`[bulk] circuit breaker tripped: ${breaker.reason}`);
        return Response.json({ processed, paused: true, reason: breaker.reason });
      }
    }

    await finaliseJobs(touchedJobs);

    let remaining = 0;
    for (const jobId of touchedJobs) {
      const counts = countByStatus(await getJobRows(jobId));
      remaining += counts.pending;
    }

    // Belt and braces: if work remains and we somehow never chained ahead (an
    // invocation that claimed nothing on its first pass, then found work), kick
    // a successor now.
    if (remaining > 0 && !chainedAhead) kickSelf(request);

    return Response.json({ processed, remaining });
  } catch (err) {
    if (err instanceof StorageNotConfiguredError) {
      return Response.json({ error: err.message }, { status: 503 });
    }
    console.error('[bulk] worker error:', err);
    return Response.json(
      { error: err instanceof Error ? err.message : 'Worker failed.' },
      { status: 500 },
    );
  }
}
