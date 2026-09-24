// ─── Market signals ────────────────────────────────────────────────
//
// The per-report figures the Market Explorer aggregates per postcode area
// beyond the headline revenue/ADR/occupancy: competition (review depth,
// listing age, listing density), local demand drivers and the report's
// coordinates. Written onto analyser_reports by persistAndSync for new rows;
// the SQL migration 20260905120000_analyser_reports_market_signals.sql
// derives exactly the same fields from raw_response for existing rows — keep
// the two in step.

import type { AnalysisResult } from '../types.ts';

export interface MarketSignals {
  comp_count: number | null;
  comp_radius_km: number | null;
  comp_avg_adr: number | null;
  comp_avg_occupancy: number | null; // PERCENT 0–100
  comp_avg_annual_revenue: number | null;
  comp_avg_rating: number | null; // 0–5, reviewed listings only
  comp_avg_review_count: number | null;
  comp_avg_listing_age: number | null; // years
  active_listings: number | null;
  listing_density: number | null; // listings per km² at comp_radius_km
  // null = unknown (the analyser substitutes an all-empty driver block when
  // Google Places fails, so "every list empty" is read as unknown, not zero)
  demand_hospitals: number | null;
  demand_universities: number | null;
  demand_transport: number | null;
  demand_events: number | null;
  lat: number | null;
  lng: number | null;
  market_signals_version: 1;
}

/**
 * Below this many matches the Airbtics count is the comparable set itself
 * (the V2 path literally stores top12.length), not a market-wide count, so a
 * density built from it would be meaningless.
 */
export const MIN_LISTINGS_FOR_DENSITY = 12;

function finite(n: unknown): number | null {
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

function round(n: number | null, dp: number): number | null {
  if (n === null) return null;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/** listings per km² at the radius the search ended on, or null when unknowable. */
export function listingDensity(activeListings: number | null, radiusKm: number | null): number | null {
  if (activeListings === null || radiusKm === null) return null;
  if (activeListings <= MIN_LISTINGS_FOR_DENSITY || radiusKm <= 0) return null;
  return round(activeListings / (Math.PI * radiusKm * radiusKm), 3);
}

export function marketSignals(result: AnalysisResult): MarketSignals {
  const comps = Array.isArray(result.shortLet?.comparables) ? result.shortLet.comparables : [];
  const reviewed = comps.filter((c) => (finite(c.reviewCount) ?? 0) > 0 && (finite(c.rating) ?? 0) > 0);

  const activeListings = (() => {
    const n = finite(result.shortLet?.activeListings);
    return n === null || n <= 0 ? null : Math.round(n);
  })();
  const radius = finite(result.dataQuality?.searchRadiusKm);

  const d = result.demandDrivers;
  const len = (a: unknown[] | undefined) => (Array.isArray(a) ? a.length : 0);
  const hospitals = len(d?.hospitals);
  const universities = len(d?.universities);
  const transport = len(d?.trainStations) + len(d?.busStations) + len(d?.subwayStations);
  const driversUnknown = hospitals + universities + transport + len(d?.airports) === 0;
  const events = finite(result.nearbyEvents?.totalEvents);

  return {
    comp_count: comps.length > 0 ? comps.length : null,
    comp_radius_km: radius,
    comp_avg_adr: round(mean(comps.map((c) => finite(c.averageDailyRate)).filter((v): v is number => v !== null)), 2),
    comp_avg_occupancy: round(
      (() => {
        const m = mean(comps.map((c) => finite(c.occupancyRate)).filter((v): v is number => v !== null));
        return m === null ? null : m * 100;
      })(),
      2,
    ),
    comp_avg_annual_revenue: round(mean(comps.map((c) => finite(c.annualRevenue)).filter((v): v is number => v !== null)), 2),
    comp_avg_rating: round(mean(reviewed.map((c) => c.rating)), 3),
    comp_avg_review_count: round(mean(comps.map((c) => finite(c.reviewCount)).filter((v): v is number => v !== null)), 2),
    comp_avg_listing_age: round(mean(comps.map((c) => finite(c.listingAge)).filter((v): v is number => v !== null)), 2),
    active_listings: activeListings,
    listing_density: listingDensity(activeListings, radius),
    demand_hospitals: driversUnknown ? null : hospitals,
    demand_universities: driversUnknown ? null : universities,
    demand_transport: driversUnknown ? null : transport,
    // Ticketmaster fails the same way (0); when the drivers are unknown too,
    // treat a 0 as unknown rather than "no events".
    demand_events: driversUnknown && (events ?? 0) === 0 ? null : events,
    lat: finite(result.coordinates?.lat),
    lng: finite(result.coordinates?.lng),
    market_signals_version: 1,
  };
}
