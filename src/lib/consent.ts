// ─── Cookie consent, shared with www.stayful.co.uk ────────────────
//
// The Meta pixel, Google Analytics and the session tracker's stored sessions
// wait until the visitor presses Accept (website build plan, batch 4 task 1;
// Zac 2026-10-23). The choice is the cookie the website's own banner writes
// (stayful-website, public/js/consent.js): stayful_consent=yes.1 or no.1 on
// .stayful.co.uk for six months, so a choice made on www holds here and the
// other way round. The number after the dot is the banner's version: when the
// website asks again because a new service was added it raises it, and
// CONSENT_VERSION here must follow, or this site would read every choice as
// "not asked yet".
//
// Shared by the banner (src/components/Consent.tsx), the session tracker
// (src/lib/tracker.ts) and the tests, so keep it free of React and of
// server-only imports.

/** The banner's words: the website's, word for word. They live in
 *  stayful-website's redesign/parity/_global.json (facts cookieBanner,
 *  cookiePolicyLink, cookieAccept, cookieReject, cookieSettings); change them
 *  there first. They name Lucky Orange and Tawk, which run only on www, because
 *  one Accept here lets them run there too. */
export const CONSENT_TEXT = {
  banner:
    'We use cookies to see how people find and use this site, to measure and show our adverts (Google and Meta), to record visits so we can improve the site (Lucky Orange), and for our chat box (Tawk).',
  policy: 'Cookie policy',
  accept: 'Accept',
  reject: 'Reject',
  settings: 'Cookie settings',
} as const;

export const COOKIE_POLICY_URL = 'https://www.stayful.co.uk/cookie-policy';

export const CONSENT_COOKIE = 'stayful_consent';
export const CONSENT_VERSION = '1';
export const CONSENT_MAX_AGE = 182 * 24 * 60 * 60;

export type ConsentChoice = 'yes' | 'no';

/** The visitor's choice from a cookie string, or null when they have not been
 *  asked (or were asked by an older banner). */
export function readConsent(cookie: string | null | undefined): ConsentChoice | null {
  const m = /(?:^|;\s*)stayful_consent=([^;]*)/.exec(cookie || '');
  if (!m) return null;
  let value: string;
  try {
    value = decodeURIComponent(m[1]);
  } catch {
    return null;
  }
  const [choice, version] = value.split('.');
  if (version !== CONSENT_VERSION) return null;
  return choice === 'yes' || choice === 'no' ? choice : null;
}

/** On stayful.co.uk or one of its subdomains: the cookie then goes on
 *  .stayful.co.uk, where every Stayful site reads it. Anywhere else (a Vercel
 *  preview, localhost) it stays on that host. */
export function onStayfulDomain(hostname: string): boolean {
  return /(^|\.)stayful\.co\.uk$/.test(hostname);
}

/** The Set-Cookie text, for document.cookie, that records a choice. */
export function consentCookie(choice: ConsentChoice, where: { hostname: string; protocol: string }): string {
  return (
    `${CONSENT_COOKIE}=${choice}.${CONSENT_VERSION}; max-age=${CONSENT_MAX_AGE}; path=/` +
    (onStayfulDomain(where.hostname) ? '; domain=.stayful.co.uk' : '') +
    '; samesite=lax' +
    (where.protocol === 'https:' ? '; secure' : '')
  );
}

/** The cookies Google Analytics, Google Ads and Meta set (and, on www, Lucky
 *  Orange and Tawk): the same list as the website's banner. */
export const TRACKING_COOKIES = /^(_ga|_gid|_gat|_gcl_|_fbp|_fbc|_lo_|_lorid|__lo|twk_|TawkConnectionTime)/;

/** The document.cookie texts that remove every tracking cookie present, on
 *  this host and, under stayful.co.uk, on .stayful.co.uk too. */
export function expireTrackingCookies(cookie: string | null | undefined, hostname: string): string[] {
  const names = (cookie || '')
    .split(';')
    .map((c) => c.split('=')[0].trim())
    .filter((n) => n && TRACKING_COOKIES.test(n));
  const domains = ['', `; domain=${hostname}`];
  if (onStayfulDomain(hostname)) domains.push('; domain=.stayful.co.uk');
  return [...new Set(names)].flatMap((n) => domains.map((d) => `${n}=; max-age=0; path=/${d}`));
}

/** Browser only: whether the visitor has pressed Accept. False on the server. */
export function consentGranted(): boolean {
  return typeof document !== 'undefined' && readConsent(document.cookie) === 'yes';
}
