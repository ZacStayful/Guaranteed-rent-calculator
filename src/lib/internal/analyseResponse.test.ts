import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildAnalyseResponse, toOccupancyPercent } from './analyseResponse.ts';
import { fakeAnalysis } from '../bulk/fake.ts';
import { deriveReportData } from '../pdf/derive.ts';
import { normaliseAnalysisInput, defaultGuests } from '../pipeline/input.ts';
import type { AnalysisResult } from '../types.ts';

function fixture(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  const normalised = normaliseAnalysisInput({
    address: '12 Bourneside Road, Bristol',
    postcode: 'BS4 3AA',
    bedrooms: 3,
    guests: defaultGuests(3),
    longLetNotSure: true,
  });
  assert.equal(normalised.ok, true);
  if (!normalised.ok) throw new Error('unreachable');
  return { ...fakeAnalysis(normalised.input), ...overrides };
}

// ── The conversion this module exists for ─────────────────────────
//
// The receiving column's CHECK is `>= 0 and <= 100`, so 0.63 passes it. If the
// multiplication is ever lost these are the only tests that notice.

test('toOccupancyPercent converts the documented 0-1 fraction', () => {
  assert.equal(toOccupancyPercent(0.63), 63);
  assert.equal(toOccupancyPercent(0.001), null, 'rounds to 0, which is not an occupancy');
  assert.equal(toOccupancyPercent(1), 100);
});

test('toOccupancyPercent refuses a value that is already a percentage', () => {
  // Tolerating this is how a column ends up holding both units. Better to lose
  // the pair than to store a number nobody can interpret.
  assert.equal(toOccupancyPercent(63), null);
  assert.equal(toOccupancyPercent(100), null);
});

test('toOccupancyPercent refuses nonsense', () => {
  assert.equal(toOccupancyPercent(-0.1), null);
  assert.equal(toOccupancyPercent(Number.NaN), null);
  assert.equal(toOccupancyPercent(undefined), null);
  assert.equal(toOccupancyPercent(null), null);
});

// ── The response contract ─────────────────────────────────────────

test('occupancy_rate leaves as a whole percent, never a fraction', () => {
  const res = buildAnalyseResponse(fixture(), {
    requestId: 'req-1', reportId: null, durationMs: 1, pdf: null,
  });
  const occ = res.figures.occupancy_rate;
  assert.ok(occ !== null);
  assert.ok(Number.isInteger(occ), `expected an integer, got ${occ}`);
  assert.ok(occ >= 1 && occ <= 100, `expected 1-100, got ${occ}`);
});

test('the rate and occupancy are stored as a pair or not at all', () => {
  const res = buildAnalyseResponse(
    fixture({
      shortLet: { ...fixture().shortLet, occupancyRate: 7 /* already a percent */ },
    }),
    { requestId: null, reportId: null, durationMs: 1, pdf: null },
  );
  assert.equal(res.figures.occupancy_rate, null);
  assert.equal(
    res.figures.avg_nightly_rate,
    null,
    'a nightly rate with no occupancy is a number nobody can check',
  );
});

test('monthly_revenue_profile is exactly twelve elements', () => {
  // The receiving column has a cardinality(...) = 12 CHECK; a short array
  // aborts the entire lead update, not just this field.
  const res = buildAnalyseResponse(fixture(), {
    requestId: null, reportId: null, durationMs: 1, pdf: null,
  });
  assert.equal(res.figures.monthly_revenue_profile?.length, 12);
  assert.ok(res.figures.monthly_revenue_profile?.every(Number.isFinite));
});

test('monthly_revenue_profile is null rather than partial', () => {
  const base = fixture();
  const res = buildAnalyseResponse(
    { ...base, shortLet: { ...base.shortLet, monthlyRevenue: [1, 2, 3] as never } },
    { requestId: null, reportId: null, durationMs: 1, pdf: null },
  );
  assert.equal(res.figures.monthly_revenue_profile, null);
});

test('the two management-fee derivations still agree within a pound', () => {
  // The lead database computes its own fee as gross / 6.667 and must keep
  // doing so. This asserts the two definitions have not drifted — if this
  // fails, the analyser has changed what it means by "gross".
  const res = buildAnalyseResponse(fixture(), {
    requestId: null, reportId: null, durationMs: 1, pdf: null,
  });
  const theirs = Math.round(res.figures.gross_annual_income / 6.667);
  assert.ok(
    Math.abs(theirs - res.figures.management_fee_annual) <= 1,
    `${theirs} vs ${res.figures.management_fee_annual}`,
  );
});

test('the fee percentages match the rates the report deducts', () => {
  const res = buildAnalyseResponse(fixture(), {
    requestId: null, reportId: null, durationMs: 1, pdf: null,
  });
  assert.equal(res.figures.platform_fee_pct, 15);
  assert.equal(res.figures.cleaning_fee_pct, 18);
});

