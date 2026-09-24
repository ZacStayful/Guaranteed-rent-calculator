import Papa from 'papaparse';
import { requireAdminApi } from '@/lib/auth/guard';
import { getJob, getJobRows } from '@/lib/bulk/jobs';
import { WARNING_LABELS, type RowWarning } from '@/lib/bulk/warnings';
import { hasUsableShortLetData } from '@/lib/bulk/gate';
import {
  assessGuaranteedRent,
  confidenceFromDataQuality,
  type GuaranteedRentAssessment,
  type GuaranteedRentBand,
} from '@/lib/guaranteedRent';
import type { DataQuality } from '@/lib/types';

export const runtime = 'nodejs';

const MONDAY_BOARD_URL = 'https://stayful.monday.com/boards';
const DEFAULT_BOARD_ID = '18396542480';

/** Qualified first, then medium, then the rest. */
const BAND_ORDER: Record<GuaranteedRentBand, number> = {
  QUALIFIED: 0,
  MEDIUM: 1,
  UNQUALIFIED: 2,
  INSUFFICIENT_DATA: 3,
};

/**
 * Re-derive the guaranteed-rent assessment for a finished row.
 *
 * Recomputed rather than stored. assessGuaranteedRent is pure, and every input
 * it takes — the gross revenue, the asking rent, the bedrooms and the data
 * quality — is already on the row, so this reproduces exactly what was written
 * to Monday without eight more database columns to keep in step with it.
 *
 * Returns null for a row that never produced figures; those sort last and are
 * still listed, because a run has to show its failures.
 */
function assessmentFor(row: {
  gross_revenue: number | null;
  input_desired_rent: number | null;
  input_bedrooms: number | null;
  comparables_found: number | null;
  data_quality_level: string | null;
  long_let_monthly: number | null;
}): GuaranteedRentAssessment | null {
  if (row.gross_revenue === null) return null;

  const dataQuality = {
    comparablesFound: row.comparables_found ?? 0,
    level: (row.data_quality_level ?? 'low') as DataQuality['level'],
  };
  // The same test the pipeline applied before pricing: a synthetic estimate
  // must never become a real offer.
  const usable = hasUsableShortLetData({
    shortLet: { annualRevenue: row.gross_revenue },
    dataQuality,
  }).allow;

  const hasDesiredRent = row.input_desired_rent !== null && row.input_desired_rent > 0;
  return assessGuaranteedRent({
    grossStrAnnual: usable ? row.gross_revenue : null,
    desiredRentMonthly: hasDesiredRent ? row.input_desired_rent : row.long_let_monthly,
    bedrooms: row.input_bedrooms,
    desiredRentIsEstimate: !hasDesiredRent,
    grossStrIsEstimate: !usable,
    confidence: confidenceFromDataQuality(dataQuality),
  });
}

/**
 * Results as CSV — every input column, the full guaranteed-rent screening, and
 * what happened, so problem rows can be corrected and re-uploaded as a smaller
 * batch.
 *
 * Ranked qualified first by annual profit, then medium, then unqualified, then
 * anything that produced no figures. Failures are never dropped: a near miss is
 * only visible if the row that missed is still in the file, with its gap.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;

  const { jobId } = await params;
  const boardId = process.env.MONDAY_BOARD_ID || DEFAULT_BOARD_ID;

  try {
    const job = await getJob(jobId);
    if (!job) return Response.json({ error: 'Job not found.' }, { status: 404 });

    const rows = await getJobRows(jobId);

    const ranked = rows
      .map((r) => ({ row: r, gr: assessmentFor(r) }))
      .sort((a, b) => {
        const bandDiff =
          BAND_ORDER[a.gr?.band ?? 'INSUFFICIENT_DATA']
          - BAND_ORDER[b.gr?.band ?? 'INSUFFICIENT_DATA'];
        if (bandDiff !== 0) return bandDiff;
        // Highest annual profit first within a band.
        return (b.gr?.annualProfit ?? -Infinity) - (a.gr?.annualProfit ?? -Infinity);
      });

    const csv = Papa.unparse(
      ranked.map(({ row: r, gr }) => ({
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
        band: gr?.band ?? '',
        confidence: gr?.confidence ?? '',
        desired_rent_monthly: gr?.desiredRentMonthly ?? '',
        desired_rent_source: gr ? (gr.desiredRentIsEstimate ? 'estimated' : 'confirmed') : '',
        gross_str_source: gr ? (gr.grossStrIsEstimate ? 'estimated' : 'confirmed') : '',
        bedrooms_assumed: gr ? (gr.bedroomsAssumed ? 'yes' : 'no') : '',
        str_net_annual: gr?.strNetAnnual ?? '',
        fixed_costs_annual: gr?.fixedCostsAnnual ?? '',
        annual_profit: gr?.annualProfit ?? '',
        monthly_profit: gr?.monthlyProfit ?? '',
        required_gross_annual: gr?.requiredGrossAnnual ?? '',
        gap_annual: gr?.gapAnnual ?? '',
        revenue_multiple: gr?.revenueMultiple ?? '',
        max_affordable_rent_monthly: gr?.maxAffordableRentMonthly ?? '',
        rent_offered_monthly: gr?.offerRentMonthly ?? '',
        offer_meets_ask: gr ? (gr.offerMeetsAsk ? 'yes' : 'no') : '',
        reason: gr?.reason ?? '',
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
