/**
 * Number, money and date formatting for the report.
 *
 * Kept free of JSX so it can be unit-tested — the test runner's glob is
 * `src/**\/*.test.ts` and its resolver doesn't handle `.tsx`.
 */

export const formatGbp = (value: number): string =>
  `£${Math.round(value).toLocaleString("en-GB")}`;

/** "+£9,246" / "−£412". Uses U+2212 for the minus, which both report fonts cover. */
export const formatGbpSigned = (value: number): string => {
  const abs = Math.abs(Math.round(value)).toLocaleString("en-GB");
  const sign = value >= 0 ? "+" : "−";
  return `${sign}£${abs}`;
};

/** Cost rows print as a deduction: "−£5,138". */
export const formatGbpNegative = (value: number): string =>
  `−£${Math.abs(Math.round(value)).toLocaleString("en-GB")}`;

/** Fraction (0–1) to a whole percentage. */
export const formatPercent = (value: number): string =>
  `${Math.round(value * 100)}%`;

/** Already-whole percentage, e.g. a 15 cost rate. */
export const formatRate = (rate: number): string => `${Math.round(rate * 100)}%`;

/**
 * Guest rating to one decimal. No star — neither report font carries U+2605,
 * and the design prints the bare number.
 */
export const formatRating = (value: number): string =>
  value > 0 ? value.toFixed(1) : "—";

/** Compact money for a chart axis: £0, £0.5k, £1k, £2k. */
export const formatAxisMoney = (value: number): string => {
  if (value === 0) return "£0";
  if (Math.abs(value) < 1000) return `£${Math.round(value)}`;
  const k = value / 1000;
  return `£${Number.isInteger(k) ? k : k.toFixed(1)}k`;
};

const MONTHS_UPPER = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
] as const;

/** "18 SEP 2026" for the page-01 issue line. */
export const formatIssueDate = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getUTCDate()).padStart(2, "0")} ${MONTHS_UPPER[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

/** "18.09.2026" for the footer. */
export const formatIssueDateNumeric = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.${d.getUTCFullYear()}`;
};

/**
 * Hard-clamp a string to `max` characters with an ellipsis.
 *
 * react-pdf will happily overflow a fixed-width cell, and hyphenation is
 * disabled for the report, so long listing titles and supplier names are cut
 * here rather than at layout time.
 */
export const clamp = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1)).trimEnd()}…`;

/** "≈4 months" / "≈1 month". */
export const formatPaybackMonths = (months: number): string =>
  `≈${months} ${months === 1 ? "month" : "months"}`;
