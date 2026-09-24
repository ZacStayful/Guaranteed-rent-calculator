/**
 * Monday.com CRM integration — Management Leads board.
 *
 * Finds a lead in Monday.com by email (case-insensitive) and writes the
 * computed long-term let net annual and short-term let net annual figures
 * to the board columns.
 *
 * Required env vars (all must be set for sync to run):
 *   MONDAY_API_KEY (or MONDAY_API_TOKEN) — API token (keep secret)
 *   MONDAY_BOARD_ID               — "Management Leads" board id
 *   MONDAY_EMAIL_COLUMN_ID        — column id holding lead emails
 *   MONDAY_LONG_TERM_LET_COLUMN_ID
 *   MONDAY_DEAL_ANALYSER_COLUMN_ID
 *
 * Behaviour: silent — all errors log server-side and are swallowed so the
 * caller (the analyse endpoint) never leaks CRM failures to the user.
 */

import type { GuaranteedRentAssessment, GuaranteedRentBand } from "../guaranteedRent.ts";
import {
  resolveLeadFromCandidates,
  type CandidateSets,
  type LeadCandidate,
  type LeadRef,
} from "./lead-match.ts";
import { normaliseUkPhone, ukPhoneSearchVariants } from "../utils/phone.ts";

const MONDAY_API_URL = "https://api.monday.com/v2";
const MONDAY_API_VERSION = "2024-10";

// "Guaranteed rent leads" board + its column IDs, hardcoded as defaults so the
// integration works with only MONDAY_API_TOKEN set. Env vars still override
// each value if you ever need to point at a different board or columns.
//
// Leads are already on this board by the time the analyser looks for them — an
// existing workflow creates the item from the enquiry. Nothing here creates
// items; a lead we cannot find is logged and skipped.
//
// An empty string means "this board has no such column". Every read and write
// below skips a blank id rather than asking Monday for a column that does not
// exist, which would fail the whole atomic write.
const DEFAULTS = {
  boardId: "18396542480",
  emailColumnId: "text_mkztseha",           // "Email"
  addressColumnId: "text_mkzxhyv9",         // "Address" — includes the postcode
  phoneColumnId: "text_mkztq5xb",           // "Phone" — a text column on this board
  altPhoneColumnId: "",                     // no second phone column here
  fileColumnId: "file_mkzt6hf1",            // "PDF analysis" — where the report lands
  analyserUsesColumnId: "numeric_mm7gg2hy", // "Analyser Uses" — usage-gate counter
  timeOnSiteColumnId: "",                   // no time-on-site column here
  statusColumnId: "status",                 // "Status"
  // Guaranteed-rent deal columns
  desiredRentColumnId: "text_mkztg3z9",     // "Desired rent" — what the landlord asked for
  rentOfferedColumnId: "text_mkzxkfns",     // "Rent offered" — what we can pay
  profitColumnId: "text_mkztftwn",          // "Profit after guaranteed rent" — monthly
};

// Which Status label each band maps to.
//
// Written by LABEL TEXT, not by numeric index. The STR analyser this was forked
// from writes indexes, but on this board a label's `id` and its `index` differ
// (Qualified is id 1, index 2) and Monday's status payload wants the id — so an
// index write here is a coin flip. The label text is unambiguous and readable
// in a log. It breaks only if someone renames a label, which is visible and
// rare; reordering, which is neither, is what would break indexes.
//
// INSUFFICIENT_DATA maps to null: a property we could not screen must not be
// banded at all.
const BAND_STATUS_LABEL: Record<GuaranteedRentBand, string | null> = {
  QUALIFIED: "Qualified",
  MEDIUM: "Yet to qualify",
  UNQUALIFIED: "Not qualified",
  INSUFFICIENT_DATA: null,
};

// Statuses the analyser is allowed to overwrite.
//
// A lead already moved to "Viewing" or "Secured / Sold" has been worked by a
// human, and a re-run of the calculator must not drag them back down the
// pipeline. Only an untriaged lead gets banded automatically.
const OVERWRITABLE_STATUSES = new Set(["", "yet to qualify"]);

