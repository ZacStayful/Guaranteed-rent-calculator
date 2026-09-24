// ─── The analysis pipeline ────────────────────────────────────────
//
// Extracted verbatim from the ReadableStream.start() body of
// src/app/api/analyse/route.ts so that the live single-property flow and the
// bulk spreadsheet upload run the SAME code, not two copies that drift.
//
// Contract notes for anyone editing this file:
//
//  • `emit` replaces the route's `send`. The stage names, progress numbers and
//    message strings are part of a wire contract the browser depends on —
//    src/app/page.tsx branches on `stage` AND on `progress >= 20` / `>= 75`.
//    Do not reword or renumber them.
//
//  • The 'complete' event is emitted BEFORE the storage/CRM work below it.
//    That ordering is what keeps the lead's perceived wait at the length of the
//    analysis rather than the analysis plus a PDF render and two Monday calls.
//    Do not move the side effects ahead of it, and do not move them out to the
//    caller.
//
//  • This function does not throw. Callers get {ok:false} instead, so one bad
//    row in a bulk job can never take down the batch.

import type {
  AnalysisResult, ShortLetData, LongLetData, DemandDrivers, NearbyEvent,
  DataQuality, Recommendation, LongLetSource,
} from '../types.ts';
import { geocodePostcode } from '../apis/geocode.ts';
import { getShortLetData } from '../apis/airbtics.ts';
import { getLongLetData, getFloorArea, fetchPropertyValuation } from '../apis/propertydata.ts';
import { getNearbyAmenities } from '../apis/google-places.ts';
import { getNearbyEvents } from '../apis/ticketmaster.ts';
import { fetchPriceLabsRevenueEstimate, buildCrossValidation } from '../apis/pricelabs.ts';
import { calculateFinancials, assessRisk, generateVerdict, getRecommendation, estimateLongLet } from '../analysis.ts';
import { assessGuaranteedRent, confidenceFromDataQuality } from '../guaranteedRent.ts';
import { hasUsableShortLetData } from '../bulk/gate.ts';
import type { NormalisedInput } from './input.ts';
import { persistAndSync, type SideEffectGate, type SideEffectOutcome } from './persist.ts';

export interface ProgressEvent {
  stage: string;
  progress: number;
  message: string;
  data?: unknown;
}

export interface RunAnalysisOptions {
  onProgress?: (event: ProgressEvent) => void;
  /** Written to analyser_reports.source. 'analyser' (live) or 'bulk'. */
  reportSource?: string;
  /** Bulk passes false so a batch never burns leads' free analyses. */
  incrementUsage?: boolean;
  /** Pre-resolved Monday item; skips re-matching at write time. */
  mondayItemId?: string | null;
  /** Vetoes the CRM write when the data isn't trustworthy. See ./persist. */
  sideEffectGate?: SideEffectGate;
  /** Serialises the PDF render so concurrent rows can't OOM the function. */
  renderLock?: <T>(fn: () => Promise<T>) => Promise<T>;
}

export type RunAnalysisOutcome =
  | ({ ok: true; result: AnalysisResult } & SideEffectOutcome)
  | { ok: false; stage: 'geocode' | 'pipeline'; errorCode: string; error: string };

const GEOCODE_ERROR_MESSAGE =
  'Could not geocode the provided postcode. Please check it and try again.';
const GENERIC_ERROR_MESSAGE = 'An unexpected error occurred. Please try again.';

// The pre-'complete' events, replayed verbatim by the PIPELINE_FAKE path so a
// dry run exercises the same UI transitions a real one does.
const FAKE_SEQUENCE: ReadonlyArray<[string, number, string]> = [
  ['geocoding', 10, 'Locating property...'],
  ['geocoding', 20, 'Property located'],
  ['short_let', 40, 'Short-let revenue data received'],
  ['long_let', 50, 'Long-let valuation received'],
  ['amenities', 55, 'Finding nearby amenities & transport...'],
  ['amenities', 75, 'Nearby amenities found'],
  ['events', 80, 'Local events discovered'],
  ['analysis', 90, 'Running financial analysis...'],
];

