import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONSENT_TEXT,
  consentCookie,
  consentGranted,
  expireTrackingCookies,
  onStayfulDomain,
  readConsent,
} from './consent.ts';
import { calculatorPulse, sendCalculatorPulse } from './pulse.ts';

// ── Reading the choice ────────────────────────────────────────────

test('reads a yes or a no written by the website or by this site', () => {
  assert.equal(readConsent('stayful_consent=yes.1'), 'yes');
  assert.equal(readConsent('_ga=GA1.1.1; stayful_consent=no.1; other=1'), 'no');
  assert.equal(readConsent('stayful_consent=yes%2E1'), 'yes');
});

test('no cookie, an older banner or a damaged value counts as not asked yet', () => {
  assert.equal(readConsent(''), null);
  assert.equal(readConsent(undefined), null);
  assert.equal(readConsent('stayful_consent=yes.0'), null);
  assert.equal(readConsent('stayful_consent=yes'), null);
  assert.equal(readConsent('stayful_consent=maybe.1'), null);
  assert.equal(readConsent('stayful_consent=%E0%A4%A.1'), null);
  assert.equal(readConsent('not_stayful_consent=yes.1'), null);
});

// ── Writing the choice ────────────────────────────────────────────

test('on the live address the choice goes on .stayful.co.uk, secure, for six months', () => {
  assert.equal(
    consentCookie('yes', { hostname: 'guaranteedrent.stayful.co.uk', protocol: 'https:' }),
    'stayful_consent=yes.1; max-age=15724800; path=/; domain=.stayful.co.uk; samesite=lax; secure',
  );
});

test('on a preview or localhost it stays on that host', () => {
  assert.equal(
    consentCookie('no', { hostname: 'guaranteed-rent-calculator.vercel.app', protocol: 'https:' }),
    'stayful_consent=no.1; max-age=15724800; path=/; samesite=lax; secure',
  );
  assert.equal(
    consentCookie('no', { hostname: 'localhost', protocol: 'http:' }),
    'stayful_consent=no.1; max-age=15724800; path=/; samesite=lax',
  );
});

test('only stayful.co.uk and its subdomains share the choice', () => {
  assert.equal(onStayfulDomain('stayful.co.uk'), true);
  assert.equal(onStayfulDomain('www.stayful.co.uk'), true);
  assert.equal(onStayfulDomain('notstayful.co.uk'), false);
  assert.equal(onStayfulDomain('stayful.co.uk.example.com'), false);
});

// ── Reject ────────────────────────────────────────────────────────

test('Reject removes the tracking cookies on the host and on .stayful.co.uk, and nothing else', () => {
  const out = expireTrackingCookies(
    '_ga=GA1.1.2; _ga_ZFC7PTYMP9=GS1; _fbp=fb.1; stayful_consent=no.1; sb-auth=keep; _gcl_au=1',
    'guaranteedrent.stayful.co.uk',
  );
  assert.deepEqual(out, [
    '_ga=; max-age=0; path=/',
    '_ga=; max-age=0; path=/; domain=guaranteedrent.stayful.co.uk',
    '_ga=; max-age=0; path=/; domain=.stayful.co.uk',
    '_ga_ZFC7PTYMP9=; max-age=0; path=/',
    '_ga_ZFC7PTYMP9=; max-age=0; path=/; domain=guaranteedrent.stayful.co.uk',
    '_ga_ZFC7PTYMP9=; max-age=0; path=/; domain=.stayful.co.uk',
    '_fbp=; max-age=0; path=/',
    '_fbp=; max-age=0; path=/; domain=guaranteedrent.stayful.co.uk',
    '_fbp=; max-age=0; path=/; domain=.stayful.co.uk',
    '_gcl_au=; max-age=0; path=/',
    '_gcl_au=; max-age=0; path=/; domain=guaranteedrent.stayful.co.uk',
    '_gcl_au=; max-age=0; path=/; domain=.stayful.co.uk',
  ]);
  assert.deepEqual(expireTrackingCookies('', 'localhost'), []);
});

// ── The words ─────────────────────────────────────────────────────

test('the banner has the website\'s words and no em dash', () => {
  assert.match(CONSENT_TEXT.banner, /^We use cookies to see how people find and use this site/);
  assert.equal(CONSENT_TEXT.accept, 'Accept');
  assert.equal(CONSENT_TEXT.reject, 'Reject');
  for (const words of Object.values(CONSENT_TEXT)) assert.doesNotMatch(words, /\u2014/);
});

// ── Browser only ──────────────────────────────────────────────────

function withGlobals<T>(globals: Record<string, unknown>, fn: () => T): T {
  const g = globalThis as Record<string, unknown>;
  const before = Object.fromEntries(Object.keys(globals).map((k) => [k, Object.getOwnPropertyDescriptor(g, k)]));
  for (const [k, v] of Object.entries(globals)) Object.defineProperty(g, k, { value: v, configurable: true, writable: true });
  try {
    return fn();
  } finally {
    for (const [k, d] of Object.entries(before)) {
      if (d) Object.defineProperty(g, k, d);
      else delete g[k];
    }
  }
}

test('consentGranted is false on the server and follows the cookie in a browser', () => {
  assert.equal(consentGranted(), false);
  assert.equal(withGlobals({ document: { cookie: 'stayful_consent=yes.1' } }, consentGranted), true);
  assert.equal(withGlobals({ document: { cookie: 'stayful_consent=no.1' } }, consentGranted), false);
});

// ── The visit counter ─────────────────────────────────────────────

test('a finished analysis is counted with the sending page, never the visitor\'s details', () => {
  assert.deepEqual(calculatorPulse({ from: '/airbnb-management-leeds', utm_source: 'facebook' }), {
    v: 1, t: 'act', kind: 'calculator', path: '/', label: 'guaranteed rent', target: '/airbnb-management-leeds',
  });
  assert.equal(calculatorPulse({ utm_source: 'facebook' }).target, 'utm_source facebook');
  assert.equal(calculatorPulse(null).target, '');
  assert.equal(calculatorPulse(null, '/?email=a@b.co').path, '/');
});

function beaconWorld(hostname: string, webdriver = false) {
  const sent: { url: string; body: string }[] = [];
  const globals = {
    window: { location: { hostname, pathname: '/' } },
    navigator: { webdriver, sendBeacon: (url: string, body: string) => (sent.push({ url, body }), true) },
  };
  return { sent, run: () => withGlobals(globals, () => sendCalculatorPulse({ from: '/pricing' })) };
}

test('the count is sent from the live address only', () => {
  const live = beaconWorld('guaranteedrent.stayful.co.uk');
  live.run();
  assert.equal(live.sent.length, 1);
  assert.equal(live.sent[0].url, 'https://cckfkcmjnpnxlxgunyfy.supabase.co/functions/v1/website-pulse');
  assert.deepEqual(JSON.parse(live.sent[0].body), {
    v: 1, t: 'act', kind: 'calculator', path: '/', label: 'guaranteed rent', target: '/pricing',
  });

  for (const host of ['guaranteed-rent-calculator.vercel.app', 'localhost', 'guaranteed-rent-calculator-git-x.vercel.app']) {
    const other = beaconWorld(host);
    other.run();
    assert.equal(other.sent.length, 0, host);
  }
});

test('an automated browser is marked, so the counter drops it', () => {
  const robot = beaconWorld('guaranteedrent.stayful.co.uk', true);
  robot.run();
  assert.equal(JSON.parse(robot.sent[0].body).wd, true);
});
