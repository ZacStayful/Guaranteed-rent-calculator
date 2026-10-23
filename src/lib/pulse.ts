// ─── Stayful's own visit counter: a finished analysis ─────────────
//
// The website counts its visits itself, with no cookies, into the website's
// Supabase project (stayful-website, docs/build/pulse.md; batch 4 task 2).
// This calculator adds one thing to it: an analysis completed, with the
// stayful.co.uk page that sent the visitor ("from"), so the analytics page can
// count calculator leads per page. Never the email, the address or anything
// else typed into the form. It stores nothing on the device, so it does not
// wait for the cookie banner, like the website's counter.
//
// Only from the live address: a preview, a local build or a test run sends
// nothing (and the receiving function refuses any other origin).

import type { Attribution } from './linkParams.ts';

/** The website's fact pulseEndpoint (stayful-website, redesign/parity/_global.json). */
export const PULSE_ENDPOINT = 'https://cckfkcmjnpnxlxgunyfy.supabase.co/functions/v1/website-pulse';

/** The address this calculator is served at. */
export const LIVE_HOST = 'guaranteedrent.stayful.co.uk';

/** The name the analytics page shows for this calculator. */
export const CALCULATOR_NAME = 'guaranteed rent';

export interface CalculatorPulse {
  v: 1;
  t: 'act';
  kind: 'calculator';
  path: string;
  label: string;
  target: string;
  wd?: true;
}

/** The event for one finished analysis. target is the sending page, else the
 *  link's utm_source, else empty. */
export function calculatorPulse(attribution: Attribution | null, path = '/'): CalculatorPulse {
  const target = attribution?.from ?? (attribution?.utm_source ? `utm_source ${attribution.utm_source}` : '');
  return { v: 1, t: 'act', kind: 'calculator', path: path.split(/[?#]/)[0] || '/', label: CALCULATOR_NAME, target };
}

/** Browser only: sends the event from the live address; anywhere else, nothing. */
export function sendCalculatorPulse(attribution: Attribution | null): void {
  if (typeof window === 'undefined' || window.location.hostname !== LIVE_HOST) return;
  const event = calculatorPulse(attribution, window.location.pathname);
  // An automated browser: the function drops it, as it does for the website's.
  if (navigator.webdriver === true) event.wd = true;
  const body = JSON.stringify(event);
  try {
    if (navigator.sendBeacon && navigator.sendBeacon(PULSE_ENDPOINT, body)) return;
  } catch {
    // fall back to fetch
  }
  try {
    void fetch(PULSE_ENDPOINT, {
      method: 'POST',
      body,
      keepalive: true,
      mode: 'no-cors',
      credentials: 'omit',
      headers: { 'content-type': 'text/plain' },
    }).catch(() => {});
  } catch {
    // nothing more to try
  }
}
