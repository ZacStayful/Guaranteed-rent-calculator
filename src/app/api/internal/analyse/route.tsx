// ─── Internal analyse endpoint ────────────────────────────────────
//
// Runs one property through the analyser and returns the figures AND the
// rendered PDF as JSON, for the Stayful lead database to store against a
// customer-owned lead.
//
//   curl -X POST -H "x-internal-secret: <INTERNAL_API_SECRET>" \
//        -H "content-type: application/json" \
//        -d '{"address":"12 Foo St, Bristol","postcode":"BS4 3AA","bedrooms":3}' \
//        https://<host>/api/internal/analyse
//
// Gated behind INTERNAL_API_SECRET exactly as /api/reports/count is: no secret
// configured means the endpoint does not exist (404), a wrong one is 401.
//
// ── Why this exists rather than reusing the bulk job machinery ──────
//
// /api/admin/bulk requires every row to match an existing item on the Monday
// leads board, and its purpose is writing results BACK to that board. The leads
// this serves are private to one customer, have no Monday item, and MUST NOT
// reach the board at all. runAnalysis() underneath it is a plain function that
// takes exactly the knobs needed, so this wraps that instead.
//
// ── How the Monday write is prevented ───────────────────────────────
//
// Not by a flag — by omission. persistAndSync() returns at
// `const hasSignal = Boolean(opts.mondayItemId || opts.email || opts.phone)`
// before it touches Monday. This route accepts NO email, NO phone and passes
// mondayItemId: null, so that branch is unreachable. The request body is
// rebuilt field by field below rather than forwarded, so a caller cannot
// reintroduce a signal by sending one.
//
// That omission is also a privacy decision: the landlord's name, email and
// phone never leave the lead database. Only the property does.
//
// The analyser_reports insert happens BEFORE that early return, so the run is
// still persisted and attributable (source: 'lead_db').
//
// ── Why no sideEffectGate ───────────────────────────────────────────
//
// A gate exists to veto a CRM write, and there is no CRM write here. The same
// quality verdict is still computed — bulkSideEffectGate() is called by the
// response shaper — but it is REPORTED to the caller as `quality_ok` rather
// than used to suppress anything. The caller needs to know, because it is about
// to charge somebody for these figures.

import React from 'react';
import { normaliseAnalysisInput, defaultGuests } from '@/lib/pipeline/input';
import { runAnalysis } from '@/lib/pipeline/runAnalysis';
import { renderReportFromResult } from '@/lib/pdf/render';
import { buildAnalyseResponse } from '@/lib/internal/analyseResponse';

export const runtime = 'nodejs';

// ⚠️ 60, because this Vercel account is on HOBBY, whose function ceiling is 60
// seconds. The bulk worker beside this one carries the same number for the same
// reason, and BULK_ROW_CONCURRENCY defaults to 1 because of it.
//
// A row is 20–30s typically and ~70s at worst (Airbtics polls for up to 25s),
// plus the PDF render — so a worst-case property WILL be killed here. That is
// survivable rather than ignored: the caller treats a timeout as retryable
// rather than as a failure, and the durable Airbtics report cache means the
// retry re-reads the report we already paid for instead of buying a second one.
//
// Static literal — route segment config is read at build time and cannot be
// computed. On Pro this becomes 300 and the worst case stops being a retry.
export const maxDuration = 60;

/**
 * Advisory concurrency cap.
 *
 * Per-instance only, so it throttles nothing on its own — the real spend
 * control is the claim function in the calling app, which caps in-flight rows
 * across every worker. This exists so a single misbehaving caller cannot make
 * one lambda instance render eight PDFs at once.
 */
const MAX_INFLIGHT = Number(process.env.INTERNAL_ANALYSE_MAX_INFLIGHT ?? 4);
let inFlight = 0;

interface AnalyseRequestBody {
  request_id?: unknown;
  address?: unknown;
  postcode?: unknown;
  bedrooms?: unknown;
  guests?: unknown;
  bathrooms?: unknown;
  propertyType?: unknown;
  include_pdf?: unknown;
}

