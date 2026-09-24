// ─── Analysis input normalisation ─────────────────────────────────
//
// Turns a raw request body (the public form) or a spreadsheet row (bulk
// upload) into the one validated shape the pipeline runs on.
//
// This lives here rather than in the route so that a bulk row and a form
// submission are mapped IDENTICALLY — same property-type mapping, same parking
// and outdoor-space codes, same finish quality, same bounds. If this logic were
// duplicated, "bulk runs exactly the same process" would quietly stop being
// true the first time either copy changed.
//
// Extracted verbatim from src/app/api/analyse/route.ts (the enum maps at lines
// 133-167 and 207-217, and the validation at 169-204). The validation ORDER and
// the exact error strings are preserved, because the route returns them to the
// browser as 400 responses.

import type { PropertyInput } from '../types.ts';

/** Everything the pipeline needs, already validated and mapped. */
export interface NormalisedInput {
  property: PropertyInput;
  email: string | null;
  /** Only supplied by bulk; used as an extra Monday matching signal. */
  phone: string | null;
  mappedPropertyType: string;
  validBathrooms: number | undefined;
  parkingValue: number;
  validHasParking: boolean;
  validOutdoorSpace: string;
  validFinishQuality: 'average';
  validSpecialFeatures: string[];
  longLetMonthlyInput: number;
  hasLongLetMonthly: boolean;
  /**
   * The monthly rent the landlord wants guaranteed, in GBP, or null when they
   * did not give one (a bulk row with the column blank). The guaranteed-rent
   * model falls back to an estimate in that case, or reports insufficient data.
   */
  desiredRentMonthly: number | null;
}

export type NormaliseResult =
  | { ok: true; input: NormalisedInput }
  | { ok: false; error: string };

// Parking: map user selection to API numeric value
const PARKING_MAP: Record<string, number> = {
  'no_parking': 0,
  'on_street': 0,
  'allocated': 1,
  'garage': 1,
  'driveway_1': 1,
  'driveway_2': 2,
};

// Outdoor space: map to PropertyData format
const OUTDOOR_MAP: Record<string, string> = {
  'none': 'none',
  'balcony': 'balcony_terrace',
  'garden': 'garden',
  'roof_terrace': 'balcony_terrace',
};

// Map property type to PropertyData format
const PROPERTY_TYPE_MAP: Record<string, string> = {
  'Flat': 'flat',
  'Terraced': 'terraced_house',
  'Semi-detached': 'semi-detached_house',
  'Detached': 'detached_house',
  // Legacy values (backwards compat)
  'Terraced House': 'terraced_house',
  'Semi-Detached House': 'semi-detached_house',
  'Detached House': 'detached_house',
};

/**
 * The guest count the public form derives from the bedroom count
 * (src/app/page.tsx), clamped into the range the pipeline accepts.
 *
 * The form's own bedrooms input caps at 5 so it never overflows, but a
 * spreadsheet can carry any number: 8 bedrooms would compute 18 guests and be
 * rejected by validation below. Clamping keeps such a row runnable.
 */
export function defaultGuests(bedrooms: number): number {
  const derived = bedrooms * 2 + 2;
  return Math.min(16, Math.max(1, derived));
}

export interface NormaliseOptions {
  /**
   * Reject a submission that carries no desired rent.
   *
   * The public form sets this: the guaranteed-rent offer is the whole point of
   * the page, and it cannot be made without a rent to price against. Bulk rows
   * and /api/internal/analyse leave it false, because a blank spreadsheet cell
   * should fall back to an estimate rather than kill the row.
   *
   * The VALUE is validated identically either way — only whether absence is
   * fatal differs, so a bulk row and a form submission still map the same.
   */
  requireDesiredRent?: boolean;
}

