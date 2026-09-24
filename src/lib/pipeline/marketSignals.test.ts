import { test } from 'node:test';
import assert from 'node:assert/strict';

import { marketSignals, listingDensity } from './marketSignals.ts';
import { fakeAnalysis } from '../bulk/fake.ts';
import { normaliseAnalysisInput, defaultGuests } from './input.ts';
import type { AnalysisResult, ShortLetComparable } from '../types.ts';

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

function comp(over: Partial<ShortLetComparable>): ShortLetComparable {
  return {
    title: 'x', url: 'https://example.com', bedrooms: 2, accommodates: 4,
    averageDailyRate: 100, occupancyRate: 0.6, annualRevenue: 21900,
    rating: 4.8, reviewCount: 40, listingAge: 3, daysAvailable: 300, amenityCount: 0,
    ...over,
  };
}

test('no comparables → comparable aggregates are null, not 0', () => {
  const s = marketSignals(fixture());
  assert.equal(s.comp_count, null);
  assert.equal(s.comp_avg_rating, null);
  assert.equal(s.comp_avg_review_count, null);
  assert.equal(s.comp_avg_listing_age, null);
  assert.equal(s.market_signals_version, 1);
});

test('unreviewed listings (rating 0 / reviewCount 0) are excluded from the rating average only', () => {
  const r = fixture();
  r.shortLet.comparables = [
    comp({ rating: 5, reviewCount: 10 }),
    comp({ rating: 0, reviewCount: 0 }), // brand-new listing
    comp({ rating: 4, reviewCount: 30 }),
  ];
  const s = marketSignals(r);
  assert.equal(s.comp_avg_rating, 4.5);
  assert.equal(s.comp_avg_review_count, Math.round(((10 + 0 + 30) / 3) * 100) / 100);
  assert.equal(s.comp_count, 3);
});

test('comparable occupancy is stored as a percentage', () => {
  const r = fixture();
  r.shortLet.comparables = [comp({ occupancyRate: 0.5 }), comp({ occupancyRate: 0.7 })];
  assert.equal(marketSignals(r).comp_avg_occupancy, 60);
});

test('listing density needs a real market count and a positive radius', () => {
  assert.equal(listingDensity(null, 2), null);
  assert.equal(listingDensity(50, 0), null);
  assert.equal(listingDensity(12, 2), null, '≤12 is the comparable set, not the market');
  assert.equal(listingDensity(100, 2), Math.round((100 / (Math.PI * 4)) * 1000) / 1000);
});

test('density and radius flow from the analysis', () => {
  const r = fixture();
  r.shortLet.activeListings = 80;
  r.dataQuality.searchRadiusKm = 1.6;
  const s = marketSignals(r);
  assert.equal(s.active_listings, 80);
  assert.equal(s.comp_radius_km, 1.6);
  assert.equal(s.listing_density, listingDensity(80, 1.6));
});

test('an all-empty demand block (the API-failure fallback) is unknown, not zero', () => {
  const s = marketSignals(fixture()); // fake fixture has every driver list empty
  assert.equal(s.demand_hospitals, null);
  assert.equal(s.demand_universities, null);
  assert.equal(s.demand_transport, null);
});

test('activeListings of 0 is unknown, not zero density', () => {
  const r = fixture();
  r.shortLet.activeListings = 0;
  const s = marketSignals(r);
  assert.equal(s.active_listings, null);
  assert.equal(s.listing_density, null);
});

test('demand driver counts, events and coordinates are extracted', () => {
  const r = fixture();
  const a = { name: 'x', type: 'poi', address: 'y', distance: 1, rating: null };
  r.demandDrivers = {
    hospitals: [a, a], universities: [a], airports: [a],
    trainStations: [a], busStations: [a, a], subwayStations: [],
  };
  r.nearbyEvents = { events: [], totalEvents: 57 };
  r.coordinates = { lat: 51.45, lng: -2.58 };
  const s = marketSignals(r);
  assert.equal(s.demand_hospitals, 2);
  assert.equal(s.demand_universities, 1);
  assert.equal(s.demand_transport, 3);
  assert.equal(s.demand_events, 57);
  // known drivers with genuinely zero events stays 0
  r.nearbyEvents = { events: [], totalEvents: 0 };
  assert.equal(marketSignals(r).demand_events, 0);
  assert.equal(s.lat, 51.45);
  assert.equal(s.lng, -2.58);
});