export async function POST(request: Request) {
  const expected = process.env.INTERNAL_API_SECRET;
  if (!expected) {
    // Fail closed: with no secret configured the endpoint is disabled rather
    // than left wide open.
    return Response.json({ error: 'Not found' }, { status: 404 });
  }
  if (request.headers.get('x-internal-secret') !== expected) {
    return Response.json({ error: 'Unauthorized', error_code: 'unauthorized' }, { status: 401 });
  }

  let body: AnalyseRequestBody;
  try {
    body = (await request.json()) as AnalyseRequestBody;
  } catch {
    return Response.json(
      { error: 'Invalid JSON body', error_code: 'invalid_input' },
      { status: 400 },
    );
  }

  const requestId = typeof body.request_id === 'string' ? body.request_id : null;

  const bedrooms = Number(body.bedrooms);
  // Rebuilt field by field — see the header. Anything the caller sent that is
  // not named here (an email, a phone, a Monday id) is dropped on the floor.
  const normalised = normaliseAnalysisInput({
    address: body.address,
    postcode: body.postcode,
    bedrooms: body.bedrooms,
    guests:
      body.guests === undefined && Number.isFinite(bedrooms)
        ? defaultGuests(bedrooms)
        : body.guests,
    bathrooms: body.bathrooms,
    propertyType: body.propertyType,
    // "Not sure" — let PropertyData value the long let, as bulk does.
    longLetNotSure: true,
  });

  if (!normalised.ok) {
    // The validator's wording verbatim, so the caller can show it to a customer.
    return Response.json(
      { error: normalised.error, error_code: 'invalid_input', request_id: requestId },
      { status: 400 },
    );
  }

  if (inFlight >= MAX_INFLIGHT) {
    return Response.json(
      { error: 'Too many analyses in flight', error_code: 'busy', request_id: requestId },
      { status: 429 },
    );
  }

  const startedAt = Date.now();
  inFlight += 1;
  try {
    const outcome = await runAnalysis(normalised.input, {
      reportSource: 'lead_db',
      // A batch must never burn a landlord's free analyses; there is no
      // landlord here at all, and no email to count against.
      incrementUsage: false,
      // The other half of the no-Monday guarantee (see the header).
      mondayItemId: null,
    });

    if (!outcome.ok) {
      // runAnalysis never throws; a dead row is a 200 with ok:false so the
      // caller can distinguish "this property failed" from "the call failed"
      // and decide whether to retry.
      return Response.json({
        ok: false,
        request_id: requestId,
        stage: outcome.stage,
        error_code: outcome.errorCode,
        error: outcome.error,
      });
    }

    // ── The PDF ───────────────────────────────────────────────
    // Rendered here rather than by persistAndSync, whose render sits inside the
    // Monday block this route deliberately cannot reach.
    //
    // A render failure must not cost the figures. The rest of this pipeline
    // already follows that rule — a storage error never suppresses an estimate —
    // and the figures are the half being paid for.
    let pdf: { buffer: Uint8Array; filename: string } | null = null;
    let pdfError: string | undefined;
    if (body.include_pdf !== false) {
      try {
        // No lead is attached on this path, so page 01 omits "PREPARED FOR";
        // setup costs fall back to typical figures for the property size.
        const { buffer, filename } = await renderReportFromResult(outcome.result);
        const bytes = new Uint8Array(buffer);
        // A zero-length render is never a legitimate state, and the receiving
        // app refuses to store one. Fail it loudly here instead of shipping an
        // empty file that looks like a stored report.
        if (bytes.byteLength === 0) throw new Error('renderer produced an empty document');
        pdf = { buffer: bytes, filename };
      } catch (err) {
        pdfError = err instanceof Error ? err.message : 'PDF render failed';
        console.error('[internal/analyse] PDF render failed:', err);
      }
    }

    return Response.json(
      buildAnalyseResponse(outcome.result, {
        requestId,
        reportId: outcome.reportId,
        durationMs: Date.now() - startedAt,
        pdf,
        pdfError,
      }),
    );
  } catch (err) {
    // runAnalysis does not throw, so reaching here means something outside it
    // did — a render lock, a JSON serialisation, an OOM. Retryable.
    console.error('[internal/analyse] unexpected failure:', err);
    return Response.json(
      { error: 'Internal error', error_code: 'internal', request_id: requestId },
      { status: 500 },
    );
  } finally {
    inFlight -= 1;
  }
}
