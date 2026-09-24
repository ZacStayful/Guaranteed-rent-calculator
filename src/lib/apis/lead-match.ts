// ─── Lead matching (pure) ─────────────────────────────────────────
//
// Deciding WHICH Management Leads item an analysis belongs to, given whatever
// identifying scraps we have: an email, a phone number, and the property
// address. Kept free of network calls so it can be unit-tested exhaustively and
// shared by both callers:
//
//   • the live single-property flow, which searches Monday per run
//     (src/lib/apis/monday.ts)
//   • the bulk upload, which snapshots the whole board once and matches
//     in memory (src/lib/apis/monday-leads.ts)
//
// Both build the same three candidate sets and call resolveLeadFromCandidates,
// so the two flows cannot drift apart.
//
// The guiding rule, unchanged from the original implementation: NEVER guess.
// Returning null costs one skipped row; guessing writes a lead's financials
// onto a stranger's record.

// Explicit .ts extensions: these modules are pulled in by `node --test`
// (npm test) as well as by the bundler, and the bare Node ESM resolver does
// not do extension inference. `allowImportingTsExtensions` is on in tsconfig.
import { extractPostcodes } from "../utils/postcode.ts";
import { ukPhoneKey } from "../utils/phone.ts";

export interface LeadCandidate {
  id: string;
  name?: string;
  email: string;
  address: string;
  /** "Phone" column (phone_mm1hp0a8) — stored in whatever shape the lead typed */
  phone: string;
  /** "Text Number format" column (text_mm1jzzzc) — usually already "07…" */
  altPhone: string;
}

export interface LeadRef {
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  postcode?: string | null;
}

export type MatchMethod =
  | "email+postcode"
  | "email+phone"
  | "phone+postcode"
  | "email"
  | "phone"
  | "postcode"
  | "none";

export interface LeadMatch {
  itemId: string | null;
  method: MatchMethod;
}

export interface CandidateSets {
  byEmail: LeadCandidate[];
  byPhone: LeadCandidate[];
  byPostcode: LeadCandidate[];
}

