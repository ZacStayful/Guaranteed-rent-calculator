// ─── Management Leads directory (bulk matching) ───────────────────
//
// The live single-property flow searches Monday per run, which is right for
// one property. For a 100-row batch that would be 200-300 searches; instead we
// snapshot the whole board once (3 requests for ~1,165 items) and match in
// memory.
//
// Crucially, matching goes through the SAME resolveLeadFromCandidates as the
// live path — this module only builds its candidate sets — so the two flows
// cannot drift apart. Phone numbers are normalised locally, which also means
// none of this depends on Monday's search semantics for the phone columns.

import {
  resolveLeadFromCandidates,
  houseTokens,
  normaliseLoose,
  type LeadCandidate,
  type LeadMatch,
  type LeadRef,
} from "./lead-match.ts";
import { extractPostcodes } from "../utils/postcode.ts";
import { ukPhoneKey } from "../utils/phone.ts";

const MONDAY_API_URL = "https://api.monday.com/v2";
const MONDAY_API_VERSION = "2024-10";
const PAGE_SIZE = 500;
const MAX_PAGES = 20; // 10,000 items — the board's own item limit.
const CACHE_TTL_MS = 10 * 60 * 1000;

// Mirrors the defaults in monday.ts — the "Guaranteed rent leads" board. A
// blank id means the board has no such column; it is filtered out of queries
// rather than requested, which Monday would reject.
const DEFAULTS = {
  boardId: "18396542480",
  emailColumnId: "text_mkztseha",
  addressColumnId: "text_mkzxhyv9",
  phoneColumnId: "text_mkztq5xb",
  altPhoneColumnId: "",
};

export interface LeadDirectoryEntry extends LeadCandidate {
  name: string;
  /** Every postcode found in the Address column, normalised. */
  postcodes: string[];
  /** Number-bearing address tokens, postcode removed. */
  houseTokens: string[];
  /** Canonical "07…" forms of both phone columns. */
  phoneKeys: string[];
}

interface RawItem {
  id: string;
  name: string;
  column_values: Array<{ id: string; text: string | null }>;
}

function config() {
  const token = process.env.MONDAY_API_TOKEN || process.env.MONDAY_API_KEY;
  if (!token) return null;
  return {
    token,
    boardId: process.env.MONDAY_BOARD_ID || DEFAULTS.boardId,
    emailColumnId: process.env.MONDAY_EMAIL_COLUMN_ID || DEFAULTS.emailColumnId,
    addressColumnId: process.env.MONDAY_ADDRESS_COLUMN_ID || DEFAULTS.addressColumnId,
    phoneColumnId: process.env.MONDAY_PHONE_COLUMN_ID || DEFAULTS.phoneColumnId,
    altPhoneColumnId: process.env.MONDAY_ALT_PHONE_COLUMN_ID || DEFAULTS.altPhoneColumnId,
  };
}

async function query<T>(
  token: string,
  gql: string,
  variables: Record<string, unknown>,
): Promise<T | null> {
  try {
    const res = await fetch(MONDAY_API_URL, {
      method: "POST",
      headers: {
        Authorization: token,
        "Content-Type": "application/json",
        "API-Version": MONDAY_API_VERSION,
      },
      body: JSON.stringify({ query: gql, variables }),
    });
    if (!res.ok) {
      console.error(`[Monday directory] HTTP ${res.status}: ${await res.text()}`);
      return null;
    }
    const json = (await res.json()) as { data?: T; errors?: unknown };
    if (json.errors) {
      console.error("[Monday directory] GraphQL errors:", JSON.stringify(json.errors));
      return null;
    }
    return json.data ?? null;
  } catch (err) {
    console.error("[Monday directory] network error:", err);
    return null;
  }
}

const FIRST_PAGE = `
  query ($boardId: ID!, $limit: Int!, $cols: [String!]) {
    boards(ids: [$boardId]) {
      items_page(limit: $limit) {
        cursor
        items { id name column_values(ids: $cols) { id text } }
      }
    }
  }
`;

const NEXT_PAGE = `
  query ($cursor: String!, $limit: Int!, $cols: [String!]) {
    next_items_page(cursor: $cursor, limit: $limit) {
      cursor
      items { id name column_values(ids: $cols) { id text } }
    }
  }
`;

