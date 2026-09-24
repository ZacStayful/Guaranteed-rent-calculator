// ─── Bulk job data access ─────────────────────────────────────────
//
// Thin, typed wrappers over the bulk_jobs / bulk_job_rows tables. All writes
// go through the service-role client (RLS is enabled with no policies, so
// nothing else can reach these tables).

import { getSupabase } from '../supabase.ts';
import { COST_PER_ROW_GBP } from './config.ts';
import type { RowWarning } from './warnings.ts';

export type JobStatus = 'draft' | 'running' | 'paused' | 'completed' | 'cancelled';
export type RowStatus =
  | 'pending' | 'skipped' | 'claimed' | 'running'
  | 'succeeded' | 'failed' | 'cancelled';

/** Terminal row states — never claimed, never retried. */
export const TERMINAL_ROW_STATUSES: ReadonlySet<RowStatus> = new Set<RowStatus>([
  'skipped', 'succeeded', 'failed', 'cancelled',
]);

export interface BulkJob {
  id: string;
  created_at: string;
  created_by: string | null;
  filename: string | null;
  status: JobStatus;
  total_rows: number;
  runnable_rows: number;
  header_map: Record<string, string | null> | null;
  paused_reason: string | null;
  confirmed_at: string | null;
  finished_at: string | null;
}

export interface BulkJobRow {
  id: string;
  job_id: string;
  row_number: number;
  input_email: string | null;
  input_phone: string | null;
  input_phone_e164: string | null;
  input_address: string | null;
  input_postcode: string | null;
  input_bedrooms: number | null;
  input_guests: number | null;
  warnings: RowWarning[];
  monday_item_id: string | null;
  monday_item_name: string | null;
  match_method: string | null;
  monday_prev_values: Record<string, unknown> | null;
  status: RowStatus;
  attempts: number;
  max_attempts: number;
  claim_token: string | null;
  claimed_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  error_code: string | null;
  error_message: string | null;
  report_id: string | null;
  gross_revenue: number | null;
  net_revenue: number | null;
  long_let_monthly: number | null;
  recommendation: string | null;
  qualification: string | null;
  uplift_pct: number | null;
  data_quality_level: string | null;
  comparables_found: number | null;
  monday_synced: boolean;
  pdf_uploaded: boolean;
}

export class StorageNotConfiguredError extends Error {
  constructor() {
    super('Storage is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).');
  }
}

function client() {
  const supabase = getSupabase();
  if (!supabase) throw new StorageNotConfiguredError();
  return supabase;
}

export interface NewJobRow {
  row_number: number;
  input_email: string | null;
  input_phone: string | null;
  input_phone_e164: string | null;
  input_address: string | null;
  input_postcode: string | null;
  input_bedrooms: number | null;
  input_guests: number | null;
  warnings: RowWarning[];
  monday_item_id: string | null;
  monday_item_name: string | null;
  match_method: string | null;
  status: RowStatus;
  error_code: string | null;
}

export async function createJob(params: {
  createdBy: string;
  filename: string;
  headerMap: Record<string, string | null>;
  rows: NewJobRow[];
}): Promise<BulkJob> {
  const supabase = client();
  const runnable = params.rows.filter((r) => r.status === 'pending').length;

  const { data: job, error } = await supabase
    .from('bulk_jobs')
    .insert({
      created_by: params.createdBy,
      filename: params.filename,
      status: 'draft',
      total_rows: params.rows.length,
      runnable_rows: runnable,
      header_map: params.headerMap,
    })
    .select('*')
    .single();
  if (error) throw new Error(`Could not create the job: ${error.message}`);

  const { error: rowsError } = await supabase
    .from('bulk_job_rows')
    .insert(params.rows.map((r) => ({ ...r, job_id: job.id })));
  if (rowsError) {
    // Don't leave a job with no rows lying around.
    await supabase.from('bulk_jobs').delete().eq('id', job.id);
    throw new Error(`Could not save the rows: ${rowsError.message}`);
  }

  return job as BulkJob;
}