export function normaliseAnalysisInput(
  body: Record<string, unknown>,
  options: NormaliseOptions = {},
): NormaliseResult {
  const {
    address, postcode, email, phone, bedrooms, guests, bathrooms, parking,
    outdoorSpace, propertyType, longLetMonthly, longLetNotSure, desiredRentMonthly,
  } = body as {
    address: unknown; postcode: unknown; email: unknown; phone: unknown;
    bedrooms: unknown; guests: unknown;
    bathrooms: unknown; parking: unknown; outdoorSpace: unknown;
    propertyType: unknown;
    longLetMonthly: unknown; longLetNotSure: unknown;
    desiredRentMonthly: unknown;
  };

  const emailStr = typeof email === 'string' && email.includes('@') ? email.trim() : null;
  const phoneStr = typeof phone === 'string' && phone.trim() ? phone.trim() : null;

  // Long-let monthly rent the landlord entered (GBP). "Not sure" → undefined here
  // and resolved later via estimateLongLet() / PropertyData fallback.
  const longLetMonthlyInput = Number(longLetMonthly);
  const hasLongLetMonthly = !longLetNotSure && Number.isFinite(longLetMonthlyInput) && longLetMonthlyInput > 0;

  const bathroomCount = Number(bathrooms);
  const validBathrooms = Number.isFinite(bathroomCount) && bathroomCount >= 1 ? bathroomCount : undefined;

  const validParking = typeof parking === 'string' && parking in PARKING_MAP ? parking : 'no_parking';
  const parkingValue = PARKING_MAP[validParking] ?? 0;
  const validHasParking = validParking !== 'no_parking' && validParking !== 'on_street';

  const validOutdoorSpace = typeof outdoorSpace === 'string' && outdoorSpace in OUTDOOR_MAP
    ? OUTDOOR_MAP[outdoorSpace]
    : 'none';

  // Changed from 'very_high' to 'average' — hardcoded 1.38x condition multiplier
  // was inflating every property estimate by 38% regardless of actual finish quality.
  // PMI applies no quality multiplier to the headline figure.
  const validFinishQuality = 'average' as const;
  const validSpecialFeatures: string[] = [];

  // ── Validation. Order and wording must match what the route returns. ──
  if (!address || typeof address !== 'string' || (address as string).trim().length === 0) {
    return { ok: false, error: 'A valid property address is required.' };
  }

  if (!postcode || typeof postcode !== 'string' || (postcode as string).trim().length < 3) {
    return { ok: false, error: 'A valid UK postcode is required.' };
  }

  const bedroomCount = Number(bedrooms);
  if (!Number.isFinite(bedroomCount) || bedroomCount < 0 || bedroomCount > 10) {
    return { ok: false, error: 'Bedrooms must be a number between 0 and 10.' };
  }

  const guestCount = Number(guests);
  if (!Number.isFinite(guestCount) || guestCount < 1 || guestCount > 16) {
    return { ok: false, error: 'Guests must be a number between 1 and 16.' };
  }

  // Desired rent: absent is allowed unless the caller says otherwise, but a
  // value that IS present must be usable — a zero or a negative would silently
  // produce a nonsense offer.
  const desiredRentSupplied =
    desiredRentMonthly !== undefined && desiredRentMonthly !== null && desiredRentMonthly !== '';
  const desiredRentValue = Number(desiredRentMonthly);
  if (desiredRentSupplied && (!Number.isFinite(desiredRentValue) || desiredRentValue <= 0)) {
    return { ok: false, error: 'Desired monthly rent must be a number greater than 0.' };
  }
  if (!desiredRentSupplied && options.requireDesiredRent) {
    return { ok: false, error: 'Desired monthly rent is required.' };
  }
  const validDesiredRent = desiredRentSupplied ? desiredRentValue : null;

  const property: PropertyInput = {
    address: (address as string).trim(),
    postcode: (postcode as string).trim().toUpperCase(),
    bedrooms: bedroomCount,
    guests: guestCount,
    desiredRentMonthly: validDesiredRent,
  };

  const mappedPropertyType = propertyType ? PROPERTY_TYPE_MAP[propertyType as string] ?? 'flat' : 'flat';

  return {
    ok: true,
    input: {
      property,
      email: emailStr,
      phone: phoneStr,
      mappedPropertyType,
      validBathrooms,
      parkingValue,
      validHasParking,
      validOutdoorSpace,
      validFinishQuality,
      validSpecialFeatures,
      longLetMonthlyInput,
      hasLongLetMonthly,
      desiredRentMonthly: validDesiredRent,
    },
  };
}
