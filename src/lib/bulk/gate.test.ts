import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AnalysisResult, DataQuality, ShortLetData } from '../types.ts';
import { bulkSideEffectGate, ConsecutiveFailureBreaker } from './gate.ts';

function result(shortLet: Partial<ShortLetData>, quality: Partial<DataQuality>): AnalysisResult {
  return {
    shortLet: { annualRevenue: 30000, averageDailyRate: 120, occupancyRate: 0.65, activeListings: 40, monthlyRevenue: Array(12).fill(2500), comparables: [], ...shortLet },
    dataQuality: { comparablesFound: 12, comparablesTarget: 12, searchRadiusKm: 2, searchBroadened: false, level: 'high', disclaimer: '', ...quality },
  } as unknown as AnalysisResult;
}

test('allows a run backed by real comparables', () => {
  assert.deepEqual(bulkSideEffectGate(result({}, {})), { allow: true });
});

test('blocks a zero-revenue run', () => {
  // This is the exact shape /api/analyse's allSettled fallback produces when
  // getShortLetData rejects. Left ungated it drives getLeadQualification to
  // 'unqualified' and moves the lead to Abandoned.
  const verdict = bulkSideEffectGate(result({ annualRevenue: 0 }, { comparablesFound: 0, level: 'low' }));
  assert.equal(verdict.allow, false);
  assert.match(verdict.reason ?? '', /no_str_data/);
});

test('blocks a SYNTHETIC estimate even though the revenue looks real', () => {
  // generateMarketEstimate() returns a plausible non-zero figure alongside a
  // quality block with comparablesFound: 0. Revenue alone cannot tell these
  // apart from real data, which is why the gate checks provenance.
  const verdict = bulkSideEffectGate(
    result({ annualRevenue: 28500 }, { comparablesFound: 0, level: 'low' }),
  );
  assert.equal(verdict.allow, false);
  assert.match(verdict.reason ?? '', /synthetic estimate/);
});

test('blocks a low-quality run', () => {
  const verdict = bulkSideEffectGate(result({ annualRevenue: 28500 }, { comparablesFound: 3, level: 'low' }));
  assert.equal(verdict.allow, false);
});

test('allows a moderate-quality run with real comparables', () => {
  assert.equal(bulkSideEffectGate(result({ annualRevenue: 25000 }, { comparablesFound: 6, level: 'moderate' })).allow, true);
});

test('blocks negative revenue and missing blocks defensively', () => {
  assert.equal(bulkSideEffectGate(result({ annualRevenue: -1 }, {})).allow, false);
  assert.equal(bulkSideEffectGate({} as AnalysisResult).allow, false);
});

// ─── Circuit breaker ──────────────────────────────────────────────

test('the breaker trips only after consecutive failures', () => {
  const breaker = new ConsecutiveFailureBreaker(3);
  breaker.record(true);
  breaker.record(true);
  assert.equal(breaker.tripped, false, 'two failures is not yet an outage');
  breaker.record(true);
  assert.equal(breaker.tripped, true);
});

test('a success resets the breaker', () => {
  // One gated row is a quiet property, not an outage — it must not accumulate.
  const breaker = new ConsecutiveFailureBreaker(3);
  breaker.record(true);
  breaker.record(true);
  breaker.record(false);
  breaker.record(true);
  breaker.record(true);
  assert.equal(breaker.tripped, false);
});

test('the breaker explains itself', () => {
  const breaker = new ConsecutiveFailureBreaker(2);
  breaker.record(true);
  breaker.record(true);
  assert.match(breaker.reason, /consecutive rows/);
});
