import type {
  AnalysisResult,
  RecommendationDecision,
  RiskLevel,
  ShortLetComparable,
} from "@/lib/types";
import { PDF_COST_RATES } from "./theme";
// Pure data + pricing logic (no JSX, no "use client") — safe on the server.
import { buildDefaultLineItems } from "@/components/SetupCalculator/lineItemDefaults";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/** Axis labels for the page-02 forecast chart. */
const MONTH_SHORT = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
] as const;

/**
 * The comparables table is designed to hold 12 rows on one page. The search in
 * `airbtics.ts` targets 12 but can return more, so cap it and say so rather
 * than silently spilling onto a seventh page.
 */
export const MAX_COMPARABLE_ROWS = 12;

export interface PdfMonth {
  month: string;
  /** Three-letter uppercase label for the chart axis. */
  short: string;
  net: number;
  vsLtl: number;
  occupancy: number;
  peak: boolean;
}

export interface PdfComparable {
  name: string;
  distance: string;
  nightly: number;
  occupancy: number;
  annual: number;
  rating: number;
  top: boolean;
}

export interface PdfDemandDriver {
  type: string;
  nearest: string;
  distance: string;
  count: string;
  impact: "HIGH" | "MEDIUM" | "LOW";
}

export interface PdfSetupLineItem {
  id: string;
  name: string;
  supplier: string;
  qty: number;
  unitCost: number;
  total: number;
}

export interface PdfSetupCategory {
  category: string;
  items: PdfSetupLineItem[];
  subtotal: number;
}

export interface PdfSetupSnapshot {
  furnishingLabel: string;
  bedrooms: number;
  itemCount: number;
  grandTotal: number;
  categories: PdfSetupCategory[];
  /**
   * True when the figures are Stayful's typical-property defaults because the
   * lead never filled in the setup calculator. Drives the "indicative
   * estimate" callout on page 05.
   */
  indicative: boolean;
}

/** An amenity and its 0–5 importance, rendered as a dot meter. */
export interface PdfAmenity {
  name: string;
  score: number;
}

/** Report-level metadata for the page headers and footers. */
export interface PdfMeta {
  /** ISO date the analysis was produced. */
  issuedAt: string;
  /** Lead email, shown as "PREPARED FOR [...]". Absent on internal renders. */
  preparedFor?: string;
  /** Address without the town, e.g. "22 Princess Road West". */
  street: string;
  /** Town/city for the running header. Empty when it can't be determined. */
  city: string;
}

export interface PdfReportData {
  meta: PdfMeta;
  property: { address: string; bedrooms: number; sleeps: number };
  overview: {
    grossRevenue: number;
    netRevenue: number;
    grossMonthly: number;
    netMonthly: number;
    adr: number;
    occupancy: number;
    marketOccupancy: number;
    valueConservative: number | null;
    valueUpper: number | null;
  };
  strVsLtl: {
    annualDiff: number;
    monthlyDiff: number;
    percentUplift: number;
  };
  shortLetAnnual: {
    gross: number;
    platformFee: number;
    managementFee: number;
    cleaning: number;
    totalCosts: number;
    net: number;
  };
  longLetAnnual: {
    gross: number;
    agentFee: number;
    net: number;
  };
  monthly: PdfMonth[];
  comparables: PdfComparable[];
  /** Total comps found, which may exceed the rows in `comparables`. */
  comparablesTotal: number;
  compsBenchmark: {
    avgNightly: number;
    avgOccupancy: number;
    avgAnnual: number;
    avgRating: number;
    avgReviews: number;
    count: number;
    radiusKm: number;
  };
  marketTargets: {
    matchNightly: number;
    matchOccupancy: number;
    matchRevenue: number;
    beatNightly: number;
    beatOccupancy: number;
    beatRevenue: number;
  };
  demandDrivers: PdfDemandDriver[];
  directBookingScore: number;
  risk: {
    overall: number;
    label: string;
    factors: {
      revenueConsistency: number;
      longTermComparison: number;
      seasonalVariance: number;
      marketDemand: number;
    };
  };
  amenities: {
    essential: PdfAmenity[];
    competitiveEdge: PdfAmenity[];
    differentiators: string[];
  };
  growth: {
    directBookingPctMonth36: number;
    repeatCustomers: number;
    platformFeeSavingsPct: number;
    extraMonthlyProfitYr3: number;
  };
  setup?: PdfSetupSnapshot;
  /**
   * Whole months for the setup cost to pay for itself out of the extra income
   * over a long-let. Null when the short-let isn't ahead, so the pages hide the
   * payback line instead of printing Infinity.
   */
  setupPaybackMonths: number | null;
  /** Short-let vs long-let verdict. Undefined when it could not be computed. */
  recommendation?: RecommendationDecision;
}