function envConfig() {
  // Accept either env var name. This project deploys with MONDAY_API_KEY (the
  // get-report route uses it too); MONDAY_API_TOKEN is supported for back-compat.
  const token = process.env.MONDAY_API_TOKEN || process.env.MONDAY_API_KEY;
  if (!token) {
    console.log("[Monday] No API credential set (MONDAY_API_KEY / MONDAY_API_TOKEN)");
    return null;
  }
  return {
    token,
    boardId: process.env.MONDAY_BOARD_ID || DEFAULTS.boardId,
    emailColumnId: process.env.MONDAY_EMAIL_COLUMN_ID || DEFAULTS.emailColumnId,
    addressColumnId: process.env.MONDAY_ADDRESS_COLUMN_ID || DEFAULTS.addressColumnId,
    phoneColumnId: process.env.MONDAY_PHONE_COLUMN_ID || DEFAULTS.phoneColumnId,
    altPhoneColumnId: process.env.MONDAY_ALT_PHONE_COLUMN_ID || DEFAULTS.altPhoneColumnId,
    statusColumnId: process.env.MONDAY_STATUS_COLUMN_ID || DEFAULTS.statusColumnId,
    desiredRentColumnId: process.env.MONDAY_DESIRED_RENT_COLUMN_ID || DEFAULTS.desiredRentColumnId,
    rentOfferedColumnId: process.env.MONDAY_RENT_OFFERED_COLUMN_ID || DEFAULTS.rentOfferedColumnId,
    profitColumnId: process.env.MONDAY_PROFIT_COLUMN_ID || DEFAULTS.profitColumnId,
  };
}

/**
 * Board, email column and file column for the /report lookup.
 *
 * Exported so that route shares this configuration instead of keeping its own
 * copy — the STR analyser this was forked from had exactly that second copy,
 * and it had drifted onto a file column uploads never wrote to.
 */
export function reportLookupConfig(): { token: string; boardId: string; emailColumnId: string; fileColumnId: string } | null {
  const cfg = envConfig();
  if (!cfg) return null;
  return {
    token: cfg.token,
    boardId: cfg.boardId,
    emailColumnId: cfg.emailColumnId,
    fileColumnId: process.env.MONDAY_FILE_COLUMN_ID || DEFAULTS.fileColumnId,
  };
}