test('quality_ok reports the gate rather than suppressing anything', () => {
  const base = fixture();
  const good = buildAnalyseResponse(base, {
    requestId: null, reportId: null, durationMs: 1, pdf: null,
  });
  assert.equal(good.quality_ok, true);
  assert.equal(good.quality_reason, null);

  // comparablesFound === 0 is the tell-tale of generateMarketEstimate() — a
  // synthetic figure that looks entirely plausible.
  const synthetic = buildAnalyseResponse(
    { ...base, dataQuality: { ...base.dataQuality, comparablesFound: 0 } },
    { requestId: null, reportId: null, durationMs: 1, pdf: null },
  );
  assert.equal(synthetic.quality_ok, false);
  assert.match(synthetic.quality_reason ?? '', /no_str_data/);
  assert.ok(
    synthetic.figures.gross_annual_income > 0,
    'the figures are still returned — the caller decides, not us',
  );
});

test('the PDF survives the base64 round trip', () => {
  // The seam this endpoint adds is bytes -> base64 -> bytes -> a storage
  // bucket. A previous version of the receiving app stored 159 zero-byte PDFs
  // because two well-tested halves met in an untested middle.
  const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x33]); // "%PDF-1.3"
  const res = buildAnalyseResponse(fixture(), {
    requestId: null,
    reportId: null,
    durationMs: 1,
    pdf: { buffer: pdfBytes, filename: 'x.pdf' },
  });
  assert.ok(res.pdf);
  assert.equal(res.pdf.bytes, 8);
  const decoded = new Uint8Array(Buffer.from(res.pdf.base64, 'base64'));
  assert.deepEqual([...decoded], [...pdfBytes]);
  assert.equal(Buffer.from(decoded.subarray(0, 5)).toString('latin1'), '%PDF-');
});

test('a failed PDF render does not cost the figures', () => {
  const res = buildAnalyseResponse(fixture(), {
    requestId: null, reportId: null, durationMs: 1, pdf: null, pdfError: 'boom',
  });
  assert.equal(res.pdf, null);
  assert.equal(res.pdf_error, 'boom');
  assert.ok(res.figures.gross_annual_income > 0);
});

// ── The market block ──────────────────────────────────────────────
//
// Added so the lead database can show what the analysis says about the market
// and not only about the money. These are read straight off deriveReportData,
// the same derivation the PDF renders from, so a mismatch between this JSON and
// the document in the same response is the thing these tests exist to catch.

test('the market block is carried, in the units the receiving columns expect', () => {
  const result = fixture();
  const res = buildAnalyseResponse(result, {
    requestId: null, reportId: null, durationMs: 1, pdf: null,
  });
  const f = res.figures;

  // Occupancy is a whole percent here and a fraction upstream, exactly as the
  // property's own occupancy is.
  if (f.market_occupancy_rate !== null) {
    assert.ok(Number.isInteger(f.market_occupancy_rate));
    assert.ok(f.market_occupancy_rate >= 0 && f.market_occupancy_rate <= 100);
  }
  if (f.comp_avg_rating !== null) {
    assert.ok(f.comp_avg_rating > 0 && f.comp_avg_rating <= 5, `rating ${f.comp_avg_rating}`);
  }
  if (f.risk_score !== null) {
    assert.ok(f.risk_score >= 0 && f.risk_score <= 100);
    assert.equal(typeof f.risk_label, 'string');
    assert.ok((f.risk_label ?? '').length > 0, 'a score with no wording is unreadable');
  }
  if (f.direct_booking_score !== null) {
    assert.ok(f.direct_booking_score >= 0 && f.direct_booking_score <= 100);
  }
});

test('the comparable set is sent as a pair or not at all', () => {
  const res = buildAnalyseResponse(fixture(), {
    requestId: null, reportId: null, durationMs: 1, pdf: null,
  });
  const { comp_set_size, comp_set_radius_km } = res.figures;
  assert.equal(
    comp_set_size === null,
    comp_set_radius_km === null,
    'a count without its radius does not say how hard we looked for it',
  );
});

test('the JSON states what the PDF would print', () => {
  // The whole reason this module derives rather than recomputes: one response
  // must not carry two different answers.
  const result = fixture();
  const report = deriveReportData(result);
  const res = buildAnalyseResponse(result, {
    requestId: null, reportId: null, durationMs: 1, pdf: null,
  });
  if (res.figures.risk_score !== null) {
    assert.equal(res.figures.risk_score, Math.round(report.risk.overall));
    assert.equal(res.figures.risk_label, report.risk.label);
  }
  if (res.figures.comp_set_size !== null) {
    assert.equal(res.figures.comp_set_size, report.compsBenchmark.count);
  }
  if (res.figures.direct_booking_score !== null) {
    assert.equal(res.figures.direct_booking_score, Math.round(report.directBookingScore));
  }
});