/**
 * Split a free-text address into street and town for the running header.
 *
 * Google-backed autocomplete gives "17 Park Crescent, York" (the postcode is
 * stored separately), so the last comma segment is the town. Manual entry and
 * bulk upload often give no town at all — fall back to the postcode's outward
 * code, then to nothing. An empty city is a legitimate outcome; the header
 * drops the separator rather than printing a dangling one.
 */
export function splitStreetAndCity(
  address: string,
  postcode?: string,
): { street: string; city: string } {
  const trimmed = (address ?? "").trim();
  const parts = trimmed.split(",").map((p) => p.trim()).filter(Boolean);

  if (parts.length >= 2) {
    const city = parts[parts.length - 1];
    // A trailing segment that is just a postcode isn't a town.
    if (!/^[A-Z]{1,2}\d{1,2}[A-Z]?(\s*\d[A-Z]{2})?$/i.test(city)) {
      return { street: parts.slice(0, -1).join(", "), city };
    }
    return { street: parts.slice(0, -1).join(", "), city: outwardCode(postcode) };
  }

  return { street: trimmed, city: outwardCode(postcode) };
}

/** "M4 7FE" -> "M4". Empty string when there's nothing usable. */
function outwardCode(postcode?: string): string {
  const m = (postcode ?? "").trim().match(/^([A-Z]{1,2}\d{1,2}[A-Z]?)/i);
  return m ? m[1].toUpperCase() : "";
}

/**
 * Whole months for the setup investment to be repaid out of the extra monthly
 * income over a long-let. Null when the short-let isn't ahead (or there's no
 * setup cost), which is the long-let-recommended case.
 *
 * Rounded to nearest, not up: the report presents this as "≈N months" against
 * figures it already labels indicative, so £3,110 over £771 a month reads as
 * 4 months rather than 5.
 */
export function computePaybackMonths(
  setupTotal: number | undefined,
  monthlyDiff: number,
): number | null {
  if (!setupTotal || setupTotal <= 0) return null;
  if (!Number.isFinite(monthlyDiff) || monthlyDiff <= 0) return null;
  return Math.max(1, Math.round(setupTotal / monthlyDiff));
}

/**
 * Converts the raw calculator snapshot (active line items + category groups)
 * into the shape the PDF page renders. Returns null if there's nothing to
 * include (zero items or grandTotal === 0).
 */
export function buildSetupSnapshot(raw: {
  furnishing: "fully" | "part" | "unfurnished";
  bedrooms: number;
  indicative?: boolean;
  items: Array<{
    id: string;
    name: string;
    category: string;
    supplier: string;
    qty: number;
    unitCost: number;
    active: boolean;
  }>;
}): PdfSetupSnapshot | null {
  const FURNISHING_LABELS: Record<string, string> = {
    fully: "Fully Furnished",
    part: "Part Furnished",
    unfurnished: "Unfurnished",
  };
  const active = raw.items.filter((i) => i.active && i.qty > 0 && i.unitCost > 0);
  if (active.length === 0) return null;

  const groups = new Map<string, PdfSetupLineItem[]>();
  for (const it of active) {
    const arr = groups.get(it.category) ?? [];
    arr.push({
      id: it.id,
      name: it.name,
      supplier: it.supplier,
      qty: it.qty,
      unitCost: it.unitCost,
      total: Math.round(it.qty * it.unitCost),
    });
    groups.set(it.category, arr);
  }

  // Biggest spend first, so the stacked bar reads left-to-right in descending
  // order and the table follows the same order as its legend.
  const categories: PdfSetupCategory[] = Array.from(groups.entries())
    .map(([category, items]) => ({
      category,
      items,
      subtotal: items.reduce((s, i) => s + i.total, 0),
    }))
    .sort((a, b) => b.subtotal - a.subtotal);

  const grandTotal = categories.reduce((s, c) => s + c.subtotal, 0);
  return {
    furnishingLabel: FURNISHING_LABELS[raw.furnishing] ?? raw.furnishing,
    bedrooms: raw.bedrooms,
    itemCount: active.length,
    grandTotal,
    categories,
    indicative: raw.indicative ?? false,
  };
}

