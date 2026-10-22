// ─── Link parameters: pre-fill, lead source, test leads ───────────
//
// The website forms (and ads and emails) send visitors here with the details
// they already gave, so nobody types them twice, plus where they came from, so
// each lead can be traced to its page and campaign. Everything in a link is
// untrusted: each value is checked and anything invalid is dropped, never
// guessed at. The API route re-checks the source tags server side.
//
// Shared by the page (browser) and /api/analyse (server), so keep it free of
// server-only imports. The parameters are documented in docs/LINK_PARAMETERS.md.

import { extractPostcode, normalisePostcode } from './utils/postcode.ts';

// ── Pre-fill ──────────────────────────────────────────────────────

/** The form's property type options (src/app/page.tsx). */
export const PROPERTY_TYPES = ['Flat', 'Terraced', 'Semi-detached', 'Detached'] as const;
export type PropertyTypeOption = (typeof PROPERTY_TYPES)[number];

export interface LinkPrefill {
  /** The street part of the address, with any postcode taken out. */
  address?: string;
  postcode?: string;
  email?: string;
  bedrooms?: number;
  bathrooms?: number;
  propertyType?: PropertyTypeOption;
  /** The monthly rent the landlord wants guaranteed, in whole pounds. */
  desiredRent?: number;
}

const MAX_ADDRESS_LENGTH = 200;
const MAX_EMAIL_LENGTH = 254;
const MAX_DESIRED_RENT = 50_000;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Loose spellings a form or a hand-typed link might use, keyed by the value
// with everything but letters removed ("Semi detached house" → "semidetachedhouse").
const PROPERTY_TYPE_ALIASES: Record<string, PropertyTypeOption> = {
  flat: 'Flat',
  apartment: 'Flat',
  terraced: 'Terraced',
  terrace: 'Terraced',
  terracedhouse: 'Terraced',
  semidetached: 'Semi-detached',
  semi: 'Semi-detached',
  semidetachedhouse: 'Semi-detached',
  detached: 'Detached',
  detachedhouse: 'Detached',
};

/** Trim, drop control characters and collapse runs of whitespace. */
function cleanText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** A whole number within [min, max], or undefined. "2" passes; "2.5", "two" do not. */
function wholeNumberIn(value: string | null, min: number, max: number): number | undefined {
  const text = cleanText(value);
  if (!/^\d{1,3}$/.test(text)) return undefined;
  const n = Number(text);
  return n >= min && n <= max ? n : undefined;
}

/**
 * A monthly rent in pounds: "1200", "£1,200" and "1200.50" pass (rounded to
 * whole pounds); zero, negatives, words and anything over £50,000 do not.
 */
function monthlyRent(value: string | null): number | undefined {
  const text = cleanText(value).replace(/^£/, '').replace(/,/g, '');
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(text)) return undefined;
  const n = Math.round(Number(text));
  return n > 0 && n <= MAX_DESIRED_RENT ? n : undefined;
}

/**
 * Splits a UK postcode out of a one-line address.
 * "12 High Street, Leeds LS1 4AB" → { street: "12 High Street, Leeds", postcode: "LS1 4AB" }
 */
export function splitPostcodeFromAddress(raw: string): { street: string; postcode: string | null } {
  const text = cleanText(raw).replace(/,?\s*(UK|United Kingdom)\s*$/i, '');
  const postcode = extractPostcode(text);
  if (!postcode) return { street: text, postcode: null };

  const [outward, inward] = postcode.split(' ');
  const street = text
    .replace(new RegExp(`\\b${outward}\\s*${inward}\\b`, 'gi'), '')
    .replace(/\s*,(\s*,)+/g, ',')
    .replace(/^[\s,]+|[\s,]+$/g, '')
    .replace(/\s+/g, ' ');
  return { street, postcode };
}

/**
 * The form fields a link asks to pre-fill, already validated. Returns nothing
 * at all when the link is a demo link (?demo=), which loads its own figures.
 */
