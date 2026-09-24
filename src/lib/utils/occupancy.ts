/**
 * Normalise a raw `analyser_reports.occupancy` value to a 0–100 percentage.
 *
 * The column holds occupancy in MIXED units:
 *   • the live analyser writes a 0–1 fraction (shortLet.occupancyRate), while
 *   • Monday PDF-backfill rows stored a 0–100 percentage.
 *
 * So a naive `× 100` turns a backfilled 55.6 into 5560%. This helper decides
 * per row: a value ≤ 1 is a fraction (× 100); a value > 1 is already a
 * percentage and passes through unchanged. A stored `1.0` is read as 100%
 * occupancy (a fraction), not 1% — STR occupancy is never realistically 1%,
 * whereas fully-booked 1.0 fractions do occur.
 *
 * Returns null for null/undefined/NaN so a group with no occupancy data stays
 * "no data" rather than becoming 0.
 */
export function occupancyToPercent(raw: number | null | undefined): number | null {
  if (raw === null || raw === undefined || Number.isNaN(raw)) return null;
  return raw <= 1 ? raw * 100 : raw;
}