export async function getJob(jobId: string): Promise<BulkJob | null> {
  const { data, error } = await client().from('bulk_jobs').select('*').eq('id', jobId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as BulkJob) ?? null;
}

export async function listJobs(limit = 25): Promise<BulkJob[]> {
  const { data, error } = await client()
    .from('bulk_jobs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as BulkJob[];
}

export async function getJobRows(jobId: string): Promise<BulkJobRow[]> {
  const { data, error } = await client()
    .from('bulk_job_rows')
    .select('*')
    .eq('job_id', jobId)
    .order('row_number', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as BulkJobRow[];
}

export type StatusCounts = Record<RowStatus, number>;

export function countByStatus(rows: Pick<BulkJobRow, 'status'>[]): StatusCounts {
  const counts = {
    pending: 0, skipped: 0, claimed: 0, running: 0,
    succeeded: 0, failed: 0, cancelled: 0,
  } as StatusCounts;
  for (const row of rows) counts[row.status] = (counts[row.status] ?? 0) + 1;
  return counts;
}

export function isJobFinished(counts: StatusCounts): boolean {
  return counts.pending === 0 && counts.claimed === 0 && counts.running === 0;
}

export function estimatedCostGbp(runnableRows: number): number {
  return Math.round(runnableRows * COST_PER_ROW_GBP * 100) / 100;
}

/**
 * Move a draft job to running.
 *
 * Rows the preview marked unrunnable are set to a terminal 'skipped' here, so
 * the claim function can never pick them up.
 */
export async function startJob(jobId: string): Promise<void> {
  const supabase = client();
  const { error } = await supabase
    .from('bulk_jobs')
    .update({ status: 'running', confirmed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('status', 'draft'); // no-op if it already started — makes this idempotent
  if (error) throw new Error(error.message);
}

export async function cancelJob(jobId: string): Promise<void> {
  const supabase = client();
  const { error } = await supabase
    .from('bulk_jobs')
    .update({ status: 'cancelled', finished_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', jobId)
    .in('status', ['draft', 'running', 'paused']);
  if (error) throw new Error(error.message);
}

export async function finishJob(jobId: string, status: 'completed' | 'paused', reason?: string): Promise<void> {
  const supabase = client();
  await supabase
    .from('bulk_jobs')
    .update({
      status,
      paused_reason: reason ?? null,
      finished_at: status === 'completed' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId)
    .eq('status', 'running');
}

/**
 * Claim up to `limit` rows for this worker.
 *
 * Delegates to the claim_bulk_rows Postgres function, which uses
 * FOR UPDATE SKIP LOCKED — see the migration for why this can't be done from
 * the JS query builder.
 */
export async function claimRows(params: {
  limit: number;
  claimToken: string;
  maxInflight: number;
  staleSeconds?: number;
}): Promise<BulkJobRow[]> {
  const { data, error } = await client().rpc('claim_bulk_rows', {
    p_limit: params.limit,
    p_claim_token: params.claimToken,
    p_max_inflight: params.maxInflight,
    p_stale_seconds: params.staleSeconds ?? 900,
  });
  if (error) throw new Error(`Could not claim rows: ${error.message}`);
  return (data ?? []) as BulkJobRow[];
}

/**
 * Write a row update, but ONLY if this worker still holds the claim.
 *
 * A worker whose claim went stale and was reclaimed by someone else must not
 * overwrite the newer attempt's result; its update simply matches no rows.
 */
export async function updateClaimedRow(
  rowId: string,
  claimToken: string,
  patch: Partial<BulkJobRow>,
): Promise<boolean> {
  const { data, error } = await client()
    .from('bulk_job_rows')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', rowId)
    .eq('claim_token', claimToken)
    .select('id');
  if (error) {
    console.error('[bulk] row update failed:', error.message);
    return false;
  }
  return (data?.length ?? 0) > 0;
}