export function readPrefill(search: string): LinkPrefill {
  const params = new URLSearchParams(search);
  if (params.has('demo')) return {};

  const prefill: LinkPrefill = {};

  const rawAddress = cleanText(params.get('address'));
  if (rawAddress && rawAddress.length <= MAX_ADDRESS_LENGTH) {
    const { street, postcode } = splitPostcodeFromAddress(rawAddress);
    if (street) prefill.address = street;
    if (postcode) prefill.postcode = postcode;
  }

  // An explicit postcode wins over one found inside the address.
  const postcode = normalisePostcode(cleanText(params.get('postcode')));
  if (postcode) prefill.postcode = postcode;

  const email = cleanText(params.get('email'));
  if (email.length <= MAX_EMAIL_LENGTH && EMAIL_SHAPE.test(email)) prefill.email = email;

  const bedrooms = wholeNumberIn(params.get('bedrooms'), 0, 5);
  if (bedrooms !== undefined) prefill.bedrooms = bedrooms;

  const bathrooms = wholeNumberIn(params.get('bathrooms'), 1, 5);
  if (bathrooms !== undefined) prefill.bathrooms = bathrooms;

  const typeKey = cleanText(params.get('type')).toLowerCase().replace(/[^a-z]/g, '');
  const propertyType = PROPERTY_TYPE_ALIASES[typeKey];
  if (propertyType) prefill.propertyType = propertyType;

  // Every guaranteed rent form on the website asks for it, and this form needs it.
  const desiredRent = monthlyRent(params.get('rent'));
  if (desiredRent !== undefined) prefill.desiredRent = desiredRent;

  return prefill;
}

// ── Lead source ───────────────────────────────────────────────────

export const ATTRIBUTION_KEYS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'from',
] as const;
export type AttributionKey = (typeof ATTRIBUTION_KEYS)[number];
/** Where a lead came from: the link's UTM tags and the stayful.co.uk page ("from"). */
export type Attribution = Partial<Record<AttributionKey, string>>;

const MAX_TAG_LENGTH = 150;
const MAX_PAGE_LENGTH = 300;

/**
 * The sending page as a path ("/airbnb-management-leeds"). Accepts a path or a
 * full stayful.co.uk address; anything else (another site, junk) is dropped.
 */
