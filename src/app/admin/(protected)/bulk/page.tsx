import type { Metadata } from 'next';
import Link from 'next/link';
import { listJobs, StorageNotConfiguredError, type BulkJob } from '@/lib/bulk/jobs';
import { BulkUploadForm } from '@/components/admin/BulkUploadForm';
import { StatusPill } from '@/components/admin/StatusPill';

export const metadata: Metadata = {
  title: 'Bulk analyser — Stayful Admin',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function BulkPage() {
  let jobs: BulkJob[];
  let storageError: string | null = null;
  try {
    jobs = await listJobs();
  } catch (err) {
    jobs = [];
    storageError =
      err instanceof StorageNotConfiguredError
        ? 'Supabase is not configured, so jobs cannot be stored. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'
        : err instanceof Error ? err.message : 'Could not load jobs.';
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">Bulk analyser</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Upload a spreadsheet of properties. Each row runs through the same analyser a lead uses,
          and the PDF lands on the matching Monday item.
        </p>
      </div>

      {storageError && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {storageError}
        </div>
      )}

      <BulkUploadForm />

      <section>
        <h2 className="text-sm font-semibold text-neutral-900">Recent uploads</h2>
        {jobs.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">Nothing uploaded yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-lg border border-neutral-200 bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs text-neutral-600">
                <tr>
                  <th className="px-4 py-2 font-medium">File</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Rows</th>
                  <th className="px-4 py-2 font-medium">Uploaded</th>
                  <th className="px-4 py-2 font-medium">By</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id} className="border-b border-neutral-100 last:border-0">
                    <td className="px-4 py-2 font-medium text-neutral-900">{job.filename ?? '—'}</td>
                    <td className="px-4 py-2"><StatusPill status={job.status} /></td>
                    <td className="px-4 py-2 text-neutral-600">
                      {job.runnable_rows} of {job.total_rows}
                    </td>
                    <td className="px-4 py-2 text-neutral-600">
                      {new Date(job.created_at).toLocaleString('en-GB')}
                    </td>
                    <td className="px-4 py-2 text-neutral-500">{job.created_by ?? '—'}</td>
                    <td className="px-4 py-2 text-right">
                      <Link
                        href={`/admin/bulk/${job.id}`}
                        className="text-neutral-900 underline underline-offset-2"
                      >
                        {job.status === 'draft' ? 'Review' : 'View'}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
