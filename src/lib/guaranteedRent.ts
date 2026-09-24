// ─── Guaranteed-rent screening and offer ──────────────────────────
//
// The rent-to-rent deal model behind the guaranteed rent calculator.
//
// Stayful takes the property on a fixed rent, runs it as a short-term let, and
// keeps whatever is left after costs. So the question this file answers is:
// given what a landlord wants per month, and what the property would gross on
// Airbnb, is there still £8,000 a year in it for us — and if not, what is the
// most we could pay?
//
// The cost side is NOT new. src/lib/analysis.ts already deducts exactly
// 15% platform + 15% management + 3% VAT + 18% cleaning + 5% maintenance,
// leaving TRUE_NET_PCT = 0.44, and already carries £5,904/yr of fixed costs
// (£450 bills + £42 software, monthly). That £5,904 is the 4-bed figure in the
// deal model below; the table here just scales the bills component by bedroom
// count (£300/mo at 1 bed, +£50/mo per extra bedroom) and leaves the £42/mo
// software cost flat. A 4-bed therefore reconciles exactly with the short-let
// recommendation the same report already makes.
//
// Everything here is pure arithmetic — no I/O, no dates, no randomness — so it
// is covered directly by guaranteedRent.test.ts.

import { TRUE_NET_PCT } from './analysis';
import type { DataQuality } from './types';

/** Profit we need to clear, per year, for a deal to be worth doing. */
export const TARGET_ANNUAL_PROFIT = 8000;

/** Below the target but at or above this, a deal is worth a human looking at. */
export const MEDIUM_BAND_FLOOR = 4000;

/**
 * Annual fixed costs a short-let carries regardless of occupancy, by bedroom
 * count. Bills scale with the property; the software cost does not.
 *
 *   1 bed  £300/mo bills + £42/mo software = £342/mo = £4,104/yr
 *   ...    +£50/mo of bills per extra bedroom
 *   5+ bed £500/mo bills + £42/mo software = £542/mo = £6,504/yr
 */
export const FIXED_COSTS_ANNUAL_BY_BEDROOMS: Readonly<Record<number, number>> = {
  1: 4104,
  2: 4704,
  3: 5304,
  4: 5904,
  5: 6504,
};

/** Used when bedrooms are unknown. The result is flagged so callers can say so. */
export const FALLBACK_BEDROOMS = 4;

const MIN_BEDROOM_BAND = 1;
const MAX_BEDROOM_BAND = 5;

export type GuaranteedRentBand =
  | 'QUALIFIED'
  | 'MEDIUM'
  | 'UNQUALIFIED'
  | 'INSUFFICIENT_DATA';

export type GuaranteedRentConfidence = 'high' | 'medium' | 'low';

export interface FixedCostsResult {
  /** Annual fixed costs in £. */
  amount: number;
  /** The bedroom band actually used, after clamping to 1–5. */
  bedroomsUsed: number;
  /** True when bedrooms were unknown and the 4-bed figure was assumed. */
  assumedDefault: boolean;
}

/**
 * Annual fixed costs for a property.
 *
 * A studio (0 beds) is charged at the 1-bed rate rather than being treated as
 * unknown — it is a real, known, small property. Anything above 5 beds is
 * charged at the 5-bed rate, matching the "5+" row of the table.
 */
export function fixedCostsAnnual(bedrooms: number | null | undefined): FixedCostsResult {
  if (typeof bedrooms !== 'number' || !Number.isFinite(bedrooms)) {
    return {
      amount: FIXED_COSTS_ANNUAL_BY_BEDROOMS[FALLBACK_BEDROOMS],
      bedroomsUsed: FALLBACK_BEDROOMS,
      assumedDefault: true,
    };
  }
  const band = Math.min(
    MAX_BEDROOM_BAND,
    Math.max(MIN_BEDROOM_BAND, Math.round(bedrooms)),
  );
  return {
    amount: FIXED_COSTS_ANNUAL_BY_BEDROOMS[band],
    bedroomsUsed: band,
    assumedDefault: false,
  };
}

/**
 * Maps the analyser's own data-quality grade onto the confidence wording the
 * deal model reports. The analyser grades 'moderate'; the deal model says
 * 'medium'. Same thing, different vocabulary — converted in one place.
 */
