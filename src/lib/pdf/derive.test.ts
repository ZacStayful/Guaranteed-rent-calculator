import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  splitStreetAndCity,
  computePaybackMonths,
  planSetupRows,
  buildSetupSnapshot,
  buildIndicativeSetupSnapshot,
  attachSetupCosts,
  deriveReportData,
  MAX_COMPARABLE_ROWS,
  MAX_SETUP_ROWS,
  type PdfSetupCategory,
} from './derive.ts';
import { assessRisk } from '../analysis.ts';
import { DEMO_MANCHESTER } from '../demo-data.ts';
import type { AnalysisResult } from '../types.ts';

// ── Street / city split ───────────────────────────────────────────
// The running header prints "<STREET> · <CITY>", and addresses reach us from
// three places with three shapes: Google autocomplete, manual entry and bulk
// spreadsheet upload.

test('splitStreetAndCity: takes the town from the last comma segment', () => {
  assert.deepEqual(splitStreetAndCity('17 Park Crescent, York', 'YO31 7NU'), {
    street: '17 Park Crescent',
    city: 'York',
  });
});

test('splitStreetAndCity: keeps multi-part streets intact', () => {
  assert.deepEqual(
    splitStreetAndCity('Flat 3, 22 Princess Road West, Leicester', 'LE3 0JY'),
    { street: 'Flat 3, 22 Princess Road West', city: 'Leicester' },
  );
});

test('splitStreetAndCity: falls back to the postcode outward code', () => {
  // Manual entry and bulk upload often carry no town at all.
  assert.deepEqual(splitStreetAndCity('803 Eastbank Tower', 'M4 7FE'), {
    street: '803 Eastbank Tower',
    city: 'M4',
  });
});

test('splitStreetAndCity: a trailing postcode is not mistaken for a town', () => {
  assert.deepEqual(splitStreetAndCity('12 High Street, LE1 1AA', 'LE1 1AA'), {
    street: '12 High Street',
    city: 'LE1',
  });
});

test('splitStreetAndCity: an empty city is a legitimate outcome', () => {
  assert.deepEqual(splitStreetAndCity('Some Barn', ''), {
    street: 'Some Barn',
    city: '',
  });
  assert.deepEqual(splitStreetAndCity('', undefined), { street: '', city: '' });
});

// ── Payback ───────────────────────────────────────────────────────

test('computePaybackMonths: rounds to the nearest whole month', () => {
  // £3,110 over £771/month is 4.03 months, which the report shows as "≈4".
  assert.equal(computePaybackMonths(3110, 771), 4);
  assert.equal(computePaybackMonths(3110, 500), 6);
  // Never rounds down to zero months.
  assert.equal(computePaybackMonths(700, 800), 1);
});

test('computePaybackMonths: null when the short-let is not ahead', () => {
  // A long-let-recommended property has no payback to quote, and the pages
  // must not print Infinity or NaN.
  assert.equal(computePaybackMonths(3110, 0), null);
  assert.equal(computePaybackMonths(3110, -400), null);
  assert.equal(computePaybackMonths(0, 771), null);
  assert.equal(computePaybackMonths(undefined, 771), null);
  assert.equal(computePaybackMonths(3110, Number.NaN), null);
});

// ── Risk score scale ──────────────────────────────────────────────

test('risk.overall is rescaled from the engine 1-10 to the 0-100 the report prints', () => {
  // assessRisk clamps overallScore to 1–10, but the report draws a 0–100 gauge
  // captioned "0 = lowest risk, 100 = highest". Without the rescale every
  // property fell in the <= 25 bucket and read "Low risk".
  const result: AnalysisResult = {
    ...DEMO_MANCHESTER,
    risk: assessRisk(
      DEMO_MANCHESTER.shortLet,
      DEMO_MANCHESTER.longLet,
      DEMO_MANCHESTER.demandDrivers,
      DEMO_MANCHESTER.nearbyEvents,
    ),
  };
  assert.ok(result.risk.overallScore >= 1 && result.risk.overallScore <= 10);

  const data = deriveReportData(result);
  assert.equal(data.risk.overall, result.risk.overallScore * 10);
  assert.notEqual(data.risk.label, 'Low risk');
});