/** The raw setup-calculator snapshot the browser posts alongside an analysis. */
export interface RawSetupInput {
  furnishing: "fully" | "part" | "unfurnished";
  bedrooms: number;
  items: Array<{
    id: string;
    name: string;
    category: string;
    supplier: string;
    qty: number;
    unitCost: number;
    active: boolean;
  }>;
}

/**
 * Setup costs for a typical property of this size, used when the lead never
 * opened the setup calculator.
 *
 * The report always carries a setup-costs page, so the page count (and the
 * "NN / 06" footers) stay the same whether the figures came from the lead or
 * from these defaults. The page flags itself as indicative when they did.
 */
export function buildIndicativeSetupSnapshot(bedrooms: number): PdfSetupSnapshot | null {
  const safeBedrooms = Math.max(1, Math.floor(bedrooms || 1));
  return buildSetupSnapshot({
    furnishing: "fully",
    bedrooms: safeBedrooms,
    indicative: true,
    items: buildDefaultLineItems("fully", safeBedrooms),
  });
}

/**
 * Attach setup costs and the derived payback to a report, falling back to
 * typical-property defaults when the lead gave us nothing.
 *
 * Every render path goes through this so the browser download, the
 * Monday-uploaded copy and the internal API all produce the same document.
 */
export function attachSetupCosts(
  data: PdfReportData,
  raw?: RawSetupInput | null,
): PdfReportData {
  const fromLead = raw ? buildSetupSnapshot(raw) : null;
  const setup = fromLead ?? buildIndicativeSetupSnapshot(data.property.bedrooms);
  return {
    ...data,
    setup: setup ?? undefined,
    setupPaybackMonths: computePaybackMonths(setup?.grandTotal, data.strVsLtl.monthlyDiff),
  };
}

/**
 * The page-05 table holds this many rows (item rows plus one heading row per
 * category) before it would push onto a seventh page. A lead who picked
 * "unfurnished", or added their own items, can easily exceed it.
 */
export const MAX_SETUP_ROWS = 16;

/** One rendered line of the setup table. */
export type SetupRow =
  | { kind: "category"; category: string; subtotal: number }
  | { kind: "item"; item: PdfSetupLineItem }
  | { kind: "overflow"; count: number; total: number };

/**
 * Lay the setup table out within a fixed row budget.
 *
 * Categories are never split across a heading — if a category's items won't
 * fit, its remaining items collapse into a single "+N more" line carrying
 * their combined total, so the printed rows still add up to the grand total
 * and the report stays exactly six pages.
 */
export function planSetupRows(
  categories: PdfSetupCategory[],
  maxRows: number = MAX_SETUP_ROWS,
): SetupRow[] {
  const rows: SetupRow[] = [];
  let used = 0;
  let hiddenCount = 0;
  let hiddenTotal = 0;

  for (const cat of categories) {
    // A category needs its heading plus at least one item to be worth showing.
    const remaining = maxRows - used;
    if (remaining < 2) {
      hiddenCount += cat.items.length;
      hiddenTotal += cat.subtotal;
      continue;
    }

    rows.push({ kind: "category", category: cat.category, subtotal: cat.subtotal });
    used += 1;

    // Keep one row spare for the overflow line if anything will be hidden.
    const laterItems = categories
      .slice(categories.indexOf(cat) + 1)
      .reduce((n, c) => n + c.items.length + 1, 0);
    const reserve = laterItems > 0 || hiddenCount > 0 ? 1 : 0;
    const roomForItems = Math.max(0, maxRows - used - reserve);

    const shown = cat.items.slice(0, roomForItems);
    for (const item of shown) {
      rows.push({ kind: "item", item });
      used += 1;
    }

    const hidden = cat.items.slice(shown.length);
    hiddenCount += hidden.length;
    hiddenTotal += hidden.reduce((n, i) => n + i.total, 0);
  }

  if (hiddenCount > 0) {
    rows.push({ kind: "overflow", count: hiddenCount, total: hiddenTotal });
  }
  return rows;
}

