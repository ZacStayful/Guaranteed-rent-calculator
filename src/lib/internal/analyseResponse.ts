// ─── The internal analyse response shaper ─────────────────────────
//
// Turns a completed AnalysisResult into the JSON the Stayful lead database
// stores against a customer-owned lead.
//
// ALL ARITHMETIC LIVES HERE, and the reason is one number: occupancy.
//
// This codebase carries occupancy as a FRACTION (ShortLetData.occupancyRate is
// 0–1, and PdfReportData.overview.occupancy is copied straight from it). The
// lead database stores it as a WHOLE PERCENT — 63, not 0.63 — and its CHECK
// constraint is `occupancy_rate >= 0 and occupancy_rate <= 100`, which 0.63
// passes silently. A missed multiplication would therefore write a plausible
// wrong number that no database constraint catches, and the receiving app would
// quietly reword its caption from "based on £157 a night at 63% occupancy" to
// the comparable-set wording instead of failing. Nobody would see it.
//
// So the conversion happens once, in a pure function, with a unit test — rather
// than inline in a route handler where it reads like a detail.
//
// The second reason this is a separate module: every figure below is taken from
// `deriveReportData(result)`, the SAME derivation the PDF renders from. The JSON
// and the PDF in one response can therefore never state different numbers.

import type { AnalysisResult } from '../types.ts';
import { deriveReportData } from '../pdf/derive.ts';
import { STR_COST_RATES } from '../analysis.ts';
import { bulkSideEffectGate } from '../bulk/gate.ts';

/** The figure block, matching the lead database's `leads` columns one for one. */
export interface AnalyseFigures {
  /** Projected gross annual short-term-let revenue, whole pounds. */
  gross_annual_income: number;
  /** Net after platform + management + cleaning at Stayful's rates. */
  net_annual_income: number;
  /** Long-let gross annual, for the comparison. Null when unavailable. */
  long_let_annual_income: number | null;
  /**
   * Average nightly rate, whole pounds — and the occupancy below.
   *
   * BOTH OR NEITHER. The receiving column comments state the pair is stored
   * together, because a rate with no occupancy is a number an operator cannot
   * check and an occupancy with no rate says nothing on its own.
   */
  avg_nightly_rate: number | null;
  /** Occupancy as a WHOLE PERCENT (63, not 0.63). Null with the rate above. */
  occupancy_rate: number | null;
  platform_fee_pct: number;
  cleaning_fee_pct: number;
  /**
   * Cross-check only — the lead database derives its own management fee as
   * `gross / 6.667` and must keep doing so. The two differ by up to £1 because
   * one divides where the other multiplies, and that difference is deliberate:
   * each app states the fee the way its own report words it. Sent so a seam
   * test can assert they still agree within £1, which is the tripwire for "the
   * analyser changed what it means by gross".
   */
  management_fee_annual: number;
  /**
   * Twelve months of NET revenue at Stayful's fee, January first — used
   * downstream as a seasonal shape rather than as absolute figures. Exactly
   * twelve elements or null; the receiving column has a
   * `cardinality(...) = 12` CHECK that would abort the whole write.
   */
  monthly_revenue_profile: number[] | null;

  // ── The market block ────────────────────────────────────────────
  //
  // What the analysis says about the market around the property, rather than
  // about its money. The lead database puts these on a slide of their own so an
  // operator can answer "is anyone actually booking round here?" from the
  // analysis instead of from memory.
  //
  // Every one is nullable and INDEPENDENT: the receiving app renders per field,
  // so a run that produced a risk score and no comparables is a shorter slide
  // rather than a broken one. All of them come from `deriveReportData`, which
  // is what the PDF renders from, so the JSON and the document in the same
  // response cannot state different numbers.

  /** The comparable set's mean occupancy as a WHOLE PERCENT, same unit as above. */
  market_occupancy_rate: number | null;
  /** How many comparable listings, and how far out they were found (KILOMETRES). */
  comp_set_size: number | null;
  comp_set_radius_km: number | null;
  /** Mean guest rating (0-5) and mean review count across that set. */
  comp_avg_rating: number | null;
  comp_avg_review_count: number | null;
  /**
   * ⚠️ THE TWO SCORES RUN IN OPPOSITE DIRECTIONS. `risk_score` is 0 for LOW
   * risk; `direct_booking_score` is 100 for the best. Both are sent exactly as
   * the report prints them, and the receiving app words each accordingly.
   * Normalising one to match the other would invert a number an operator reads
   * aloud to a landlord.
   */
  risk_score: number | null;
  /** The wording the PDF prints beside it — "Low-Medium Risk". */
  risk_label: string | null;
  direct_booking_score: number | null;
}

export interface AnalyseSuccessResponse {
  ok: true;
  request_id: string | null;
  /**
   * Whether these figures are trustworthy enough to publish.
   *
   * getShortLetData() swallows every upstream failure and returns either a
   * zeroed shell or generateMarketEstimate() — a synthetic figure that looks
   * entirely plausible. `quality_ok: false` is the only thing standing between
   * an Airbtics outage and a customer paying for a page of invented valuations,
   * so it is a first-class field rather than something the caller infers.
   */
  quality_ok: boolean;
  quality_reason: string | null;
  figures: AnalyseFigures;
  pdf: { base64: string; bytes: number; filename: string } | null;
  /** Set when the PDF render failed but the figures survived. */
  pdf_error?: string;
  diagnostics: {
    comparables_found: number;
    data_quality_level: string | null;
    report_id: string | null;
    duration_ms: number;
  };
}

