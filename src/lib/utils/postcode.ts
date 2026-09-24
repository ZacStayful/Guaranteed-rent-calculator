// ─── UK postcode helpers ──────────────────────────────────────────

// Matches a full UK postcode embedded anywhere in a string and captures
// the outward-code letter prefix (the "postcode area") separately from
// the trailing digits. Validated against the Monday.com leads dataset.
//
//   group 1 → area letters   (e.g. "NG", "M", "E", "LE")
//   group 2 → the rest of the outward code (digits + optional letter)
//
// Examples of what it matches: "NG1 5GB", "M1 1AE", "E11 3LQ", "EC1A 1BB".
const UK_POSTCODE_RE = /\b([A-Z]{1,2})(\d{1,2}[A-Z]?)\s*\d[A-Z]{2}\b/i;

/**
 * Extract the postcode area (the leading letter group of the outward code)
 * from a full UK postcode or an address that contains one.
 *
 * @returns the uppercased area letters (e.g. "NG", "M", "LE"), or `null`
 *          when no full UK postcode can be found in the input.
 */
export function extractPostcodeArea(postcodeOrAddress: string): string | null {
  if (typeof postcodeOrAddress !== 'string') return null;

  const match = postcodeOrAddress.match(UK_POSTCODE_RE);
  if (!match) return null;

  return match[1].toUpperCase();
}

// ─── Full postcode extraction ─────────────────────────────────────
//
// The analyser takes `address` and `postcode` as separate inputs, but a
// spreadsheet (and the Monday Address column) carries one free-text address
// with the postcode buried in it, formatted inconsistently: "FY12AT" with no
// space, "Ll18 3TY" in the wrong case, "TR26 2QH TR26 2QH" duplicated.
//
// Same grammar as UK_POSTCODE_RE above, but capturing the outward and inward
// codes as a pair so the whole postcode can be rebuilt, and global so every
// occurrence is visible to the caller.
const UK_POSTCODE_PAIR_RE = /\b([A-Z]{1,2}\d{1,2}[A-Z]?)\s*(\d[A-Z]{2})\b/gi;

/**
 * Rebuild a postcode in canonical "OUTWARD INWARD" form.
 *
 * @returns e.g. "LL18 3TY", or `null` when the input isn't a full postcode.
 */
export function normalisePostcode(raw: string): string | null {
  if (typeof raw !== 'string') return null;

  const compact = raw.replace(/\s+/g, '').toUpperCase();
  if (compact.length < 5 || compact.length > 7) return null;

  const candidate = `${compact.slice(0, -3)} ${compact.slice(-3)}`;
  // Re-validate: a 5-7 char string isn't necessarily a postcode.
  UK_POSTCODE_PAIR_RE.lastIndex = 0;
  return UK_POSTCODE_PAIR_RE.test(candidate) ? candidate : null;
}

/**
 * Every full UK postcode in a string, normalised and de-duplicated,
 * in the order they appear.
 *
 * A row whose address yields more than one DISTINCT postcode is ambiguous and
 * should be flagged for review rather than guessed at.
 */
export function extractPostcodes(input: string): string[] {
  if (typeof input !== 'string') return [];

  const found = new Set<string>();
  // Reset lastIndex: the regex is module-level and /g is stateful.
  UK_POSTCODE_PAIR_RE.lastIndex = 0;
  for (const match of input.matchAll(UK_POSTCODE_PAIR_RE)) {
    found.add(`${match[1].toUpperCase()} ${match[2].toUpperCase()}`);
  }
  return [...found];
}

/**
 * The single postcode for an address, or `null` when there isn't one.
 *
 * Takes the LAST match, because a UK address ends with its postcode — so when
 * a string somehow contains more than one, the trailing one is the property's.
 * Never guesses: an address with no full postcode returns null so the caller
 * can reject the row.
 */
export function extractPostcode(input: string): string | null {
  const all = extractPostcodes(input);
  return all.length ? all[all.length - 1] : null;
}