function riskLevelToScore(level: RiskLevel): number {
  if (level === "low") return 25;
  if (level === "moderate") return 50;
  return 75;
}

/** Thresholds are on a 0–100 scale — see `RISK_SCORE_SCALE`. */
function overallRiskLabel(score: number): string {
  if (score <= 25) return "Low risk";
  if (score <= 50) return "Low-medium risk";
  if (score <= 75) return "Medium-high risk";
  return "High risk";
}

/**
 * `assessRisk` in analysis.ts returns `overallScore` clamped to 1–10, but this
 * report prints it out of 100 (and draws it on a 0–100 gauge). Without this
 * factor every property scored <= 2.5 and read "Low Risk" regardless.
 */
export const RISK_SCORE_SCALE = 10;

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[idx];
}

function topRevenueThreshold(comps: ShortLetComparable[]): number {
  if (comps.length === 0) return Infinity;
  const sorted = [...comps].map((c) => c.annualRevenue).sort((a, b) => a - b);
  return percentile(sorted, 0.75);
}

function formatDistance(km: number | undefined): string {
  if (km === undefined || Number.isNaN(km)) return "—";
  return `${km.toFixed(2)} km`;
}

function directBookingScoreFromSignals(result: AnalysisResult): number {
  const d = result.demandDrivers;
  const events = result.nearbyEvents?.totalEvents ?? 0;
  const raw =
    (d.hospitals?.length ?? 0) * 10 +
    (d.universities?.length ?? 0) * 15 +
    (d.trainStations?.length ?? 0) * 10 +
    (d.subwayStations?.length ?? 0) * 5 +
    (events >= 200 ? 40 : events / 5);
  return Math.max(0, Math.min(100, Math.round(raw)));
}

/**
 * @param preparedFor Lead email for the page-01 "PREPARED FOR" line. Omitted
 *   on internal renders, where no lead is attached.
 */