function cleanSourcePage(value: unknown): string | undefined {
  const text = cleanText(value);
  if (!text) return undefined;

  let path: string;
  if (text.startsWith('/') && !text.startsWith('//')) {
    path = text.split(/[?#]/)[0];
  } else {
    try {
      const url = new URL(text);
      const host = url.hostname.toLowerCase();
      if (host !== 'stayful.co.uk' && !host.endsWith('.stayful.co.uk')) return undefined;
      path = url.pathname;
    } catch {
      return undefined;
    }
  }
  return path && path.length <= MAX_PAGE_LENGTH ? path : undefined;
}

/**
 * Keeps only the known source fields, each cleaned and capped. Null when
 * nothing usable is left. Run on the server too: never trust the browser.
 */
export function sanitiseAttribution(raw: unknown): Attribution | null {
  if (!raw || typeof raw !== 'object') return null;
  const input = raw as Record<string, unknown>;
  const out: Attribution = {};

  for (const key of ATTRIBUTION_KEYS) {
    if (key === 'from') {
      const page = cleanSourcePage(input.from);
      if (page) out.from = page;
      continue;
    }
    const tag = cleanText(input[key]).slice(0, MAX_TAG_LENGTH).trim();
    if (tag) out[key] = tag;
  }
  return Object.keys(out).length ? out : null;
}

/** The source fields carried by a link's query string, or null when none are. */
export function readAttribution(search: string): Attribution | null {
  const params = new URLSearchParams(search);
  const raw: Record<string, string> = {};
  for (const key of ATTRIBUTION_KEYS) {
    const value = params.get(key);
    if (value !== null) raw[key] = value;
  }
  return sanitiseAttribution(raw);
}

const ATTRIBUTION_STORAGE_KEY = 'stayful_lead_source';

/**
 * Keeps the source for the rest of the visit (browser only). A link that
 * carries source fields replaces what was kept; a bare link (a reload, a page
 * opened without them) reads it back. Storage can be blocked or throw, in which
 * case only what this link carries is used.
 */
export function keepAttributionForVisit(fromLink: Attribution | null): Attribution | null {
  try {
    const store = window.sessionStorage;
    if (fromLink) {
      store.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify(fromLink));
      return fromLink;
    }
    const saved = store.getItem(ATTRIBUTION_STORAGE_KEY);
    return saved ? sanitiseAttribution(JSON.parse(saved)) : null;
  } catch {
    return fromLink;
  }
}

// ── Keeping the visitor's details out of the address bar ──────────
//
// The Meta pixel sends the page's full address to Meta, so a link's email,
// address and postcode must leave the address bar before the pixel starts
// (website build plan, wave 2 review, Fix first 1; Zac 2026-10-22).
// PREFILL_GUARD_SCRIPT does that before anything else runs (src/app/layout.tsx
// runs it as a beforeInteractive script and again at the top of the pixel's
// own script, so their order never matters) and keeps the link's query for the
// page, which reads it with prefillSearch(). A reload of the cleaned address
// finds it again; any other page drops it.

/** The link fields that are personal details: never left in the address bar. */
export const PRIVATE_LINK_KEYS = ['email', 'address', 'postcode'] as const;
const PREFILL_STORAGE_KEY = 'stayful_prefill';

/** Plain browser JavaScript, inlined into the page. Running it twice is harmless. */
export const PREFILL_GUARD_SCRIPT = `(function(){try{var K=${JSON.stringify(PREFILL_STORAGE_KEY)},H=${JSON.stringify(PRIVATE_LINK_KEYS)},w=window,u=new URL(w.location.href),p=u.searchParams,orig=u.search,here=u.pathname+u.search+u.hash;if(H.some(function(k){return p.has(k)})){H.forEach(function(k){p.delete(k)});var q=p.toString(),clean=u.pathname+(q?'?'+q:'')+u.hash,kept={clean:clean,query:orig};w.__stayfulPrefill=kept;try{w.sessionStorage.setItem(K,JSON.stringify(kept))}catch(e){}w.history.replaceState(w.history.state,'',clean)}else if(!w.__stayfulPrefill){try{var s=JSON.parse(w.sessionStorage.getItem(K)||'null');if(s&&s.clean!==here)w.sessionStorage.removeItem(K)}catch(e){}}}catch(e){}})();`;

/**
 * The link's query as it arrived, before PREFILL_GUARD_SCRIPT took the
 * visitor's details out of the address bar (browser only). Falls back to the
 * address bar as it is now.
 */
export function prefillSearch(): string {
  const loc = window.location;
  const here = loc.pathname + loc.search + loc.hash;
  let kept: unknown = (window as unknown as { __stayfulPrefill?: unknown }).__stayfulPrefill ?? null;
  if (!kept) {
    try {
      kept = JSON.parse(window.sessionStorage.getItem(PREFILL_STORAGE_KEY) || 'null');
    } catch {
      kept = null;
    }
  }
  if (kept && typeof kept === 'object') {
    const { clean, query } = kept as { clean?: unknown; query?: unknown };
    if (clean === here && typeof query === 'string') return query;
  }
  return loc.search;
}

// ── Test leads ────────────────────────────────────────────────────

/** Emails at this domain run the calculator without touching Monday or the stored reports. */
export const TEST_EMAIL_DOMAIN = 'test.stayful.co.uk';

export function isTestEmail(email: string | null | undefined): boolean {
  return typeof email === 'string' && email.trim().toLowerCase().endsWith(`@${TEST_EMAIL_DOMAIN}`);
}

/**
 * Server side: a test email, or every run when CALCULATOR_TEST_MODE=1 is set on
 * the deployment (for example on Vercel previews). In the browser the variable
 * is never set, so this is the same as isTestEmail there.
 */
export function isTestLead(email: string | null | undefined): boolean {
  const testMode = typeof process !== 'undefined' && process.env.CALCULATOR_TEST_MODE === '1';
  return testMode || isTestEmail(email);
}
