import Papa from 'papaparse';
import { requireAdminApi } from '@/lib/auth/guard';
import { getJob, getJobRows } from '@/lib/bulk/jobs';
import { WARNING_LABELS, type RowWarning } from '@/lib/bulk/warnings';

export const runtime = 'nodejs';

const MONDAY_BOARD_URL = 'https://stayful.monday.com/boards';

/**
 * Results as CSV — every input column plus what happened, so problem rows can
 * be corrected and re-uploaded as a smaller batch.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;

  const { jobId } = await params;
  const boardId = process.env.MONDAY_BOARD_ID || '5891626711';

  try {
    const job = await getJob(jobId);
    if (!job) return Response.json({ error: 'Job not found.' }, { status: 404 });

    const rows = await getJobRows(jobId);

    const csv = Papa.unparse(
      rows.map((r) => ({
        row: r.row_number,
        email: r.input_email ?? '',
        phone: r.input_phone ?? '',
        address: r.input_address ?? '',
        postcode: r.input_postcode ?? '',
        bedrooms: r.input_bedrooms ?? '',
        guests: r.input_guests ?? '',
        status: r.status,
        error_code: r.error_code ?? '',
        error_message: r.error_message ?? '',
        warnings: (r.warnings ?? [])
          .map((w) => WARNING_LABELS[w as RowWarning] ?? w)
          .join('; '),
        match_method: r.match_method ?? '',
        monday_item_id: r.monday_item_id ?? '',
        monday_item_name: r.monday_item_name ?? '',
        monday_url: r.monday_item_id ? `${MONDAY_BOARD_URL}/${boardId}/pulses/${r.monday_item_id}` : '',
        monday_synced: r.monday_synced ? 'yes' : 'no',
        pdf_uploaded: r.pdf_uploaded ? 'yes' : 'no',
        gross_revenue: r.gross_revenue ?? '',
        net_revenue: r.net_revenue ?? '',
        long_let_monthly: r.long_let_monthly ?? '',
        recommendation: r.recommendation ?? '',
        qualification: r.qualification ?? '',
        uplift_pct: r.uplift_pct ?? '',
        data_quality: r.data_quality_level ?? '',
        comparables_found: r.comparables_found ?? '',
        attempts: r.attempts,
        finished_at: r.finished_at ?? '',
      })),
    );

    const safeName = (job.filename ?? 'bulk').replace(/[^A-Za-z0-9._-]/g, '_').replace(/\.[^.]+$/, '');

    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${safeName}-results.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[bulk] could not export results:', err);
    return Response.json(
      { error: err instanceof Error ? err.message : 'Could not export results.' },
      { status: 500 },
    );
  }
}