/**
 * Occupancy, converted once.
 *
 * Returns null rather than guessing when the input is not the documented 0–1
 * fraction. Tolerating an out-of-range value would mean silently accepting
 * whichever unit the upstream happened to send that day, which is exactly how
 * this app's own `analyser_reports.occupancy` column ended up holding both.
 */
export function toOccupancyPercent(fraction: number | null | undefined): number | null {
  if (typeof fraction !== 'number' || !Number.isFinite(fraction)) return null;
  if (fraction < 0 || fraction > 1) return null;
  const pct = Math.round(fraction * 100);
  return pct > 0 ? pct : null;
}

/** A figure the receiving CHECK will take, or null. 0 reads as absent here. */
function positiveOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** A 0-100 score, kept only when it is one. */
function scoreOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
    ? Math.round(value)
    : null;
}

/** The radius as the report prints it, to two decimals. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Twelve elements or null — a partial forecast is not a curve. */
function toMonthlyProfile(monthly: ReadonlyArray<{ net: number }>): number[] | null {
  if (monthly.length !== 12) return null;
  const values = monthly.map((m) => Math.round(m.net));
  return values.every((n) => Number.isFinite(n)) ? values : null;
}

/**
 * Shape a completed analysis for the lead database.
 *
 * `pdf` is passed in rather than rendered here so this module stays pure and
 * synchronous, and so a render failure is the route's problem rather than a
 * reason to lose the figures.
 */
export function buildAnalyseResponse(
  result: AnalysisResult,
  opts: {
    requestId: string | null;
    reportId: string | null;
    durationMs: number;
    pdf: { buffer: Uint8Array; filename: string } | null;
    pdfError?: string;
  },
): AnalyseSuccessResponse {
  const report = deriveReportData(result);
  const verdict = bulkSideEffectGate(result);

  const occupancy = toOccupancyPercent(report.overview.occupancy);
  const nightlyRate = Number.isFinite(report.overview.adr) && report.overview.adr > 0
    ? Math.round(report.overview.adr)
    : null;

  // Both or neither (see AnalyseFigures.avg_nightly_rate).
  const pairOk = occupancy !== null && nightlyRate !== null;

  const longLet = report.longLetAnnual.gross;

  // Both or neither, twice: a comparable count says nothing without the radius
  // it was found in, and a risk score with no wording beside it is a number a
  // landlord cannot read.
  const comps = report.compsBenchmark;
  const compSetOk =
    Number.isFinite(comps.count) && comps.count > 0 &&
    Number.isFinite(comps.radiusKm) && comps.radiusKm > 0;
  const riskOk =
    Number.isFinite(report.risk.overall) &&
    report.risk.overall >= 0 &&
    report.risk.overall <= 100 &&
    typeof report.risk.label === 'string' &&
    report.risk.label.trim().length > 0;

  return {
    ok: true,
    request_id: opts.requestId,
    quality_ok: verdict.allow,
    quality_reason: verdict.reason ?? null,
    figures: {
      gross_annual_income: Math.round(report.overview.grossRevenue),
      net_annual_income: Math.round(report.overview.netRevenue),
      long_let_annual_income:
        Number.isFinite(longLet) && longLet > 0 ? Math.round(longLet) : null,
      avg_nightly_rate: pairOk ? nightlyRate : null,
      occupancy_rate: pairOk ? occupancy : null,
      platform_fee_pct: Math.round(STR_COST_RATES.platform * 100),
      cleaning_fee_pct: Math.round(STR_COST_RATES.cleaning * 100),
      management_fee_annual: Math.round(report.shortLetAnnual.managementFee),
      monthly_revenue_profile: toMonthlyProfile(report.monthly),

      // The comps benchmark drops a rating or review count of 0 rather than
      // sending it: `avgRating` is the mean of comps that HAVE a rating, so 0
      // means none of them did, which is an absence rather than a market of
      // zero-star listings. Occupancy is the exception and 0 is kept — it means
      // no comparable listings nearby, which is worth an operator knowing.
      market_occupancy_rate: toOccupancyPercent(comps.avgOccupancy),
      comp_set_size: compSetOk ? comps.count : null,
      comp_set_radius_km: compSetOk ? round2(comps.radiusKm) : null,
      comp_avg_rating: positiveOrNull(comps.avgRating),
      comp_avg_review_count: positiveOrNull(comps.avgReviews),
      risk_score: riskOk ? Math.round(report.risk.overall) : null,
      risk_label: riskOk ? report.risk.label : null,
      direct_booking_score: scoreOrNull(report.directBookingScore),
    },
    pdf: opts.pdf
      ? {
          base64: Buffer.from(opts.pdf.buffer).toString('base64'),
          bytes: opts.pdf.buffer.byteLength,
          filename: opts.pdf.filename,
        }
      : null,
    ...(opts.pdfError ? { pdf_error: opts.pdfError } : {}),
    diagnostics: {
      comparables_found: result.dataQuality?.comparablesFound ?? 0,
      data_quality_level: result.dataQuality?.level ?? null,
      report_id: opts.reportId,
      duration_ms: opts.durationMs,
    },
  };
}