test('risk labels cover the whole 0-100 range', () => {
  const labelFor = (engineScore: number) =>
    deriveReportData({
      ...DEMO_MANCHESTER,
      risk: { ...DEMO_MANCHESTER.risk, overallScore: engineScore },
    }).risk.label;

  assert.equal(labelFor(1), 'Low risk');
  assert.equal(labelFor(4), 'Low-medium risk');
  assert.equal(labelFor(7), 'Medium-high risk');
  assert.equal(labelFor(10), 'High risk');
});

// ── Meta ──────────────────────────────────────────────────────────

test('preparedFor is carried through, and blank is treated as absent', () => {
  assert.equal(
    deriveReportData(DEMO_MANCHESTER, 'lead@email.com').meta.preparedFor,
    'lead@email.com',
  );
  assert.equal(deriveReportData(DEMO_MANCHESTER, '   ').meta.preparedFor, undefined);
  assert.equal(deriveReportData(DEMO_MANCHESTER).meta.preparedFor, undefined);
});

// ── Amenities ─────────────────────────────────────────────────────

test('amenity scores are numeric, not baked into the label', () => {
  // Page 04 renders them as dot meters, so the score has to be a number.
  const { amenities } = deriveReportData(DEMO_MANCHESTER);
  for (const a of [...amenities.essential, ...amenities.competitiveEdge]) {
    assert.equal(typeof a.score, 'number');
    assert.ok(a.score >= 0 && a.score <= 5, `${a.name} score out of range`);
    assert.ok(!/\d\/\d/.test(a.name), `${a.name} still has a score in the label`);
  }
});

// ── Demand driver order ───────────────────────────────────────────

test('demand drivers come out in the order the cards are laid out', () => {
  const { demandDrivers } = deriveReportData(DEMO_MANCHESTER);
  const order = ['Transport', 'Events', 'Education', 'Healthcare'];
  const seen = demandDrivers.map((d) => d.type);
  assert.deepEqual(
    seen,
    order.filter((o) => seen.includes(o)),
  );
});

// ── Comparables cap ───────────────────────────────────────────────

test('comparables are capped at the printable rows but benchmarks use them all', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({
    ...DEMO_MANCHESTER.shortLet.comparables[0],
    title: `Listing ${i}`,
    distance: 0.1 + i * 0.1,
  }));
  const data = deriveReportData({
    ...DEMO_MANCHESTER,
    shortLet: { ...DEMO_MANCHESTER.shortLet, comparables: many },
  });

  assert.equal(data.comparables.length, MAX_COMPARABLE_ROWS);
  assert.equal(data.comparablesTotal, 30);
  assert.equal(data.compsBenchmark.count, 30);
  // Nearest first, so the printed rows are the most relevant ones.
  assert.deepEqual(
    data.comparables.map((c) => c.distance),
    data.comparables.map((c) => c.distance).slice().sort(),
  );
});

test('no comparables degrades without dividing by zero', () => {
  const data = deriveReportData({
    ...DEMO_MANCHESTER,
    shortLet: { ...DEMO_MANCHESTER.shortLet, comparables: [] },
  });
  assert.equal(data.comparables.length, 0);
  assert.equal(data.comparablesTotal, 0);
  for (const v of Object.values(data.compsBenchmark)) {
    assert.ok(Number.isFinite(v), 'benchmark went non-finite');
  }
});

// ── Setup snapshot + row budget ───────────────────────────────────

test('the default snapshot matches the design spec for a 2-bed', () => {
  // The design's page 05 was drawn from these defaults: £3,110 across 8 items
  // and 5 categories, fully furnished.
  const snap = buildIndicativeSetupSnapshot(2);
  assert.ok(snap);
  assert.equal(snap.grandTotal, 3110);
  assert.equal(snap.itemCount, 8);
  assert.equal(snap.categories.length, 5);
  assert.equal(snap.indicative, true);
});

test('categories are ordered biggest spend first', () => {
  const snap = buildIndicativeSetupSnapshot(3);
  assert.ok(snap);
  const totals = snap.categories.map((c) => c.subtotal);
  assert.deepEqual(totals, [...totals].sort((a, b) => b - a));
});

test("a lead's own snapshot is not flagged indicative", () => {
  const snap = buildSetupSnapshot({
    furnishing: 'fully',
    bedrooms: 2,
    items: [
      { id: 'a', name: 'Sofa', category: 'Furniture & Beds', supplier: 'Dunelm', qty: 1, unitCost: 500, active: true },
    ],
  });
  assert.ok(snap);
  assert.equal(snap.indicative, false);
  assert.equal(snap.grandTotal, 500);
});

