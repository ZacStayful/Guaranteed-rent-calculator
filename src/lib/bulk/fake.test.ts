import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseAnalysisInput } from '../pipeline/input.ts';
import { getLeadQualification } from '../analysis.ts';
import { fakeAnalysis } from './fake.ts';

function input(postcode: string, bedrooms: number) {
  const result = normaliseAnalysisInput({
    address: `1 Test Street, ${postcode}`,
    postcode,
    bedrooms,
    guests: Math.min(16, bedrooms * 2 + 2),
  });
  assert.ok(result.ok);
  return result.input;
}

// Real postcodes taken from the Management Leads board.
const POSTCODES = [
  'NG1 5GY', 'M1 1AE', 'BS1 4RR', 'LE5 2HQ', 'CF24 0JE', 'EH6 6NH',
  'B12 9PY', 'TR26 2QH', 'PR4 2EJ', 'CH64 4BE', 'CW6 9RQ', 'L6 4BH',
];

test('the same row always produces the same figures', () => {
  const a = fakeAnalysis(input('NG1 5GY', 2));
  const b = fakeAnalysis(input('NG1 5GY', 2));
  assert.equal(a.shortLet.annualRevenue, b.shortLet.annualRevenue);
  assert.equal(a.longLet.monthlyRent, b.longLet.monthlyRent);
});

test('different properties produce different figures', () => {
  const a = fakeAnalysis(input('NG1 5GY', 2));
  const b = fakeAnalysis(input('M1 1AE', 2));
  assert.notEqual(a.shortLet.annualRevenue, b.shortLet.annualRevenue);
});

test('figures are plausible, not degenerate', () => {
  for (const pc of POSTCODES) {
    for (const beds of [0, 1, 2, 3, 4, 5]) {
      const r = fakeAnalysis(input(pc, beds));
      assert.ok(r.shortLet.annualRevenue > 0, `${pc}/${beds}: revenue must be positive`);
      assert.ok(r.shortLet.averageDailyRate > 0);
      assert.ok(r.shortLet.occupancyRate > 0 && r.shortLet.occupancyRate < 1, 'occupancy is a 0-1 fraction');
      assert.equal(r.shortLet.monthlyRevenue.length, 12);
      assert.ok(r.longLet.monthlyRent > 0);
    }
  }
});

test('a fake batch exercises BOTH recommendation branches', () => {
  // If every row lands on the same side of the threshold, a dry run only ever
  // tests one code path — and with MONDAY_DRY_RUN off would mark every lead
  // unqualified and move it to Abandoned. This is what that regression looks
  // like, so it is asserted rather than assumed.
  const seen = new Set<string>();
  for (const pc of POSTCODES) {
    for (const beds of [1, 2, 3, 4]) {
      const r = fakeAnalysis(input(pc, beds));
      assert.ok(r.recommendation, 'a decision must be produced');
      seen.add(r.recommendation.recommendation);
    }
  }
  assert.ok(seen.has('SHORT_LET'), 'no SHORT_LET rows — the fixture is one-sided');
  assert.ok(seen.has('LONG_LET'), 'no LONG_LET rows — the fixture is one-sided');
});

test('a fake batch exercises more than one qualification band', () => {
  const bands = new Set<string>();
  for (const pc of POSTCODES) {
    for (const beds of [1, 2, 3, 4]) {
      const r = fakeAnalysis(input(pc, beds));
      bands.add(getLeadQualification(r.recommendation!.upliftPct));
    }
  }
  assert.ok(bands.size > 1, `only saw bands: ${[...bands].join(', ')}`);
});

test('fake data passes the side-effect gate, so the gate itself gets tested', () => {
  // The gate rejects comparablesFound === 0. If the fake reported zero, every
  // fake row would be vetoed and the CRM path would never be exercised.
  const r = fakeAnalysis(input('NG1 5GY', 2));
  assert.ok(r.dataQuality.comparablesFound > 0);
  assert.match(r.dataQuality.disclaimer ?? '', /FAKE DATA/, 'must be obvious it is not a real estimate');
});
