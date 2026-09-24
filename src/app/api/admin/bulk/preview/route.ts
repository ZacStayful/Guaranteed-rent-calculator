import { requireAdminApi } from '@/lib/auth/guard';
import { parseSpreadsheet, SpreadsheetError } from '@/lib/bulk/parse';
import { BLOCKING_WARNINGS } from '@/lib/bulk/warnings';
import { fetchLeadDirectory, matchAgainstDirectory } from '@/lib/apis/monday-leads';
import { createJob, estimatedCostGbp, type NewJobRow } from '@/lib/bulk/jobs';
import { maxRows, maxJobCostGbp } from '@/lib/bulk/config';

export const runtime = 'nodejs';
// Parsing is fast, but resolving ~100 rows against a fresh board snapshot
// (3 paged requests) can take a few seconds on a cold cache.
export const maxDuration = 60;

const MAX_FILE_BYTES = 2 * 1024 * 1024;

/**
 * Stage 1 of the upload: parse, match every row against Monday, and store the
 * result as a DRAFT job.
 *
 * Deliberately spends nothing. The admin sees which rows matched and what the
 * run will cost before confirming, so a mis-mapped column is a wasted click
 * rather than a wasted £50.
 */
export async function POST(request: Request) {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: 'Expected a file upload.' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return Response.json({ error: 'No file was uploaded.' }, { status: 400 });
  }
  if (file.size === 0) {
    return Response.json({ error: 'The file is empty.' }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return Response.json(
      { error: `That file is too large (limit ${MAX_FILE_BYTES / 1024 / 1024}MB).` },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  let parsed;
  try {
    parsed = await parseSpreadsheet({ name: file.name, buffer }, { maxRows: maxRows() });
  } catch (err) {
    if (err instanceof SpreadsheetError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    console.error('[bulk] parse failed:', err);
    return Response.json({ error: 'Could not read that file.' }, { status: 400 });
  }

  // One board snapshot for the whole sheet — 3 requests rather than ~300.
  const directory = await fetchLeadDirectory();
  const directoryAvailable = directory.length > 0;

  // A Monday item must not receive two rows from the same sheet: the second
  // would overwrite the first's columns and add a duplicate PDF.
  const claimedItems = new Map<string, number>();

  const rows: NewJobRow[] = parsed.rows.map((row) => {
    const warnings = [...row.warnings];
    let itemId: string | null = null;
    let itemName: string | null = null;
    let method: string | null = 'none';

    if (!row.blocking) {
      const match = matchAgainstDirectory(directory, {
        email: row.email,
        phone: row.phone,
        address: row.address,
        postcode: row.postcode,
      });
      itemId = match.itemId;
      itemName = match.itemName;
      method = match.method;

      if (itemId) {
        const firstRow = claimedItems.get(itemId);
        if (firstRow !== undefined) {
          // Two sheet rows resolved to one lead — run neither blind.
          if (!warnings.includes('duplicate_row')) warnings.push('duplicate_row');
          itemId = null;
          method = 'none';
        } else {
          claimedItems.set(itemId, row.rowNumber);
        }
      }
    }

    const blocked = warnings.some((w) => BLOCKING_WARNINGS.has(w));
    // No match means no lead to write to, so the row is skipped rather than run.
    const skip = blocked || !itemId;
    const errorCode = blocked
      ? warnings.find((w) => BLOCKING_WARNINGS.has(w)) ?? 'invalid_row'
      : !itemId
        ? 'no_monday_match'
        : null;

    return {
      row_number: row.rowNumber,
      input_email: row.email,
      input_phone: row.phone,
      input_phone_e164: row.phoneE164,
      input_address: row.address,
      input_postcode: row.postcode,
      input_bedrooms: row.bedrooms,
      input_guests: row.guests,
      warnings,
      monday_item_id: itemId,
      monday_item_name: itemName,
      match_method: method,
      status: skip ? 'skipped' : 'pending',
      error_code: skip ? errorCode : null,
    };
  });

  const runnable = rows.filter((r) => r.status === 'pending').length;
  const cost = estimatedCostGbp(runnable);
  if (cost > maxJobCostGbp()) {
    return Response.json(
      {
        error:
          `This batch would cost about £${cost.toFixed(2)}, over the £${maxJobCostGbp()} limit. ` +
          `Split it into smaller batches, or raise BULK_MAX_JOB_COST_GBP.`,
      },
      { status: 400 },
    );
  }

  try {
    const job = await createJob({
      createdBy: guard.session.email,
      filename: file.name,
      headerMap: parsed.headerMap,
      rows,
    });
    return Response.json({
      jobId: job.id,
      totalRows: rows.length,
      runnableRows: runnable,
      estimatedCostGbp: cost,
      directoryAvailable,
      droppedBlankRows: parsed.droppedBlankRows,
    });
  } catch (err) {
    console.error('[bulk] could not create job:', err);
    return Response.json(
      { error: err instanceof Error ? err.message : 'Could not save the job.' },
      { status: 500 },
    );
  }
}