export async function runAnalysis(
  input: NormalisedInput,
  options: RunAnalysisOptions = {},
): Promise<RunAnalysisOutcome> {
  const emit = options.onProgress ?? (() => {});
  const {
    property, email: emailStr, phone, mappedPropertyType, validBathrooms,
    parkingValue, validHasParking, validOutdoorSpace, validFinishQuality,
    validSpecialFeatures, longLetMonthlyInput, hasLongLetMonthly,
  } = input;

  try {
    // ── Zero-credit dry run ──────────────────────────────────────
    // PIPELINE_FAKE=1 short-circuits every external call with deterministic
    // figures, so the bulk machinery can be exercised end to end for £0.
    // Emits the same event sequence so the UI path is exercised too.
    if (process.env.PIPELINE_FAKE === '1') {
      const { fakeAnalysis } = await import('../bulk/fake.ts');
      for (const [stage, progress, message] of FAKE_SEQUENCE) {
        emit({ stage, progress, message });
      }
      const result = fakeAnalysis(input);
      emit({ stage: 'complete', progress: 100, message: 'Analysis complete', data: result });
      const sideEffects = await persistAndSync(result, {
        email: emailStr,
        phone,
        source: options.reportSource ?? 'analyser',
        incrementUsage: options.incrementUsage !== false,
        mondayItemId: options.mondayItemId ?? null,
        gate: options.sideEffectGate,
        renderLock: options.renderLock,
      });
      return { ok: true, result, ...sideEffects };
    }

    // ── Group 1 (parallel): Geocoding + (Short-let + Long-let) ──
    emit({ stage: 'geocoding', progress: 10, message: 'Locating property...' });

    const geocodePromise = geocodePostcode(property.postcode);
    // Get floor area + build year from /floor-areas before calling valuation
    const floorAreaPromise = getFloorArea(property.postcode, property.address, property.bedrooms);

    // Wait for geocoding first — short-let now needs coordinates for nearby listings
    let coordinates: { lat: number; lng: number };
    try {
      coordinates = await geocodePromise;
    } catch (err) {
      console.error('Geocoding failed:', err);
      emit({ stage: 'error', progress: 0, message: GEOCODE_ERROR_MESSAGE });
      // Swallow the floor-area promise so an unhandled rejection can't take
      // down the process now that nothing awaits it.
      void floorAreaPromise.catch(() => {});
      return { ok: false, stage: 'geocode', errorCode: 'geocode_failed', error: GEOCODE_ERROR_MESSAGE };
    }

    emit({ stage: 'geocoding', progress: 20, message: 'Property located' });

    // Wait for floor area data before starting long-let call
    const floorArea = await floorAreaPromise;

    // Long-let figure: when the landlord told us what the property rents
    // for as a standard long-term let, that IS the comparison figure — we
    // bypass the PropertyData valuation entirely and run every downstream
    // long-let number (financials, comparison, decision) off their figure.
    // Only fall back to the PropertyData API when they didn't provide one
    // (or chose "Not sure").
    const longLetPromise: Promise<LongLetData> = hasLongLetMonthly
      ? Promise.resolve({
          monthlyRent: longLetMonthlyInput,
          estimateHigh: longLetMonthlyInput,
          estimateLow: longLetMonthlyInput,
          comparables: [],
        })
      : getLongLetData(property.postcode, property.bedrooms, {
          propertyType: mappedPropertyType,
          constructionDate: floorArea.constructionDate,
          internalArea: floorArea.squareFeet,
          ...(validBathrooms && { bathrooms: validBathrooms }),
          finishQuality: validFinishQuality,
          outdoorSpace: validOutdoorSpace,
          offStreetParking: parkingValue,
        });

    // Now fetch short-let (needs coords) + long-let in parallel
    const shortLetPromise = getShortLetData(
      property.postcode,
      property.bedrooms,
      property.guests,
      coordinates.lat,
      coordinates.lng,
      {
        bathrooms: validBathrooms,
        hasParking: validHasParking,
        parkingSpaces: parkingValue,            // V3: for ADR feature multiplier
        finishQuality: validFinishQuality || undefined,
        outdoorSpace: validOutdoorSpace,        // V3
        propertyType: mappedPropertyType,       // V3
        specialFeatures: validSpecialFeatures,  // V3
      },
    );
    // PriceLabs Revenue Estimator is gated behind PRICELABS_AS_PRIMARY
    // env var. When unset (the default), PriceLabs is NOT called at all
    // — saves trial credits and keeps the existing Airbtics-V4 pipeline
    // as the sole headline source. To re-enable PriceLabs as primary,
    // set PRICELABS_AS_PRIMARY=true in Vercel and redeploy.
    //
    // When enabled and successful, PriceLabs RE OVERRIDES the V4
    // headline below. When it fails (missing key, 401, 429 quota
    // exhausted, 500), V4 result stays unchanged.
    const priceLabsEnabled = process.env.PRICELABS_AS_PRIMARY === 'true';
    const priceLabsPromise: Promise<Awaited<ReturnType<typeof fetchPriceLabsRevenueEstimate>>> = priceLabsEnabled
      ? fetchPriceLabsRevenueEstimate({
          address: property.address,
          bedrooms: property.bedrooms,
          lat: coordinates.lat,
          lng: coordinates.lng,
          currency: 'GBP',
        })
      : Promise.resolve(null);
    if (!priceLabsEnabled) {
      console.log('[PriceLabs RE] disabled (PRICELABS_AS_PRIMARY not set) — using Airbtics-V4 only');
    }

    // Sale valuation runs in parallel — never blocks or throws
    const saleValuationPromise = fetchPropertyValuation(
      property.postcode,
      property.bedrooms,
      mappedPropertyType,
    );

    const [shortLetResult, longLetResult, priceLabsResult, saleValuationResult] = await Promise.allSettled([
      shortLetPromise,
      longLetPromise,
      priceLabsPromise,
      saleValuationPromise,
    ]);

    const shortLetRaw = shortLetResult.status === 'fulfilled'
      ? shortLetResult.value
      : {
          data: {
            annualRevenue: 0,
            monthlyRevenue: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] as ShortLetData['monthlyRevenue'],
            occupancyRate: 0,
            averageDailyRate: 0,
            activeListings: 0,
            comparables: [],
          },
          quality: {
            comparablesFound: 0, comparablesTarget: 12,
            searchRadiusKm: 0, searchBroadened: false, level: 'low' as const,
            disclaimer: 'Unable to fetch short-term rental data. Book a web meeting with Stayful for a personalised assessment.',
          },
        };
    const shortLet: ShortLetData = shortLetRaw.data;
    const dataQuality: DataQuality = shortLetRaw.quality;

    const longLet: LongLetData = longLetResult.status === 'fulfilled'
      ? longLetResult.value
      : {
          monthlyRent: 0,
          estimateHigh: 0,
          estimateLow: 0,
          comparables: [],
        };

    if (shortLetResult.status === 'rejected') {
      console.error('Airbtics API failed:', shortLetResult.reason);
    }
    if (longLetResult.status === 'rejected') {
      console.error('PropertyData API failed:', longLetResult.reason);
    }

    emit({ stage: 'short_let', progress: 40, message: 'Short-let revenue data received' });
    emit({ stage: 'long_let', progress: 50, message: 'Long-let valuation received' });

    // ── Group 2 (parallel, needs geocoding): Amenities + Events ──
    emit({ stage: 'amenities', progress: 55, message: 'Finding nearby amenities & transport...' });

    const [amenitiesResult, eventsResult] = await Promise.allSettled([
      getNearbyAmenities(coordinates.lat, coordinates.lng),
      getNearbyEvents(coordinates.lat, coordinates.lng),
    ]);

    const demandDrivers: DemandDrivers = amenitiesResult.status === 'fulfilled'
      ? amenitiesResult.value
      : {
          hospitals: [],
          universities: [],
          airports: [],
          trainStations: [],
          busStations: [],
          subwayStations: [],
        };

    const nearbyEvents: { events: NearbyEvent[]; totalEvents: number } =
      eventsResult.status === 'fulfilled'
        ? eventsResult.value
        : { events: [], totalEvents: 0 };

    if (amenitiesResult.status === 'rejected') {
      console.error('Google Places API failed:', amenitiesResult.reason);
    }
    if (eventsResult.status === 'rejected') {
      console.error('Ticketmaster API failed:', eventsResult.reason);
    }

    emit({ stage: 'amenities', progress: 75, message: 'Nearby amenities found' });
    emit({ stage: 'events', progress: 80, message: 'Local events discovered' });

    // ── Final: Run analysis ──────────────────────────────────────
    emit({ stage: 'analysis', progress: 90, message: 'Running financial analysis...' });

    // PriceLabs Revenue Estimator override.
    // If the trial/subscription returned a successful estimate, it
    // becomes the primary headline source — we overwrite shortLet.* with
    // PriceLabs values BEFORE running financials. The V4-on-Airbtics
    // result is preserved in crossValidation.airbticsRevenue for
    // transparency but no longer drives the headline.
    const priceLabsData = priceLabsResult.status === 'fulfilled' ? priceLabsResult.value : null;
    if (priceLabsResult.status === 'rejected') {
      console.error('[PriceLabs RE] promise rejected:', priceLabsResult.reason);
    }

    const propertyValuation = saleValuationResult.status === 'fulfilled'
      ? saleValuationResult.value
      : null;
    if (saleValuationResult.status === 'rejected') {
      console.error('[PropertyData] sale valuation promise rejected:', (saleValuationResult as PromiseRejectedResult).reason);
    }
    const crossValidation = buildCrossValidation(shortLet.annualRevenue, priceLabsData);

    if (priceLabsData) {
      // Override headline: replace V4 numbers with PriceLabs RE numbers.
      // Comparables stay as Airbtics-sourced (PriceLabs RE doesn't
      // expose individual comp listings, only aggregates).
      shortLet.annualRevenue = priceLabsData.annualRevenue;
      shortLet.averageDailyRate = priceLabsData.adr;
      shortLet.occupancyRate = priceLabsData.occupancy;
      // PriceLabs gives us 12 monthly values — use directly.
      // Cast required: ShortLetData expects a fixed-length tuple.
      const padded: number[] = [...priceLabsData.monthlyRevenue];
      while (padded.length < 12) padded.push(0);
      shortLet.monthlyRevenue = padded.slice(0, 12) as ShortLetData['monthlyRevenue'];
      console.log(`[PriceLabs RE] overrode headline: was £${crossValidation.airbticsRevenue}, now £${priceLabsData.annualRevenue} (range £${priceLabsData.rangeLow}-£${priceLabsData.rangeHigh})`);
    }
    console.log(`[PriceLabs RE] crossValidation: source=${crossValidation.source}, confidence=${crossValidation.confidence}, divergence=${crossValidation.divergencePct?.toFixed(1) ?? 'n/a'}%`);

    // Re-run financials with the (possibly overridden) shortLet values
    const financials = calculateFinancials(shortLet, longLet);
    const risk = assessRisk(shortLet, longLet, demandDrivers, nearbyEvents);
    const verdict = generateVerdict(financials, risk);

    // ── Qualification decision: short-let vs long-let ──
    // Resolve the long-let monthly figure to compare against:
    //   1. landlord's entered figure, else
    //   2. estimateLongLet() (currently a stub → null), else
    //   3. PropertyData valuation fallback.
    let longLetMonthlyForDecision = 0;
    let longLetSource: LongLetSource = 'user';
    if (hasLongLetMonthly) {
      longLetMonthlyForDecision = longLetMonthlyInput;
      longLetSource = 'user';
    } else {
      const estimated = estimateLongLet(property.postcode, property.bedrooms);
      if (estimated != null && estimated > 0) {
        longLetMonthlyForDecision = estimated;
        longLetSource = 'estimate';
      } else {
        longLetMonthlyForDecision = longLet.monthlyRent;
        longLetSource = 'propertydata_fallback';
      }
    }

    // ── Guaranteed-rent screening and offer ──
    // The rent we price against is what the landlord asked for. When they gave
    // no figure (a bulk row with the column blank) we fall back to the same
    // long-let figure the decision above uses, and mark it as an estimate so
    // the report and the CRM never present it as confirmed.
    const desiredRent = property.desiredRentMonthly;
    const hasDesiredRent = typeof desiredRent === 'number' && Number.isFinite(desiredRent) && desiredRent > 0;
    const rentForOffer = hasDesiredRent ? desiredRent : (longLetMonthlyForDecision || null);
    // A synthetic estimate is the one thing we must not price a real offer on.
    // bulkSideEffectGate already encodes exactly that test, so reuse it rather
    // than growing a second opinion about what counts as usable data.
    const dataIsUsable = hasUsableShortLetData({ shortLet, dataQuality }).allow;
    const guaranteedRent = assessGuaranteedRent({
      grossStrAnnual: dataIsUsable ? shortLet.annualRevenue : null,
      desiredRentMonthly: rentForOffer,
      bedrooms: property.bedrooms,
      desiredRentIsEstimate: !hasDesiredRent,
      grossStrIsEstimate: !dataIsUsable,
      confidence: confidenceFromDataQuality(dataQuality),
    });

    // Only produce a decision when we have both a gross STR projection and a
    // positive long-let figure to compare against (avoids divide-by-zero).
    let recommendation: Recommendation | undefined;
    if (shortLet.annualRevenue > 0 && longLetMonthlyForDecision > 0) {
      // Pass the bedroom-scaled fixed costs so the short-let recommendation and
      // the guaranteed-rent offer in the same report never disagree about what
      // the property costs to run.
      const decision = getRecommendation(
        shortLet.annualRevenue,
        longLetMonthlyForDecision,
        guaranteedRent.fixedCostsAnnual,
      );
      recommendation = {
        ...decision,
        longLetMonthly: longLetMonthlyForDecision,
        longLetSource,
      };
    }

    const now = new Date().toISOString();

    const result: AnalysisResult = {
      property,
      coordinates,
      shortLet,
      longLet,
      demandDrivers,
      nearbyEvents,
      financials,
      dataQuality,
      risk,
      verdict,
      recommendation,
      createdAt: now,
      updatedAt: now,
      crossValidation,
      propertyValuation,
      guaranteedRent,
    };

    emit({ stage: 'complete', progress: 100, message: 'Analysis complete', data: result });

    // Everything past this point is a pure side effect — the lead already has
    // their estimate.
    const sideEffects = await persistAndSync(result, {
      email: emailStr,
      phone,
      source: options.reportSource ?? 'analyser',
      incrementUsage: options.incrementUsage !== false,
      mondayItemId: options.mondayItemId ?? null,
      gate: options.sideEffectGate,
      renderLock: options.renderLock,
    });

    return { ok: true, result, ...sideEffects };
  } catch (err) {
    console.error('Unexpected error in runAnalysis:', err);
    emit({ stage: 'error', progress: 0, message: GENERIC_ERROR_MESSAGE });
    return { ok: false, stage: 'pipeline', errorCode: 'pipeline_error', error: GENERIC_ERROR_MESSAGE };
  }
}
