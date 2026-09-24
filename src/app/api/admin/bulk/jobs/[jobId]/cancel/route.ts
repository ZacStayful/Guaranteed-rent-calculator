import { requireAdminApi } from '@/lib/auth/guard';
import { cancelJob, getJob } from '@/lib/bulk/jobs';

export const runtime = 'nodejs';

/**
 * Stop a job.
 *
 * Rows already in flight finish — they've been paid for, so letting them land
 * is better than abandoning them half-written. The claim function filters on
 * `j.status = 'running'`, so nothing new starts.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;

  const { jobId } = await params;

  try {
    const job = await getJob(jobId);
    if (!job) return Response.json({ error: 'Job not found.' }, { status: 404 });

    await cancelJob(jobId);
    console.log(`[bulk] job ${jobId} cancelled by ${guard.session.email}`);
    return Response.json({ ok: true });
  } catch (err) {
    console.error('[bulk] could not cancel job:', err);
    return Response.json(
      { error: err instanceof Error ? err.message : 'Could not cancel the job.' },
      { status: 500 },
    );
  }
}
