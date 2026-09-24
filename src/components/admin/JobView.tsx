'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { BulkJob, BulkJobRow, StatusCounts } from '@/lib/bulk/jobs';
import { WARNING_LABELS, type RowWarning } from '@/lib/bulk/warnings';
import { StatusPill } from './StatusPill';

const POLL_MS = 5000;

function money(n: number) {
  return `£${n.toFixed(2)}`;
}

function warningText(warnings: RowWarning[] | null): string {
  if (!warnings?.length) return '';
  return warnings.map((w) => WARNING_LABELS[w] ?? w).join(' · ');
}

export function JobView({
  initialJob,
  initialRows,
  initialCounts,
  estimatedCostGbp,
  boardId,
}: {
  initialJob: BulkJob;
  initialRows: BulkJobRow[];
  initialCounts: StatusCounts;
  estimatedCostGbp: number;
  boardId: string;
}) {
  const router = useRouter();
  const [job, setJob] = useState(initialJob);
  const [rows, setRows] = useState(initialRows);
  const [counts, setCounts] = useState(initialCounts);
  const [cost, setCost] = useState(estimatedCostGbp);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/bulk/jobs/${job.id}`, { cache: 'no-store' });
      if (!res.ok) return;
      const json = await res.json();
      setJob(json.job);
      setRows(json.rows);
      setCounts(json.counts);
    } catch {
      // Transient — the next poll will pick it up.
    }
  }, [job.id]);

  // Poll only while there is something to watch. The job runs server-side, so
  // this is just a view; closing the tab does not stop it.
  useEffect(() => {
    const active = job.status === 'running' || counts.claimed > 0 || counts.running > 0;
    if (!active) return;
    timer.current = setTimeout(refresh, POLL_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [job.status, counts, refresh]);

  async function post(path: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(path, { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? 'Something went wrong.');
        return;
      }
      if (typeof json.estimatedCostGbp === 'number') setCost(json.estimatedCostGbp);
      await refresh();
      router.refresh();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  const isDraft = job.status === 'draft';
  const done = counts.succeeded + counts.failed + counts.skipped;
  const progress = job.total_rows > 0 ? Math.round((done / job.total_rows) * 100) : 0;

  return (
    <div className="space-y-5">
      {/* Summary */}
      <div className="rounded-lg border border-neutral-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <StatusPill status={job.status} />
            <span className="text-neutral-900">
              <strong>{counts.pending + counts.claimed + counts.running}</strong> to run
            </span>
            <span className="text-green-700"><strong>{counts.succeeded}</strong> done</span>
            {counts.failed > 0 && (
              <span className="text-red-700"><strong>{counts.failed}</strong> failed</span>
            )}
            <span className="text-neutral-500"><strong>{counts.skipped}</strong> skipped</span>
          </div>

          <div className="flex items-center gap-3">
            {isDraft && (
              <>
                <span className="text-sm text-neutral-600">
                  Estimated cost <strong className="text-neutral-900">{money(cost)}</strong>
                </span>
                <button
                  onClick={() => post(`/api/admin/bulk/jobs/${job.id}/start`)}
                  disabled={busy || counts.pending === 0}
                  className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-40"
                >
                  {busy ? 'Starting…' : `Run ${counts.pending} rows`}
                </button>
              </>
            )}
            {(job.status === 'running' || job.status === 'paused') && (
              <button
                onClick={() => post(`/api/admin/bulk/jobs/${job.id}/cancel`)}
                disabled={busy}
                className="rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-40"
              >
                Cancel
              </button>
            )}
            {!isDraft && (
              <a
                href={`/api/admin/bulk/jobs/${job.id}/results`}
                className="rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
              >
                Download results CSV
              </a>
            )}
          </div>
        </div>

        {job.status === 'running' && (
          <div className="mt-4">
            <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-100">
              <div className="h-full bg-neutral-900 transition-all" style={{ width: `${progress}%` }} />
            </div>
            <p className="mt-2 text-xs text-neutral-500">
              {progress}% · Safe to close this tab — the job keeps running on the server.
            </p>
          </div>
        )}

        {job.status === 'paused' && job.paused_reason && (
          <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Paused: {job.paused_reason}
          </p>
        )}

        {isDraft && counts.pending === 0 && (
          <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            No rows can run — every one was skipped. Fix the sheet and upload again.
          </p>
        )}

        {error && (
          <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>
        )}
      </div>

      {/* Rows */}
      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs text-neutral-600">
            <tr>
              <th className="px-3 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">Address</th>
              <th className="px-3 py-2 font-medium">Beds</th>
              <th className="px-3 py-2 font-medium">Contact</th>
              <th className="px-3 py-2 font-medium">Monday lead</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Result</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-neutral-100 align-top last:border-0">
                <td className="px-3 py-2 text-neutral-500">{row.row_number}</td>
                <td className="px-3 py-2">
                  <div className="text-neutral-900">{row.input_address ?? '—'}</div>
                  {row.input_postcode && (
                    <div className="text-xs text-neutral-500">{row.input_postcode}</div>
                  )}
                  {row.warnings?.length > 0 && (
                    <div className="mt-0.5 text-xs text-amber-700">{warningText(row.warnings)}</div>
                  )}
                </td>
                <td className="px-3 py-2 text-neutral-700">{row.input_bedrooms ?? '—'}</td>
                <td className="px-3 py-2 text-xs text-neutral-600">
                  <div>{row.input_email ?? '—'}</div>
                  <div>{row.input_phone ?? ''}</div>
                </td>
                <td className="px-3 py-2">
                  {row.monday_item_id ? (
                    <>
                      <a
                        href={`https://stayful.monday.com/boards/${boardId}/pulses/${row.monday_item_id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-neutral-900 underline underline-offset-2"
                      >
                        {row.monday_item_name ?? row.monday_item_id}
                      </a>
                      <div className="text-xs text-neutral-400">{row.match_method}</div>
                    </>
                  ) : (
                    <span className="text-xs text-neutral-400">No match</span>
                  )}
                </td>
                <td className="px-3 py-2"><StatusPill status={row.status} /></td>
                <td className="px-3 py-2 text-xs">
                  {row.status === 'succeeded' && (
                    <div className="text-neutral-700">
                      <div>{row.recommendation ?? ''}</div>
                      {row.gross_revenue != null && (
                        <div className="text-neutral-500">
                          gross £{Math.round(row.gross_revenue).toLocaleString()}
                        </div>
                      )}
                      <div className="text-neutral-400">
                        {row.monday_synced ? 'synced' : 'not synced'}
                        {row.pdf_uploaded ? ' · PDF' : ''}
                      </div>
                    </div>
                  )}
                  {(row.status === 'failed' || row.status === 'skipped') && (
                    <span className="text-neutral-500">
                      {row.error_message ?? row.error_code ?? ''}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
