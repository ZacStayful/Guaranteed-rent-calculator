import { requireAdminApi } from '@/lib/auth/guard';
import { countByStatus, estimatedCostGbp, getJob, getJobRows, startJob } from '@/lib/bulk/jobs';
import { maxJobCostGbp } from '@/lib/bulk/config';
import { kickWorker } from '@/lib/bulk/kick';

export const runtime = 'nodejs';

/**
 * Stage 2: confirm and run.
 *
 * The cost cap is re-checked here, not just at preview — a draft could have sat
 * around while the limit was lowered, and this is the call that starts spending.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;

  const { jobId } = await params;

  try {
    const job = await getJob(jobId);
    if (!job) return Response.json({ error: 'Job not found.' }, { status: 404 });
    if (job.status !== 'draft') {
      return Response.json(
        { error: `This job is already ${job.status}.` },
        { status: 409 },
      );
    }

    const rows = await getJobRows(jobId);
    const counts = countByStatus(rows);
    if (counts.pending === 0) {
      return Response.json(
        { error: 'Nothing to run — every row was skipped. Fix the sheet and upload again.' },
        { status: 400 },
      );
    }

    const cost = estimatedCostGbp(counts.pending);
    if (cost > maxJobCostGbp()) {
      return Response.json(
        { error: `This batch would cost about £${cost.toFixed(2)}, over the £${maxJobCostGbp()} limit.` },
        { status: 400 },
      );
    }

    await startJob(jobId);
    console.log(`[bulk] job ${jobId} started by ${guard.session.email}: ${counts.pending} rows, ~£${cost}`);

    // Start immediately rather than waiting up to a minute for the next cron
    // tick. Fire-and-forget: cron is the durability guarantee, this is only a
    // latency improvement, so a failed kick is not an error.
    kickWorker(request);

    return Response.json({ ok: true, runnableRows: counts.pending, estimatedCostGbp: cost });
  } catch (err) {
    console.error('[bulk] could not start job:', err);
    return Response.json(
      { error: err instanceof Error ? err.message : 'Could not start the job.' },
      { status: 500 },
    );
  }
}