async function mondayQuery<T>(token: string, query: string, variables: Record<string, unknown>): Promise<T | null> {
  try {
    const res = await fetch(MONDAY_API_URL, {
      method: "POST",
      headers: {
        Authorization: token,
        "Content-Type": "application/json",
        "API-Version": MONDAY_API_VERSION,
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) {
      console.error(`[Monday] HTTP ${res.status}: ${await res.text()}`);
      return null;
    }
    const json = (await res.json()) as { data?: T; errors?: unknown };
    if (json.errors) {
      console.error("[Monday] GraphQL errors:", JSON.stringify(json.errors));
      return null;
    }
    return json.data ?? null;
  } catch (err) {
    console.error("[Monday] Network/parse error:", err);
    return null;
  }
}

/**
 * Finds the first item in the Management Leads board with a matching email.
 * Returns the item id or null.
 */
async function findItemIdByEmail(
  token: string,
  boardId: string,
  emailColumnId: string,
  email: string,
): Promise<string | null> {
  const query = `
    query ($boardId: ID!, $columnId: String!, $email: String!) {
      items_page_by_column_values(
        board_id: $boardId,
        columns: [{ column_id: $columnId, column_values: [$email] }],
        limit: 1
      ) {
        items { id }
      }
    }
  `;
  const data = await mondayQuery<{
    items_page_by_column_values: { items: Array<{ id: string }> };
  }>(token, query, {
    boardId,
    columnId: emailColumnId,
    email,
  });
  const item = data?.items_page_by_column_values?.items?.[0];
  if (item?.id) return item.id;

  // Fallback: try lowercase if original didn't match (handles case mismatches)
  const lower = email.toLowerCase();
  if (lower !== email) {
    const fallback = await mondayQuery<{
      items_page_by_column_values: { items: Array<{ id: string }> };
    }>(token, query, {
      boardId,
      columnId: emailColumnId,
      email: lower,
    });
    return fallback?.items_page_by_column_values?.items?.[0]?.id ?? null;
  }

  return null;
}

// ── Address / phone based lead matching ──────────────────────────
// Leads arrive on the board via the enquiry form, which stores the property
// address in the Address column (text6). A lead who then runs the analyser
// enters that same property address, so when the email doesn't resolve their
// row (they used a different email than the one on the board, or a typo) we can
// still find the right lead by the property they enquired about, or by their
// phone number. Matching is anchored on the postcode — the one part of a
// free-text UK address that survives spelling differences (see "Pevril" vs
// "Peveril") — with the house number as the tiebreaker, and it refuses to guess
// when the property is ambiguous, so an analysis is never written onto the
// wrong lead.
//
// The precedence logic itself lives in ./lead-match.ts as a pure function, so
// it can be unit-tested exhaustively and reused verbatim by the bulk upload's
// in-memory matcher. This module only does the I/O that builds its inputs.

// UK postcodes are stored inconsistently ("NG7 4AJ" vs "NG74AJ"); contains_text
// is a literal substring match, so search for the spaced and compact forms.
function postcodeVariants(postcode: string): string[] {
  const compact = postcode.toUpperCase().replace(/\s+/g, "");
  const variants = new Set<string>();
  const asEntered = postcode.trim().toUpperCase();
  if (asEntered) variants.add(asEntered);
  if (compact.length >= 5) variants.add(`${compact.slice(0, compact.length - 3)} ${compact.slice(-3)}`);
  if (compact) variants.add(compact);
  return [...variants];
}

type Cfg = NonNullable<ReturnType<typeof envConfig>>;

/** The column ids every candidate query needs to fetch. */
function candidateCols(cfg: Cfg): string[] {
  // Blank ids are columns this board does not have. Asking for one makes Monday
  // reject the whole query, so they are filtered out rather than passed through.
  return [cfg.emailColumnId, cfg.addressColumnId, cfg.phoneColumnId, cfg.altPhoneColumnId]
    .filter((id) => id.length > 0);
}

function toCandidates(
  items: Array<{ id: string; name?: string; column_values: Array<{ id: string; text: string | null }> }>,
  cfg: Cfg,
): LeadCandidate[] {
  const col = (
    values: Array<{ id: string; text: string | null }>,
    id: string,
  ): string => values.find((c) => c.id === id)?.text ?? "";

  return items.map((it) => ({
    id: it.id,
    name: it.name,
    email: col(it.column_values, cfg.emailColumnId),
    address: col(it.column_values, cfg.addressColumnId),
    phone: col(it.column_values, cfg.phoneColumnId),
    altPhone: cfg.altPhoneColumnId ? col(it.column_values, cfg.altPhoneColumnId) : "",
  }));
}

type CandidateItems = { items: Array<{ id: string; name?: string; column_values: Array<{ id: string; text: string | null }> }> };

const BY_COLUMN_VALUES_QUERY = `
  query ($boardId: ID!, $columnId: String!, $values: [String]!, $cols: [String!]) {
    items_page_by_column_values(
      board_id: $boardId,
      columns: [{ column_id: $columnId, column_values: $values }],
      limit: 25
    ) {
      items { id name column_values(ids: $cols) { id text } }
    }
  }
`;

async function searchByColumnValues(
  cfg: Cfg, columnId: string, values: string[],
): Promise<LeadCandidate[]> {
  if (!values.length) return [];
  const data = await mondayQuery<{ items_page_by_column_values: CandidateItems }>(
    cfg.token, BY_COLUMN_VALUES_QUERY,
    { boardId: cfg.boardId, columnId, values, cols: candidateCols(cfg) },
  );
  const items = data?.items_page_by_column_values?.items ?? [];
  return items.length ? toCandidates(items, cfg) : [];
}

async function searchLeadsByEmail(cfg: Cfg, email: string): Promise<LeadCandidate[]> {
  // Case mismatches are common, so try the address as given and lowercased.
  const values = [...new Set([email, email.toLowerCase()])];
  return searchByColumnValues(cfg, cfg.emailColumnId, values);
}

/**
 * Find leads by phone number.
 *
 * The board stores the same mobile in six different shapes across the two
 * phone columns — "+4407896959558", "447456850528", "4407568428895",
 * "+447984670995", "07702618284" — so we search for every canonical spelling
 * rather than assuming one. The "Text Number format" column (text) is checked
 * first because it is already normalised to "07…" on ~92% of rows; the Phone
 * column is checked second and can hold a DIFFERENT number for the same lead.
 */
async function searchLeadsByPhone(cfg: Cfg, phone: string): Promise<LeadCandidate[]> {
  const parsed = normaliseUkPhone(phone);
  if (!parsed) return [];
  const variants = ukPhoneSearchVariants(parsed);

  if (cfg.altPhoneColumnId) {
    const byText = await searchByColumnValues(cfg, cfg.altPhoneColumnId, variants);
    if (byText.length) return byText;
  }
  return searchByColumnValues(cfg, cfg.phoneColumnId, variants);
}

async function searchLeadsByPostcode(cfg: Cfg, postcode: string): Promise<LeadCandidate[]> {
  const query = `
    query ($boardId: ID!, $qp: ItemsQuery!, $cols: [String!]) {
      boards(ids: [$boardId]) {
        items_page(limit: 25, query_params: $qp) {
          items { id name column_values(ids: $cols) { id text } }
        }
      }
    }
  `;
  for (const variant of postcodeVariants(postcode)) {
    const data = await mondayQuery<{ boards: Array<{ items_page: CandidateItems }> }>(
      cfg.token, query, {
        boardId: cfg.boardId,
        qp: { rules: [{ column_id: cfg.addressColumnId, compare_value: [variant], operator: "contains_text" }] },
        cols: candidateCols(cfg),
      },
    );
    const items = data?.boards?.[0]?.items_page?.items ?? [];
    if (items.length) return toCandidates(items, cfg);
  }
  return [];
}

/**
 * Resolve the Management Leads item for an analyser run. Email is the primary
 * key; when it doesn't resolve a single lead, fall back to the enquiry property
 * (postcode + house number) stored in the Address column. Returns the item id,
 * or null — it never guesses when the property is ambiguous.
 */
async function findLeadItemId(cfg: Cfg, ref: LeadRef): Promise<string | null> {
  const email = ref.email?.trim();
  const phone = ref.phone?.trim();
  const postcode = ref.postcode?.trim();

  // Three independent searches, run in parallel — each may return nothing.
  const [byEmail, byPhone, byPostcode] = await Promise.all([
    email && email.includes("@") ? searchLeadsByEmail(cfg, email) : Promise.resolve([]),
    phone ? searchLeadsByPhone(cfg, phone) : Promise.resolve([]),
    postcode ? searchLeadsByPostcode(cfg, postcode) : Promise.resolve([]),
  ]);

  const sets: CandidateSets = { byEmail, byPhone, byPostcode };
  return resolveLeadFromCandidates(sets, ref).itemId;
}

/**
 * Public wrapper: resolve the Management Leads item for a set of identifying
 * details, or null when it can't be determined without guessing.
 *
 * Exposed so the bulk upload can resolve — and show you — the match BEFORE any
 * money is spent, then pass the confirmed item id into the write functions
 * below. That also halves the number of lookups on the live path, which
 * previously resolved once for the column sync and again for the PDF upload.
 */
export async function resolveLeadItemId(ref: LeadRef): Promise<string | null> {
  const cfg = envConfig();
  if (!cfg) return null;
  const hasSignal = Boolean(ref.email?.includes("@") || ref.phone || ref.postcode);
  if (!hasSignal) return null;
  return findLeadItemId(cfg, ref);
}

/**
 * Updates the two money-tracking columns on a given item.
 */
async function updateItemColumns(
  token: string,
  boardId: string,
  itemId: string,
  columnValues: Record<string, string | number | { label: string } | { index: number } | null>,
): Promise<boolean> {
  const valuesJson = JSON.stringify(columnValues);

  // MONDAY_DRY_RUN=1 — log exactly what would be written and report success,
  // without touching the board. Lets a whole bulk job be rehearsed against the
  // REAL board (matching included, which is the part most worth testing on
  // real data) while mutating nothing.
  if (process.env.MONDAY_DRY_RUN === "1") {
    console.log(`[Monday][DRY RUN] would write to item ${itemId}: ${valuesJson}`);
    return true;
  }

  const mutation = `
    mutation ($boardId: ID!, $itemId: ID!, $values: JSON!) {
      change_multiple_column_values(
        board_id: $boardId,
        item_id: $itemId,
        column_values: $values
      ) {
        id
      }
    }
  `;
  const data = await mondayQuery<{ change_multiple_column_values: { id: string } }>(
    token,
    mutation,
    { boardId, itemId, values: valuesJson },
  );
  return Boolean(data?.change_multiple_column_values?.id);
}

// ── Analyser usage counter ───────────────────────────────────────
// Durable per-email count of analyser runs, stored in the "Analyser Uses"
// number column on the lead's item. This backs the free-analysis paywall.
// It counts FORWARD from when the column was introduced (existing leads start
// at 0), so established leads are not retroactively blocked, and it is keyed by
// the lead — never by device — so it can't over-block a shared browser.

function analyserUsesColumnId(): string {
  return process.env.MONDAY_ANALYSER_USES_COLUMN_ID || DEFAULTS.analyserUsesColumnId;
}

async function readUseCount(
  cfg: NonNullable<ReturnType<typeof envConfig>>,
  itemId: string,
): Promise<number> {
  const colId = analyserUsesColumnId();
  const query = `
    query ($ids: [ID!], $cols: [String!]) {
      items(ids: $ids) { column_values(ids: $cols) { id text } }
    }
  `;
  const data = await mondayQuery<{
    items: Array<{ column_values: Array<{ id: string; text: string | null }> }>;
  }>(cfg.token, query, { ids: [itemId], cols: [colId] });
  const text = data?.items?.[0]?.column_values?.find((c) => c.id === colId)?.text ?? "";
  const n = parseInt(text, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * How many analyser runs this email's lead has recorded. Returns 0 when Monday
 * isn't configured, the email isn't a known lead, or the column is empty — so
 * the usage gate fails open and never wrongly blocks a genuine new user.
 */
export async function getAnalyserUseCount(email: string): Promise<number> {
  const cfg = envConfig();
  if (!cfg) return 0;
  if (!email || !email.includes("@")) return 0;
  // No counter column configured → nothing to count, so the gate never fires.
  if (!analyserUsesColumnId()) return 0;

  const itemId = await findItemIdByEmail(cfg.token, cfg.boardId, cfg.emailColumnId, email);
  if (!itemId) return 0;
  return readUseCount(cfg, itemId);
}

/**
 * Increment the analyser-use counter for this email's lead by one. No-op when
 * Monday isn't configured or the email isn't a known lead (nothing to count
 * against). Fails silently — a CRM hiccup must never break the analysis.
 */
export async function incrementAnalyserUseCount(email: string): Promise<void> {
  const cfg = envConfig();
  if (!cfg) return;
  if (!email || !email.includes("@")) return;
  if (!analyserUsesColumnId()) return;

  const itemId = await findItemIdByEmail(cfg.token, cfg.boardId, cfg.emailColumnId, email);
  if (!itemId) {
    console.log(`[Monday] Analyser-use increment skipped — no lead for: ${email}`);
    return;
  }
  const current = await readUseCount(cfg, itemId);
  const ok = await updateItemColumns(cfg.token, cfg.boardId, itemId, {
    [analyserUsesColumnId()]: String(current + 1),
  });
  if (ok) {
    console.log(`[Monday] Analyser uses for ${email} → ${current + 1}`);
  } else {
    console.error(`[Monday] Analyser-use increment failed for ${email} (item ${itemId})`);
  }
}

/**
 * Money as this board already writes it: "£1,234.00", "-£500.00".
 *
 * The 299 leads already on the board use this exact shape, and the board's
 * formula column subtracts one of these from another, so a bare number here
 * would read oddly next to them. Figures shown to the landlord are whole
 * pounds; only these two CRM columns carry the pence.
 */
function gbpColumnValue(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  return `${sign}£${Math.abs(amount).toFixed(2)}`;
}

/** Reads a handful of column texts off one item. Null when the read fails. */
async function readItemColumns(
  cfg: Cfg, itemId: string, columnIds: string[],
): Promise<Record<string, string> | null> {
  const ids = columnIds.filter((id) => id.length > 0);
  if (!ids.length) return {};
  const query = `
    query ($ids: [ID!], $cols: [String!]) {
      items(ids: $ids) { column_values(ids: $cols) { id text } }
    }
  `;
  const data = await mondayQuery<{
    items: Array<{ column_values: Array<{ id: string; text: string | null }> }>;
  }>(cfg.token, query, { ids: [itemId], cols: ids });
  const values = data?.items?.[0]?.column_values;
  if (!values) return null;
  return Object.fromEntries(values.map((cv) => [cv.id, cv.text ?? ""]));
}

/**
 * Writes the guaranteed-rent assessment onto the lead's item.
 *
 * Only what the analyser computed: the rent asked for, the rent offered, the
 * monthly profit and the band. Address, email, phone, bedrooms and lead source
 * belong to the workflow that created the item and are left alone.
 *
 * The profit written is the profit AT THE ASKING RENT, not at the rent offered.
 * Profit at the offer is pinned near the £8,000 target by construction, so it
 * would be the same number on every row and tell nobody anything; profit at the
 * ask is what says whether this lead is worth chasing.
 *
 * Fails silently (logs only) — a CRM hiccup must never break a live estimate.
 */
export async function syncAnalysisToMonday(
  email: string,
  guaranteedRent: GuaranteedRentAssessment,
  property?: { address?: string | null; postcode?: string | null; phone?: string | null },
  /** Pre-resolved item id (bulk); skips the lookup when supplied. */
  knownItemId?: string | null,
): Promise<void> {
  const cfg = envConfig();
  if (!cfg) {
    console.log("[Monday] Sync skipped — env vars not configured");
    return;
  }
  const hasEmail = !!email && email.includes("@");
  if (!knownItemId && !hasEmail && !property?.postcode && !property?.phone) {
    console.log("[Monday] Sync skipped — no email, phone or postcode to match on");
    return;
  }

  const itemId = knownItemId
    ?? await findLeadItemId(cfg, {
      email,
      phone: property?.phone,
      address: property?.address,
      postcode: property?.postcode,
    });
  if (!itemId) {
    console.log(`[Monday] No lead found (sync skipped): email=${email} postcode=${property?.postcode ?? "?"}`);
    return;
  }

  const columnValues: Record<string, string | { label: string }> = {};

  // Only write figures we actually have. An unscreenable property leaves the
  // deal columns exactly as the workflow left them rather than stamping £0
  // over them, which would read as a real offer of nothing.
  if (guaranteedRent.band !== "INSUFFICIENT_DATA") {
    if (guaranteedRent.desiredRentMonthly !== null && !guaranteedRent.desiredRentIsEstimate) {
      // Only overwrite the landlord's stated rent when they stated one to us.
      // An estimate must never masquerade as their answer.
      columnValues[cfg.desiredRentColumnId] = gbpColumnValue(guaranteedRent.desiredRentMonthly);
    }
    if (guaranteedRent.offerRentMonthly !== null) {
      columnValues[cfg.rentOfferedColumnId] = gbpColumnValue(guaranteedRent.offerRentMonthly);
    }
    if (guaranteedRent.monthlyProfit !== null) {
      columnValues[cfg.profitColumnId] = gbpColumnValue(guaranteedRent.monthlyProfit);
    }
  }

  // Band → Status, but only for a lead nobody has worked yet. Someone already
  // at "Viewing" or "Secured / Sold" must not be dragged back down the pipeline
  // because they re-ran the calculator.
  const label = BAND_STATUS_LABEL[guaranteedRent.band];
  if (label) {
    const current = await readItemColumns(cfg, itemId, [cfg.statusColumnId]);
    const currentStatus = (current?.[cfg.statusColumnId] ?? "").trim().toLowerCase();
    if (current === null) {
      console.warn(`[Monday] Could not read current status for item ${itemId} — leaving it unchanged`);
    } else if (OVERWRITABLE_STATUSES.has(currentStatus)) {
      columnValues[cfg.statusColumnId] = { label };
    } else {
      console.log(`[Monday] Status left as "${current[cfg.statusColumnId]}" on item ${itemId} — already triaged`);
    }
  }

  if (!Object.keys(columnValues).length) {
    console.log(`[Monday] Nothing to write for item ${itemId} (band ${guaranteedRent.band})`);
    return;
  }

  const ok = await updateItemColumns(cfg.token, cfg.boardId, itemId, columnValues);
  if (ok) {
    console.log(
      `[Monday] Synced guaranteed-rent assessment for ${email} → item ${itemId} ` +
      `(band ${guaranteedRent.band}, offer ${guaranteedRent.offerRentMonthly ?? "n/a"}/mo)`,
    );
  } else {
    console.error(`[Monday] Column update failed for ${email} (item ${itemId})`);
  }
}

/**
 * Uploads a PDF buffer to a Monday file column on the matched item.
 * Uses Monday's multipart file upload endpoint.
 */
export async function uploadPdfToMonday(
  email: string,
  pdfBuffer: Buffer | Uint8Array,
  filename: string,
  property?: { address?: string | null; postcode?: string | null; phone?: string | null },
  /** Pre-resolved item id (bulk); skips the lookup when supplied. */
  knownItemId?: string | null,
): Promise<void> {
  const cfg = envConfig();
  if (!cfg) return;
  const hasEmail = !!email && email.includes("@");
  if (!knownItemId && !hasEmail && !property?.postcode && !property?.phone) return;

  const itemId = knownItemId
    ?? await findLeadItemId(cfg, {
      email,
      phone: property?.phone,
      address: property?.address,
      postcode: property?.postcode,
    });
  if (!itemId) {
    console.log(`[Monday] PDF upload skipped — no lead for: email=${email} postcode=${property?.postcode ?? "?"}`);
    return;
  }

  const fileColumnId = process.env.MONDAY_FILE_COLUMN_ID || DEFAULTS.fileColumnId;

  if (process.env.MONDAY_DRY_RUN === "1") {
    console.log(
      `[Monday][DRY RUN] would upload ${filename} (${pdfBuffer.length} bytes) ` +
      `to item ${itemId} column ${fileColumnId}`,
    );
    return;
  }

  try {
    const query = `mutation ($file: File!) { add_file_to_column(item_id: ${itemId}, column_id: "${fileColumnId}", file: $file) { id } }`;

    const blob = new Blob([new Uint8Array(pdfBuffer)], { type: "application/pdf" });
    const form = new FormData();
    form.append("query", query);
    form.append("variables[file]", blob, filename);

    const res = await fetch("https://api.monday.com/v2/file", {
      method: "POST",
      headers: {
        Authorization: cfg.token,
        "API-Version": MONDAY_API_VERSION,
      },
      body: form,
    });

    if (!res.ok) {
      console.error(`[Monday] PDF upload HTTP ${res.status}: ${await res.text()}`);
      return;
    }
    console.log(`[Monday] PDF uploaded for ${email} → item ${itemId}`);
  } catch (err) {
    console.error("[Monday] PDF upload error:", err);
  }
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

/**
 * Pushes session duration to a text column in Monday.
 */
export async function syncTimeOnSiteToMonday(
  email: string,
  seconds: number,
): Promise<void> {
  const cfg = envConfig();
  if (!cfg) return;
  if (!email || !email.includes("@") || seconds <= 0) return;

  // This board has no time-on-site column, so the default is blank and the
  // sync is inert unless someone adds one and points the env var at it.
  const timeColumnId = process.env.MONDAY_TIME_ON_SITE_COLUMN_ID || DEFAULTS.timeOnSiteColumnId;
  if (!timeColumnId) return;

  const itemId = await findItemIdByEmail(cfg.token, cfg.boardId, cfg.emailColumnId, email);
  if (!itemId) {
    console.log(`[Monday] Time sync skipped — no lead for: ${email}`);
    return;
  }

  const formatted = formatDuration(Math.round(seconds));

  const mutation = `
    mutation ($boardId: ID!, $itemId: ID!, $values: JSON!) {
      change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $values) { id }
    }
  `;
  const valuesJson = JSON.stringify({ [timeColumnId]: formatted });
  const data = await mondayQuery<{ change_multiple_column_values: { id: string } }>(
    cfg.token,
    mutation,
    { boardId: cfg.boardId, itemId, values: valuesJson },
  );
  if (data?.change_multiple_column_values?.id) {
    console.log(`[Monday] Time synced for ${email}: ${formatted}`);
  } else {
    console.error(`[Monday] Time update failed for ${email}`);
  }
}