export function confidenceFromDataQuality(
  quality: Pick<DataQuality, 'level'> | null | undefined,
): GuaranteedRentConfidence {
  switch (quality?.level) {
    case 'high':
      return 'high';
    case 'low':
      return 'low';
    case 'moderate':
      return 'medium';
    default:
      return 'low';
  }
}

export interface GuaranteedRentInput {
  /** Gross annual short-let revenue, before any deduction. */
  grossStrAnnual: number | null | undefined;
  /** What the landlord wants per month. */
  desiredRentMonthly: number | null | undefined;
  bedrooms: number | null | undefined;
  /** True when desiredRentMonthly was estimated rather than given by the landlord. */
  desiredRentIsEstimate?: boolean;
  /** True when grossStrAnnual is a synthetic estimate rather than market data. */
  grossStrIsEstimate?: boolean;
  confidence?: GuaranteedRentConfidence;
}

export interface GuaranteedRentAssessment {
  band: GuaranteedRentBand;
  confidence: GuaranteedRentConfidence;
  /** One line explaining the band, for the CRM and the bulk export. */
  reason: string;

  bedroomsUsed: number;
  bedroomsAssumed: boolean;

  desiredRentMonthly: number | null;
  desiredRentIsEstimate: boolean;
  annualRent: number | null;

  grossStrAnnual: number | null;
  grossStrIsEstimate: boolean;
  strNetAnnual: number | null;

  fixedCostsAnnual: number;

  annualProfit: number | null;
  monthlyProfit: number | null;

  requiredGrossAnnual: number | null;
  gapAnnual: number | null;
  revenueMultiple: number | null;

  /** The most we could pay per month and still clear TARGET_ANNUAL_PROFIT. */
  maxAffordableRentMonthly: number | null;
  /** What we actually offer: their ask when we can afford it, else our max. */
  offerRentMonthly: number | null;
  /** True when the offer matches what they asked for. */
  offerMeetsAsk: boolean;
  /** False when there is no viable offer at all (or we have no data). */
  hasOffer: boolean;
}

