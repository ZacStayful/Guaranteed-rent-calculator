const TONE: Record<string, string> = {
  // Job statuses
  draft: 'bg-neutral-100 text-neutral-700',
  running: 'bg-blue-100 text-blue-800',
  paused: 'bg-amber-100 text-amber-900',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-neutral-200 text-neutral-600',
  // Row statuses
  pending: 'bg-neutral-100 text-neutral-700',
  claimed: 'bg-blue-50 text-blue-700',
  succeeded: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  skipped: 'bg-neutral-100 text-neutral-500',
};

const LABEL: Record<string, string> = {
  draft: 'Awaiting confirmation',
  running: 'Running',
  paused: 'Paused',
  completed: 'Complete',
  cancelled: 'Cancelled',
  pending: 'Will run',
  claimed: 'Running',
  succeeded: 'Done',
  failed: 'Failed',
  skipped: 'Skipped',
};

export function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
        TONE[status] ?? 'bg-neutral-100 text-neutral-700'
      }`}
    >
      {LABEL[status] ?? status}
    </span>
  );
}
