// ─── Row warnings ─────────────────────────────────────────────────
//
// Deliberately separate from ./parse.ts, which is server-only: it pulls in the
// XLSX reader and its zip machinery. The admin UI needs the labels, and
// importing them from the parser would drag all of that into the client
// bundle (and fail to build, since those modules are Node-only).

/** Machine-readable reasons a row can't run, or needs a second look. */
export type RowWarning =
  | 'missing_address'
  | 'missing_postcode'
  | 'ambiguous_postcode'
  | 'invalid_bedrooms'
  | 'bedrooms_out_of_range'
  | 'no_contact_signal'
  | 'invalid_email'
  | 'invalid_phone'
  | 'duplicate_row';

/** Warnings that make a row unrunnable. */
export const BLOCKING_WARNINGS: ReadonlySet<RowWarning> = new Set<RowWarning>([
  'missing_address',
  'missing_postcode',
  'ambiguous_postcode',
  'invalid_bedrooms',
]);

/** Human-readable text for the preview table and the results CSV. */
export const WARNING_LABELS: Record<RowWarning, string> = {
  missing_address: 'No address',
  missing_postcode: 'No postcode in the address',
  ambiguous_postcode: 'More than one postcode in the address',
  invalid_bedrooms: 'Bedrooms missing or not 0–10',
  bedrooms_out_of_range: 'Over 5 bedrooms — outside the calibrated range',
  no_contact_signal: 'No email or phone — matching by property only',
  invalid_email: 'Email looks malformed — ignored',
  invalid_phone: 'Phone not recognised as UK — ignored',
  duplicate_row: 'Same property as an earlier row',
};
