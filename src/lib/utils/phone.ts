// ─── UK phone helpers ─────────────────────────────────────────────
//
// Lead phone numbers arrive in inconsistent shapes. On the Management Leads
// board alone the same kind of mobile is stored as "+447896959558",
// "447456850528", "07702618284" and — commonly — "+4407896959558", where the
// +44 country code is followed by the full national number INCLUDING its trunk
// zero. Spreadsheets add a fifth shape, because Excel treats "07123456789" as
// the number 7123456789 and silently eats the leading zero.
//
// Everything here normalises to ONE canonical national form ("07123456789") so
// those variants compare equal. Anything that isn't a recognisable UK number —
// including the genuine non-UK numbers on the board (+34…, +1…, 49…) — returns
// null rather than being coerced into a wrong-but-plausible UK number.

export interface UkPhone {
  /** "+447123456789" */
  e164: string;
  /** "07123456789" — the canonical comparison key */
  national: string;
  /** "7123456789" — national without the trunk zero */
  significant: string;
}

/**
 * Normalise a free-text UK phone number.
 *
 * @returns the canonical forms, or `null` when the input isn't a UK number.
 */
export function normaliseUkPhone(raw: string | null | undefined): UkPhone | null {
  if (typeof raw !== "string") return null;

  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Strip everything except digits, keeping track of an explicit "+". The
  // "(0)" in "+44 (0)7123 456789" is removed wholesale: the zero inside the
  // brackets is a trunk prefix and must not survive into the digit string.
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\(0\)/g, "").replace(/\D/g, "");
  if (!digits) return null;

  // Reduce to the "significant" part — the national number without its trunk
  // zero and without any country code.
  let significant: string | null = null;

  if (digits.startsWith("0044")) {
    significant = digits.slice(4);
  } else if (digits.startsWith("44") && (hasPlus || digits.length >= 12)) {
    // "44…" is only a country code when it's explicitly +44, or when the number
    // is too long to be anything else. Without this guard a national number
    // that happens to begin "44" would be mangled.
    significant = digits.slice(2);
  } else if (digits.startsWith("0")) {
    significant = digits.slice(1);
  } else if (digits.length === 10 && digits.startsWith("7")) {
    // Excel dropped the leading zero from a mobile.
    significant = digits;
  }

  if (significant === null) return null;

  // Handles "+4407896959558" — country code followed by the trunk zero as well.
  while (significant.startsWith("0")) significant = significant.slice(1);

  // UK significant numbers are 9 (some landlines) or 10 digits.
  if (significant.length < 9 || significant.length > 10) return null;

  return {
    e164: `+44${significant}`,
    national: `0${significant}`,
    significant,
  };
}

/**
 * The string shapes a phone number takes on the Monday board, for use as
 * `column_values` in an exact-match search. Ordered most-likely-first.
 *
 * Every shape below was observed in a 50-row sample of the live board — the
 * Phone column stores whatever the lead typed, so all six coexist:
 *   "+4407896959558"  +44 then the national number INCLUDING its trunk zero
 *   "447456850528"    44 then the significant digits
 *   "4407568428895"   44 then the national number including its trunk zero
 *   "+447984670995"   proper E.164
 *   "07702618284"     plain national
 *   "7896959558"      significant only (rare; Excel-style)
 */
export function ukPhoneSearchVariants(phone: UkPhone): string[] {
  const { e164, national, significant } = phone;
  return [
    ...new Set([
      e164,
      `+44${national}`,
      `44${significant}`,
      `44${national}`,
      national,
      significant,
    ]),
  ];
}

/**
 * Convenience: normalise and return just the comparison key, or null.
 * Used when building lookup maps.
 */
export function ukPhoneKey(raw: string | null | undefined): string | null {
  return normaliseUkPhone(raw)?.national ?? null;
}