export function normaliseLoose(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * The number-bearing tokens of an address, with any postcode removed first.
 *
 *   "Flat 3, 12 High Street, M1 1AE"  →  {"3", "12"}
 *   "12 High Street"                  →  {"12"}
 *
 * Replaces the original `leadingToken`, which took only the FIRST token and so
 * returned "FLAT" for any flat — never matching a board address of
 * "12 High Street". Note that "first token containing a digit" is not a fix
 * either: it yields "3", the flat number, and still misses "12". Comparing the
 * whole set and treating an intersection as a match handles both.
 *
 * The postcode is stripped because it is itself number-bearing: leaving it in
 * would make every two addresses in the same postcode "match", which is exactly
 * the situation this is used to disambiguate.
 */
export function houseTokens(address?: string | null): Set<string> {
  if (!address) return new Set();

  let stripped = address;
  for (const pc of extractPostcodes(address)) {
    // Remove both the spaced and compact spellings of each postcode found.
    const compact = pc.replace(/\s+/g, "");
    stripped = stripped
      .replace(new RegExp(escapeRegExp(pc), "gi"), " ")
      .replace(new RegExp(escapeRegExp(compact), "gi"), " ");
  }

  const tokens = stripped.split(/[\s,]+/).filter(Boolean);
  const withDigits = tokens
    .map(normaliseLoose)
    .filter((t) => t.length > 0 && /\d/.test(t));
  return new Set(withDigits);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tokensIntersect(a: Set<string>, b: Set<string>): boolean {
  if (!a.size || !b.size) return false;
  for (const t of a) if (b.has(t)) return true;
  return false;
}

/** Does this candidate carry the given phone number on either phone column? */
function candidateHasPhone(candidate: LeadCandidate, phoneKey: string): boolean {
  return (
    ukPhoneKey(candidate.phone) === phoneKey || ukPhoneKey(candidate.altPhone) === phoneKey
  );
}

function byId(list: LeadCandidate[]): Set<string> {
  return new Set(list.map((c) => c.id));
}

/**
 * Resolve the single lead these identifying details refer to.
 *
 * Precedence, strongest first. Tiers marked ★ are new (phone); they sit BELOW
 * email everywhere they could compete with it, so every input that resolved
 * before this change resolves to the same item.
 *
 *   1.  email ∩ postcode      — two independent signals agree
 *   2. ★email ∩ phone
 *   3. ★phone ∩ postcode      — two independent non-email signals agree
 *   4.  single email match
 *   5.  several email matches → narrow by postcode, then house number,
 *                               then ★phone; else take the first
 *   6. ★single phone match    → narrow by postcode / house number
 *   7.  property alone        — single postcode hit, or house number decides
 *   8.  null                  — refuses to guess
 */
export function resolveLeadFromCandidates(sets: CandidateSets, ref: LeadRef): LeadMatch {
  const { byEmail, byPhone, byPostcode } = sets;
  const postcode = ref.postcode?.trim() ?? null;
  const refTokens = houseTokens(ref.address);
  const phoneKey = ukPhoneKey(ref.phone);

  const postcodeIds = byId(byPostcode);
  const phoneIds = byId(byPhone);

  // 1. Strongest: the same row is found by BOTH the email and the property.
  if (byEmail.length && byPostcode.length) {
    const both = byEmail.find((e) => postcodeIds.has(e.id));
    if (both) return { itemId: both.id, method: "email+postcode" };
  }

  // 2. ★ Email and phone agree.
  if (byEmail.length && byPhone.length) {
    const both = byEmail.find((e) => phoneIds.has(e.id));
    if (both) return { itemId: both.id, method: "email+phone" };
  }

  // 3. ★ No email agreement, but phone and property agree.
  if (byPhone.length && byPostcode.length) {
    const both = byPhone.find((p) => postcodeIds.has(p.id));
    if (both) return { itemId: both.id, method: "phone+postcode" };
  }

  // 4/5. Email is a strong signal on its own.
  if (byEmail.length === 1) return { itemId: byEmail[0].id, method: "email" };
  if (byEmail.length > 1) {
    if (postcode) {
      const target = normaliseLoose(postcode);
      const byPc = byEmail.filter((e) => normaliseLoose(e.address).includes(target));
      if (byPc.length === 1) return { itemId: byPc[0].id, method: "email+postcode" };
    }
    if (refTokens.size) {
      const byHouse = byEmail.filter((e) => tokensIntersect(houseTokens(e.address), refTokens));
      if (byHouse.length === 1) return { itemId: byHouse[0].id, method: "email+postcode" };
    }
    if (phoneKey) {
      const byPhoneNum = byEmail.filter((e) => candidateHasPhone(e, phoneKey));
      if (byPhoneNum.length === 1) return { itemId: byPhoneNum[0].id, method: "email+phone" };
    }
    // Email remains a strong signal — take the first, as the original did.
    return { itemId: byEmail[0].id, method: "email" };
  }

  // 6. ★ No email match at all — fall back to the phone number.
  if (byPhone.length === 1) return { itemId: byPhone[0].id, method: "phone" };
  if (byPhone.length > 1) {
    if (postcode) {
      const target = normaliseLoose(postcode);
      const byPc = byPhone.filter((p) => normaliseLoose(p.address).includes(target));
      if (byPc.length === 1) return { itemId: byPc[0].id, method: "phone+postcode" };
    }
    if (refTokens.size) {
      const byHouse = byPhone.filter((p) => tokensIntersect(houseTokens(p.address), refTokens));
      if (byHouse.length === 1) return { itemId: byHouse[0].id, method: "phone" };
    }
    return { itemId: null, method: "none" };
  }

  // 7. Resolve purely by the enquiry property.
  if (byPostcode.length === 1) return { itemId: byPostcode[0].id, method: "postcode" };
  if (byPostcode.length > 1 && refTokens.size) {
    const byHouse = byPostcode.filter((p) => tokensIntersect(houseTokens(p.address), refTokens));
    if (byHouse.length === 1) return { itemId: byHouse[0].id, method: "postcode" };
  }

  // 8. Ambiguous or unknown — never guess.
  return { itemId: null, method: "none" };
}