function isUsableAmount(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Screens one property and produces the offer.
 *
 * The band is computed on the rent the landlord ASKED for, not on the rent we
 * end up offering. That matters: because the offer is capped at whatever still
 * leaves £8,000 of profit, banding on the offer would make every property that
 * reached the cap report exactly £8,000 and therefore read QUALIFIED. Banding
 * on the ask is the actual screening question — "can we meet what they want
 * and still make money?" — and it is what makes the gap and the shortfall in
 * the CRM meaningful.
 */
export function assessGuaranteedRent(input: GuaranteedRentInput): GuaranteedRentAssessment {
  const fixed = fixedCostsAnnual(input.bedrooms);
  const confidence = input.confidence ?? 'low';
  const desiredRentIsEstimate = input.desiredRentIsEstimate ?? false;
  const grossStrIsEstimate = input.grossStrIsEstimate ?? false;

  const base = {
    confidence,
    bedroomsUsed: fixed.bedroomsUsed,
    bedroomsAssumed: fixed.assumedDefault,
    desiredRentIsEstimate,
    grossStrIsEstimate,
    fixedCostsAnnual: fixed.amount,
  };

  const hasGross = isUsableAmount(input.grossStrAnnual);
  const hasRent = isUsableAmount(input.desiredRentMonthly);

  if (!hasGross || !hasRent) {
    const missing = !hasGross && !hasRent
      ? 'short-let revenue and desired rent'
      : !hasGross
        ? 'short-let revenue'
        : 'desired rent';
    return {
      ...base,
      band: 'INSUFFICIENT_DATA',
      reason: `Not banded — ${missing} could not be established for this property.`,
      desiredRentMonthly: hasRent ? Math.round(input.desiredRentMonthly as number) : null,
      annualRent: null,
      grossStrAnnual: hasGross ? Math.round(input.grossStrAnnual as number) : null,
      strNetAnnual: null,
      annualProfit: null,
      monthlyProfit: null,
      requiredGrossAnnual: null,
      gapAnnual: null,
      revenueMultiple: null,
      maxAffordableRentMonthly: null,
      offerRentMonthly: null,
      offerMeetsAsk: false,
      hasOffer: false,
    };
  }

  // Round the money to whole pounds BEFORE banding, so the band always agrees
  // with the figures printed alongside it. A report that shows £7,999 profit
  // and calls it QUALIFIED is worse than a pound of imprecision.
  const desiredRentMonthly = Math.round(input.desiredRentMonthly as number);
  const grossStrAnnual = Math.round(input.grossStrAnnual as number);

  const annualRent = desiredRentMonthly * 12;
  const strNetAnnual = Math.round(grossStrAnnual * TRUE_NET_PCT);
  const annualProfit = strNetAnnual - annualRent - fixed.amount;
  const requiredGrossAnnual = Math.round(
    (annualRent + fixed.amount + TARGET_ANNUAL_PROFIT) / TRUE_NET_PCT,
  );
  const gapAnnual = grossStrAnnual - requiredGrossAnnual;
  const revenueMultiple = Math.round((grossStrAnnual / annualRent) * 100) / 100;

  // Floor rather than round: rounding up could commit us to a rent we cannot
  // actually cover, and being a pound under target is cheaper than being over.
  const maxAffordableRentMonthly = Math.floor(
    (strNetAnnual - fixed.amount - TARGET_ANNUAL_PROFIT) / 12,
  );
  const hasOffer = maxAffordableRentMonthly > 0;
  const offerRentMonthly = hasOffer
    ? Math.min(desiredRentMonthly, maxAffordableRentMonthly)
    : 0;
  const offerMeetsAsk = hasOffer && offerRentMonthly >= desiredRentMonthly;

  const band: GuaranteedRentBand =
    annualProfit >= TARGET_ANNUAL_PROFIT
      ? 'QUALIFIED'
      : annualProfit >= MEDIUM_BAND_FLOOR
        ? 'MEDIUM'
        : 'UNQUALIFIED';

  return {
    ...base,
    band,
    reason: buildReason(band, {
      annualProfit,
      gapAnnual,
      offerMeetsAsk,
      hasOffer,
      offerRentMonthly,
      desiredRentMonthly,
      bedroomsAssumed: fixed.assumedDefault,
      desiredRentIsEstimate,
      grossStrIsEstimate,
    }),
    desiredRentMonthly,
    annualRent,
    grossStrAnnual,
    strNetAnnual,
    annualProfit,
    monthlyProfit: Math.round(annualProfit / 12),
    requiredGrossAnnual,
    gapAnnual,
    revenueMultiple,
    maxAffordableRentMonthly,
    offerRentMonthly,
    offerMeetsAsk,
    hasOffer,
  };
}

interface ReasonContext {
  annualProfit: number;
  gapAnnual: number;
  offerMeetsAsk: boolean;
  hasOffer: boolean;
  offerRentMonthly: number;
  desiredRentMonthly: number;
  bedroomsAssumed: boolean;
  desiredRentIsEstimate: boolean;
  grossStrIsEstimate: boolean;
}

function gbp(amount: number): string {
  const rounded = Math.round(Math.abs(amount));
  return `${amount < 0 ? '-' : ''}£${rounded.toLocaleString('en-GB')}`;
}

function buildReason(band: GuaranteedRentBand, ctx: ReasonContext): string {
  const caveats: string[] = [];
  if (ctx.bedroomsAssumed) caveats.push('bedrooms unknown, 4-bed costs assumed');
  if (ctx.desiredRentIsEstimate) caveats.push('rent estimated');
  if (ctx.grossStrIsEstimate) caveats.push('revenue estimated');
  const suffix = caveats.length ? ` (${caveats.join('; ')})` : '';

  let head: string;
  if (band === 'QUALIFIED') {
    head = `Clears target at the asking rent — ${gbp(ctx.annualProfit)}/yr profit, ${gbp(ctx.gapAnnual)} above the revenue needed.`;
  } else if (ctx.offerMeetsAsk) {
    head = `${gbp(ctx.annualProfit)}/yr profit at the asking rent — below the ${gbp(TARGET_ANNUAL_PROFIT)} target but the ask is still coverable.`;
  } else if (ctx.hasOffer) {
    head = `${gbp(ctx.annualProfit)}/yr profit at the asking rent — needs ${gbp(Math.abs(ctx.gapAnnual))} more revenue, so the offer caps at ${gbp(ctx.offerRentMonthly)}/mo against an ask of ${gbp(ctx.desiredRentMonthly)}/mo.`;
  } else {
    head = `No viable offer — short-let income does not cover the fixed costs and target profit, let alone rent.`;
  }
  return `${head}${suffix}`;
}