test('planSetupRows keeps within the row budget and still totals correctly', () => {
  const categories: PdfSetupCategory[] = Array.from({ length: 6 }, (_, c) => ({
    category: `Category ${c}`,
    items: Array.from({ length: 5 }, (_, i) => ({
      id: `c${c}i${i}`,
      name: `Item ${i}`,
      supplier: 'Supplier',
      qty: 1,
      unitCost: 10,
      total: 10,
    })),
    subtotal: 50,
  }));

  const rows = planSetupRows(categories);
  assert.ok(rows.length <= MAX_SETUP_ROWS + 1, `got ${rows.length} rows`);

  // Every pound is still accounted for: printed item rows plus the overflow
  // line must equal the sum of the categories.
  const shown = rows
    .filter((r): r is Extract<typeof r, { kind: 'item' }> => r.kind === 'item')
    .reduce((n, r) => n + r.item.total, 0);
  const overflow = rows
    .filter((r): r is Extract<typeof r, { kind: 'overflow' }> => r.kind === 'overflow')
    .reduce((n, r) => n + r.total, 0);
  assert.equal(shown + overflow, 300);

  const hiddenCount = rows
    .filter((r): r is Extract<typeof r, { kind: 'overflow' }> => r.kind === 'overflow')
    .reduce((n, r) => n + r.count, 0);
  const shownCount = rows.filter((r) => r.kind === 'item').length;
  assert.equal(shownCount + hiddenCount, 30);
});

test('planSetupRows adds no overflow line when everything fits', () => {
  const snap = buildIndicativeSetupSnapshot(2);
  assert.ok(snap);
  const rows = planSetupRows(snap.categories);
  assert.equal(rows.filter((r) => r.kind === 'overflow').length, 0);
  assert.equal(rows.filter((r) => r.kind === 'item').length, snap.itemCount);
});

// ── attachSetupCosts ──────────────────────────────────────────────

test('attachSetupCosts falls back to defaults so page 05 always has content', () => {
  const data = attachSetupCosts(deriveReportData(DEMO_MANCHESTER));
  assert.ok(data.setup, 'no setup attached');
  assert.equal(data.setup.indicative, true);
  assert.equal(typeof data.setupPaybackMonths, 'number');
});

test("attachSetupCosts prefers the lead's own figures", () => {
  const data = attachSetupCosts(deriveReportData(DEMO_MANCHESTER), {
    furnishing: 'part',
    bedrooms: 2,
    items: [
      { id: 'a', name: 'Sofa', category: 'Furniture & Beds', supplier: 'Dunelm', qty: 1, unitCost: 900, active: true },
    ],
  });
  assert.ok(data.setup);
  assert.equal(data.setup.indicative, false);
  assert.equal(data.setup.grandTotal, 900);
});

test('attachSetupCosts hides payback when a long-let is ahead', () => {
  const data = attachSetupCosts(
    deriveReportData({
      ...DEMO_MANCHESTER,
      financials: { ...DEMO_MANCHESTER.financials, shortLetNetAnnual: 1000 },
    }),
  );
  assert.equal(data.setupPaybackMonths, null);
});

// ── Page-02 reconciliation ────────────────────────────────────────

test('the cost rows reconcile to the net line the engine produced', () => {
  // Page 02 prints gross, three deductions and a net. If they do not add up
  // the "where every pound goes" bars visibly disagree with the table.
  const data = deriveReportData(DEMO_MANCHESTER);
  const { gross, platformFee, managementFee, cleaning, net } = data.shortLetAnnual;
  const summed = gross - platformFee - managementFee - cleaning;
  assert.ok(Math.abs(summed - net) <= 2, `rows sum to ${summed} but net is ${net}`);

  const ltl = data.longLetAnnual;
  assert.ok(Math.abs(ltl.gross - ltl.agentFee - ltl.net) <= 2);
});

test('monthly rows carry a short axis label', () => {
  const data = deriveReportData(DEMO_MANCHESTER);
  assert.equal(data.monthly.length, 12);
  assert.equal(data.monthly[0].short, 'JAN');
  assert.equal(data.monthly[11].short, 'DEC');
});