export function deriveReportData(result: AnalysisResult, preparedFor?: string): PdfReportData {
  const { property, shortLet, financials, risk, demandDrivers, nearbyEvents, propertyValuation, dataQuality } = result;

  // ── Overview ──
  const grossAnnual = financials.shortLetGrossAnnual;
  const netAnnual = financials.shortLetNetAnnual;
  const netRatio = grossAnnual > 0 ? netAnnual / grossAnnual : 0.52;
  const ltlGross = financials.longLetGrossAnnual;
  const ltlNet = financials.longLetNetAnnual;

  // ── Monthly forecast (derived from gross monthlyRevenue + occupancy from scenarios if present) ──
  const scenarioBase = shortLet.scenarios?.base?.monthly;
  const ltlNetMonthly = ltlNet / 12;

  const monthlyNet: number[] = shortLet.monthlyRevenue.map((gross) => Math.round(gross * netRatio));
  const peakThreshold = [...monthlyNet].sort((a, b) => b - a)[2] ?? 0; // top-3 cut-off

  const monthly: PdfMonth[] = shortLet.monthlyRevenue.map((_, i) => {
    const net = monthlyNet[i];
    const occ = scenarioBase?.[i]?.occupancy ?? shortLet.occupancyRate;
    return {
      month: MONTH_NAMES[i],
      short: MONTH_SHORT[i],
      net,
      vsLtl: Math.round(net - ltlNetMonthly),
      occupancy: Math.max(0, Math.min(1, occ)),
      peak: net >= peakThreshold,
    };
  });

  // ── Comparables ──
  // Thresholds and benchmarks are computed across every comp found; only the
  // printed table is capped, nearest first, so the market figures stay honest.
  const topThreshold = topRevenueThreshold(shortLet.comparables);
  const comparables: PdfComparable[] = [...shortLet.comparables]
    .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity))
    .slice(0, MAX_COMPARABLE_ROWS)
    .map((c) => ({
      name: c.title,
      distance: formatDistance(c.distance),
      nightly: Math.round(c.averageDailyRate),
      occupancy: c.occupancyRate,
      annual: Math.round(c.annualRevenue),
      rating: c.rating,
      top: c.annualRevenue >= topThreshold,
    }));

  // ── Benchmark (mean of comps) ──
  const nightlyValues = shortLet.comparables.map((c) => c.averageDailyRate);
  const occValues = shortLet.comparables.map((c) => c.occupancyRate);
  const annualValues = shortLet.comparables.map((c) => c.annualRevenue);
  const ratingValues = shortLet.comparables.map((c) => c.rating).filter((r) => r > 0);
  const reviewValues = shortLet.comparables.map((c) => c.reviewCount).filter((n) => n > 0);

  const compsBenchmark = {
    avgNightly: Math.round(mean(nightlyValues)),
    avgOccupancy: mean(occValues),
    avgAnnual: Math.round(mean(annualValues)),
    avgRating: Number(mean(ratingValues).toFixed(1)),
    avgReviews: Math.round(mean(reviewValues)),
    count: shortLet.comparables.length,
    radiusKm: dataQuality.searchRadiusKm,
  };

  // ── Match vs Beat market targets ──
  // Match = benchmark mean. Beat = 75th percentile of each signal.
  const sortedNightly = [...nightlyValues].sort((a, b) => a - b);
  const sortedOcc = [...occValues].sort((a, b) => a - b);
  const sortedAnnual = [...annualValues].sort((a, b) => a - b);

  const beatNightly = Math.round(percentile(sortedNightly, 0.75)) || compsBenchmark.avgNightly;
  const beatOccupancy = percentile(sortedOcc, 0.75) || compsBenchmark.avgOccupancy;
  const beatRevenue = Math.round(percentile(sortedAnnual, 0.75)) || compsBenchmark.avgAnnual;

  // ── Demand drivers ──
  // Emitted in the order the design lays the four cards out, left to right:
  // Transport, Events, Education, Healthcare. Cards flex, so a property with
  // fewer signals simply shows fewer.
  const drivers: PdfDemandDriver[] = [];
  const transport = [...demandDrivers.trainStations, ...demandDrivers.subwayStations, ...demandDrivers.airports]
    .sort((a, b) => (a.distance ?? 999) - (b.distance ?? 999));
  if (transport.length > 0) {
    drivers.push({
      type: "Transport",
      nearest: transport[0].name,
      distance: formatDistance(transport[0].distance),
      count: `${transport.length} ${transport.length === 1 ? "link" : "links"}`,
      impact: "HIGH",
    });
  }
  if (nearbyEvents.totalEvents > 0) {
    const nearest = nearbyEvents.events[0];
    drivers.push({
      type: "Events",
      nearest: nearest?.venue ?? "Local venues",
      distance: nearest?.distance !== null && nearest?.distance !== undefined ? formatDistance(nearest.distance) : "—",
      count: `${nearbyEvents.totalEvents.toLocaleString()} events`,
      impact: nearbyEvents.totalEvents >= 100 ? "HIGH" : "MEDIUM",
    });
  }
  if (demandDrivers.universities.length > 0) {
    drivers.push({
      type: "Education",
      nearest: demandDrivers.universities[0].name,
      distance: formatDistance(demandDrivers.universities[0].distance),
      count: `${demandDrivers.universities.length} ${demandDrivers.universities.length === 1 ? "institution" : "institutions"}`,
      impact: "HIGH",
    });
  }
  if (demandDrivers.hospitals.length > 0) {
    drivers.push({
      type: "Healthcare",
      nearest: demandDrivers.hospitals[0].name,
      distance: formatDistance(demandDrivers.hospitals[0].distance),
      count: `${demandDrivers.hospitals.length} ${demandDrivers.hospitals.length === 1 ? "facility" : "facilities"}`,
      impact: "HIGH",
    });
  }

  // ── Direct booking score ──
  const directBookingScore = directBookingScoreFromSignals(result);

  // ── Risk ──
  // `overallScore` arrives on a 1–10 scale; the report prints it out of 100.
  const riskOverall = Math.max(0, Math.min(100, Math.round(risk.overallScore * RISK_SCORE_SCALE)));

  // Map 8 levels → the 4 numeric factors the report shows.
  const riskFactors = {
    revenueConsistency: riskLevelToScore(risk.incomeVolatility),
    longTermComparison: riskLevelToScore(risk.platformDependency),
    seasonalVariance: riskLevelToScore(risk.seasonality),
    marketDemand: riskLevelToScore(risk.locationDemand),
  };

  // ── Amenities (Stayful defaults; future: compute from comps) ──
  // Scores are out of 5 and render as dot meters, so they stay numeric rather
  // than being baked into the label.
  const amenities = {
    essential: [
      { name: "WiFi", score: 5 },
      { name: "Kitchen", score: 5 },
    ],
    competitiveEdge: [
      { name: "Garden", score: 3 },
      { name: "Workspace", score: 2 },
      { name: "Free parking", score: 1 },
      { name: "Smart TV", score: 1 },
    ],
    differentiators: ["Hot Tub", "EV Charger", "Pet Friendly", "Smart Lock", "Pool"],
  };

  // ── Growth (Stayful business defaults) ──
  const growth = {
    directBookingPctMonth36: 50,
    repeatCustomers: 126,
    platformFeeSavingsPct: 15,
    extraMonthlyProfitYr3: Math.round((netAnnual / 12) * 0.15 * 0.80),
  };

  const annualDiff = netAnnual - ltlNet;
  const monthlyDiff = Math.round(annualDiff / 12);
  const percentUplift = ltlNet > 0 ? Math.round((annualDiff / ltlNet) * 100) : 0;

  const { street, city } = splitStreetAndCity(property.address, property.postcode);

  return {
    meta: {
      issuedAt: result.createdAt || new Date().toISOString(),
      preparedFor: preparedFor?.trim() || undefined,
      street,
      city,
    },
    property: {
      address: property.address,
      bedrooms: property.bedrooms,
      sleeps: property.guests,
    },
    overview: {
      grossRevenue: grossAnnual,
      netRevenue: netAnnual,
      grossMonthly: Math.round(grossAnnual / 12),
      netMonthly: Math.round(netAnnual / 12),
      adr: Math.round(shortLet.averageDailyRate),
      occupancy: shortLet.occupancyRate,
      marketOccupancy: compsBenchmark.avgOccupancy,
      valueConservative: propertyValuation?.valuationRangeLow ?? null,
      valueUpper: propertyValuation?.valuationRangeHigh ?? null,
    },
    strVsLtl: {
      annualDiff,
      monthlyDiff,
      percentUplift,
    },
    shortLetAnnual: {
      gross: grossAnnual,
      platformFee: Math.round(grossAnnual * PDF_COST_RATES.PLATFORM),
      managementFee: Math.round(grossAnnual * PDF_COST_RATES.MANAGEMENT),
      cleaning: Math.round(grossAnnual * PDF_COST_RATES.CLEANING),
      totalCosts: Math.round(grossAnnual * PDF_COST_RATES.TOTAL),
      net: netAnnual,
    },
    longLetAnnual: {
      gross: ltlGross,
      agentFee: Math.round(ltlGross * PDF_COST_RATES.LTL_AGENT),
      net: ltlNet,
    },
    monthly,
    comparables,
    comparablesTotal: shortLet.comparables.length,
    compsBenchmark,
    marketTargets: {
      matchNightly: compsBenchmark.avgNightly,
      matchOccupancy: compsBenchmark.avgOccupancy,
      matchRevenue: compsBenchmark.avgAnnual,
      beatNightly,
      beatOccupancy,
      beatRevenue,
    },
    demandDrivers: drivers,
    directBookingScore,
    risk: {
      overall: riskOverall,
      label: overallRiskLabel(riskOverall),
      factors: riskFactors,
    },
    amenities,
    growth,
    // Filled in by the caller once a setup snapshot is attached.
    setupPaybackMonths: null,
    recommendation: result.recommendation?.recommendation,
  };
}

export function sanitiseAddressForFilename(address: string): string {
  return address
    .replace(/[^a-zA-Z0-9 ,\-]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 80) || "Property";
}