function toEntry(item: RawItem, cfg: NonNullable<ReturnType<typeof config>>): LeadDirectoryEntry {
  const col = (id: string) => item.column_values.find((c) => c.id === id)?.text ?? "";
  const address = col(cfg.addressColumnId);
  const phone = col(cfg.phoneColumnId);
  const altPhone = cfg.altPhoneColumnId ? col(cfg.altPhoneColumnId) : "";

  return {
    id: item.id,
    name: item.name,
    email: col(cfg.emailColumnId),
    address,
    phone,
    altPhone,
    postcodes: extractPostcodes(address),
    houseTokens: [...houseTokens(address)],
    // Both columns, because they can legitimately hold different numbers for
    // the same lead.
    phoneKeys: [ukPhoneKey(phone), ukPhoneKey(altPhone)].filter((k): k is string => k !== null),
  };
}

let cache: { at: number; entries: LeadDirectoryEntry[] } | null = null;

/**
 * Every lead on the board, with matching keys precomputed.
 *
 * Cached in module memory for 10 minutes so the preview and the worker share
 * one snapshot. Returns [] when Monday isn't configured, so callers degrade to
 * "no match" rather than throwing.
 */
export async function fetchLeadDirectory(options: { force?: boolean } = {}): Promise<LeadDirectoryEntry[]> {
  if (!options.force && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.entries;
  }

  const cfg = config();
  if (!cfg) {
    console.log("[Monday directory] no API credential set");
    return [];
  }

  const cols = [cfg.emailColumnId, cfg.addressColumnId, cfg.phoneColumnId, cfg.altPhoneColumnId]
    .filter((id) => id.length > 0);
  const entries: LeadDirectoryEntry[] = [];

  const first = await query<{ boards: Array<{ items_page: { cursor: string | null; items: RawItem[] } }> }>(
    cfg.token, FIRST_PAGE, { boardId: cfg.boardId, limit: PAGE_SIZE, cols },
  );
  const page = first?.boards?.[0]?.items_page;
  if (!page) return [];

  entries.push(...page.items.map((i) => toEntry(i, cfg)));
  let cursor = page.cursor;

  for (let i = 1; cursor && i < MAX_PAGES; i++) {
    const next = await query<{ next_items_page: { cursor: string | null; items: RawItem[] } }>(
      cfg.token, NEXT_PAGE, { cursor, limit: PAGE_SIZE, cols },
    );
    const p = next?.next_items_page;
    if (!p) break;
    entries.push(...p.items.map((item) => toEntry(item, cfg)));
    cursor = p.cursor;
  }

  console.log(`[Monday directory] snapshot: ${entries.length} leads`);
  cache = { at: Date.now(), entries };
  return entries;
}

/** Drop the cached snapshot (used after a job finishes writing to the board). */
export function invalidateLeadDirectory(): void {
  cache = null;
}

export interface DirectoryMatch extends LeadMatch {
  itemName: string | null;
}

/**
 * Match one spreadsheet row against the snapshot.
 *
 * Builds the same three candidate sets the live path builds by querying Monday,
 * then defers to the identical resolver.
 */
export function matchAgainstDirectory(
  directory: LeadDirectoryEntry[],
  ref: LeadRef,
): DirectoryMatch {
  const email = ref.email?.trim().toLowerCase() || null;
  const phoneKey = ukPhoneKey(ref.phone);
  const postcode = ref.postcode?.trim() || null;
  const postcodeLoose = postcode ? normaliseLoose(postcode) : null;

  const byEmail = email
    ? directory.filter((e) => e.email.trim().toLowerCase() === email)
    : [];
  const byPhone = phoneKey
    ? directory.filter((e) => e.phoneKeys.includes(phoneKey))
    : [];
  // Mirrors the live path's contains_text rule on the Address column, but
  // compared on normalised postcodes so "NG7 4AJ" and "NG74AJ" both hit.
  const byPostcode = postcodeLoose
    ? directory.filter((e) =>
        e.postcodes.some((p) => normaliseLoose(p) === postcodeLoose)
        || normaliseLoose(e.address).includes(postcodeLoose))
    : [];

  const match = resolveLeadFromCandidates({ byEmail, byPhone, byPostcode }, ref);
  const entry = match.itemId ? directory.find((e) => e.id === match.itemId) : null;
  return { ...match, itemName: entry?.name ?? null };
}
