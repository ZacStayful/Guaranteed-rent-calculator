// ─── Deterministic fake analysis (PIPELINE_FAKE=1) ────────────────
//
// Produces a plausible AnalysisResult without calling any external API, so the
// whole bulk machinery — parsing, matching, claiming, concurrency, retries,
// cancellation, progress, the results CSV — can be exercised for £0.
//
// Numbers are seeded off the postcode and bedroom count, so the same row always
// yields the same figures and a 100-row fake job produces varied but repeatable
// output. Never enabled in production; guarded by an explicit env flag.

import type { AnalysisResult, ShortLetData } from '../types.ts';
import type { NormalisedInput } from '../pipeline/input.ts';
import { calculateFinancials, assessRisk, generateVerdict, getRecommendation } from '../analysis.ts';

/** Small deterministic hash → a stable pseudo-random per input. */
function seed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

export function fakeAnalysis(input: NormalisedInput): AnalysisResult {
  const { property } = input;
  // Two INDEPENDENT seeds. Deriving the long-let rent from the same seed as
  // the short-let revenue correlates them, and every row then lands on the
  // same side of the recommendation threshold — a fake batch that only ever
  // exercises one branch, and (with MONDAY_DRY_RUN off) would mark every lead
  // unqualified. Decorrelating them gives a realistic spread of Short-Let /
  // Long-Let and of qualification bands.
  const r = seed(`str|${property.postcode}|${property.bedrooms}`);
  const rRent = seed(`ltl|${property.postcode}|${property.bedrooms}`);

  const adr = Math.round(70 + property.bedrooms * 25 + r * 90);
  const occupancy = 0.5 + r * 0.35;
  const annualRevenue = Math.round(adr * 365 * occupancy);
  const monthly = Array.from({ length: 12 }, (_, m) =>
    Math.round((annualRevenue / 12) * (0.8 + 0.4 * seed(`${property.postcode}|${m}`))),
  ) as ShortLetData['monthlyRevenue'];

  const shortLet: ShortLetData = {
    annualRevenue,
    monthlyRevenue: monthly,
    occupancyRate: occupancy,
    averageDailyRate: adr,
    activeListings: Math.round(20 + r * 100),
    comparables: [],
  };

  const monthlyRent = Math.round(550 + property.bedrooms * 180 + rRent * 350);
  const longLet = {
    monthlyRent,
    estimateHigh: Math.round(monthlyRent * 1.12),
    estimateLow: Math.round(monthlyRent * 0.88),
    comparables: [],
  };

  const demandDrivers = {
    hospitals: [], universities: [], airports: [],
    trainStations: [], busStations: [], subwayStations: [],
  };
  const nearbyEvents = { events: [], totalEvents: Math.round(r * 20) };

  const financials = calculateFinancials(shortLet, longLet);
  const risk = assessRisk(shortLet, longLet, demandDrivers, nearbyEvents);
  const verdict = generateVerdict(financials, risk);

  const decision = getRecommendation(annualRevenue, monthlyRent);
  const now = new Date().toISOString();

  return {
    property,
    coordinates: { lat: 52.95 + r, lng: -1.15 + r },
    shortLet,
    longLet,
    demandDrivers,
    nearbyEvents,
    financials,
    dataQuality: {
      // Deliberately NOT zero: the side-effect gate rejects rows with no
      // comparables, so a fake run has to look like real data or every row
      // would be vetoed and the gate itself would go untested.
      comparablesFound: 12,
      comparablesTarget: 12,
      searchRadiusKm: 2,
      searchBroadened: false,
      level: 'high',
      disclaimer: 'FAKE DATA — PIPELINE_FAKE is enabled. Not a real estimate.',
    },
    risk,
    verdict,
    recommendation: { ...decision, longLetMonthly: monthlyRent, longLetSource: 'propertydata_fallback' },
    createdAt: now,
    updatedAt: now,
    propertyValuation: null,
  };
}
