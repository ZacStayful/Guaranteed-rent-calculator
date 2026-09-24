'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function BulkUploadForm() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch('/api/admin/bulk/preview', { method: 'POST', body });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? 'Upload failed.');
        return;
      }
      router.push(`/admin/bulk/${json.jobId}`);
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="rounded-lg border border-neutral-200 bg-white p-6">
      <h2 className="text-sm font-semibold text-neutral-900">New upload</h2>
      <p className="mt-1 text-xs text-neutral-500">
        A .csv or .xlsx with columns for email, contact number, property address and bedrooms.
        Header names are matched loosely, so &ldquo;Contact Number&rdquo; and &ldquo;Phone&rdquo; both work.
      </p>
      <p className="mt-1 text-xs text-neutral-500">
        Nothing is spent at this stage — you&apos;ll see which rows matched a lead, and what the run
        will cost, before confirming.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input
          type="file"
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setError(null);
          }}
          className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-neutral-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-neutral-800"
        />
        <button
          type="submit"
          disabled={!file || busy}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-40"
        >
          {busy ? 'Checking matches…' : 'Upload and preview'}
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}
        </p>
      )}
    </form>
  );
}
