import { requireAdminApi } from '@/lib/auth/guard';
import { countByStatus, estimatedCostGbp, getJob, getJobRows } from '@/lib/bulk/jobs';
import { kickWorker } from '@/lib/bulk/kick';

export const runtime = 'nodejs';

/** Job state + rows, polled by the progress view. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;

  const { jobId } = await params;

  try {
    const job = await getJob(jobId);
    if (!job) return Response.json({ error: 'Job not found.' }, { status: 404 });

    const rows = await getJobRows(jobId);
    const counts = countByStatus(rows);

    // ── Resume on view ──────────────────────────────────────────
    // The progress page polls this every 5s. If the job is running, has work
    // left, and nothing is currently in flight, the chain has been dropped —
    // restart it. On Vercel Hobby the cron backstop is only DAILY, so without
    // this a broken chain would stall the batch until tomorrow.
    //
    // Costs nothing when healthy (a row in flight means no kick) and is safe to
    // over-fire: claiming is atomic, so a redundant worker simply finds nothing.
    const stalled =
      job.status === 'running'
      && counts.pending > 0
      && counts.claimed === 0
      && counts.running === 0;
    if (stalled) {
      console.log(`[bulk] job ${jobId} looks stalled (${counts.pending} pending, none in flight) — restarting the chain`);
      kickWorker(request);
    }

    return Response.json({
      job,
      counts,
      estimatedCostGbp: estimatedCostGbp(counts.pending + counts.claimed + counts.running + counts.succeeded + counts.failed),
      rows,
    });
  } catch (err) {
    console.error('[bulk] could not load job:', err);
    return Response.json(
      { error: err instanceof Error ? err.message : 'Could not load the job.' },
      { status: 500 },
    );
  }
}
