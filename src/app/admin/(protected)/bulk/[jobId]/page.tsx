import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { countByStatus, estimatedCostGbp, getJob, getJobRows } from '@/lib/bulk/jobs';
import { JobView } from '@/components/admin/JobView';

export const metadata: Metadata = {
  title: 'Bulk job — Stayful Admin',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function BulkJobPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = await params;

  const job = await getJob(jobId).catch(() => null);
  if (!job) notFound();

  const rows = await getJobRows(jobId);
  const counts = countByStatus(rows);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/bulk" className="text-xs text-neutral-500 underline underline-offset-2">
          ← All uploads
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-neutral-900">{job.filename ?? 'Bulk job'}</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Uploaded {new Date(job.created_at).toLocaleString('en-GB')} by {job.created_by ?? 'unknown'}
        </p>
      </div>

      <JobView
        initialJob={job}
        initialRows={rows}
        initialCounts={counts}
        estimatedCostGbp={estimatedCostGbp(counts.pending)}
        boardId={process.env.MONDAY_BOARD_ID || '5891626711'}
      />
    </div>
  );
}
