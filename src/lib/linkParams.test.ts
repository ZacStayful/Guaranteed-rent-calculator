import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isTestEmail,
  isTestLead,
  PREFILL_GUARD_SCRIPT,
  prefillSearch,
  readAttribution,
  readPrefill,
  sanitiseAttribution,
  splitPostcodeFromAddress,
} from './linkParams.ts';

// ── Pre-fill ──────────────────────────────────────────────────────

test('reads the example link from the build plan', () => {
  const search =
    '?address=12%20High%20Street,%20Leeds%20LS1%204AB&email=test@test.stayful.co.uk&bedrooms=2&utm_source=test&from=/airbnb-management-leeds';
  assert.deepEqual(readPrefill(search), {
    address: '12 High Street, Leeds',
    postcode: 'LS1 4AB',
    email: 'test@test.stayful.co.uk',
    bedrooms: 2,
  });
});

test('a plus sign in the link reads as a space', () => {
  assert.equal(readPrefill('?address=12+High+Street').address, '12 High Street');
});

test('splits a postcode with no space, in lower case, and drops a trailing UK', () => {
  assert.deepEqual(splitPostcodeFromAddress('Flat 2, 5 Mill Lane, ls14ab, UK'), {
    street: 'Flat 2, 5 Mill Lane',
    postcode: 'LS1 4AB',
  });
});

test('tidies the commas left where a postcode sat mid-address', () => {
  assert.deepEqual(splitPostcodeFromAddress('5 Mill Lane, LS1 4AB, Leeds'), {
    street: '5 Mill Lane, Leeds',
    postcode: 'LS1 4AB',
  });
});

test('an address that is only a postcode gives a postcode and no street', () => {
  assert.deepEqual(readPrefill('?address=M4%207FE'), { postcode: 'M4 7FE' });
});

test('an explicit postcode wins over one inside the address', () => {
  const p = readPrefill('?address=12%20High%20Street%20LS1%204AB&postcode=ls2%209jt');
  assert.equal(p.address, '12 High Street');
  assert.equal(p.postcode, 'LS2 9JT');
});

test('ignores an invalid postcode and keeps the address', () => {
  assert.deepEqual(readPrefill('?address=12%20High%20Street&postcode=NOTAPOSTCODE'), {
    address: '12 High Street',
  });
});

test('ignores an address that is too long', () => {
  assert.equal(readPrefill(`?address=${'a'.repeat(201)}`).address, undefined);
});

test('bedrooms 0 to 5 and bathrooms 1 to 5, whole numbers only', () => {
  assert.equal(readPrefill('?bedrooms=0').bedrooms, 0);
  assert.equal(readPrefill('?bedrooms=5').bedrooms, 5);
  assert.equal(readPrefill('?bedrooms=6').bedrooms, undefined);
  assert.equal(readPrefill('?bedrooms=2.5').bedrooms, undefined);
  assert.equal(readPrefill('?bedrooms=two').bedrooms, undefined);
  assert.equal(readPrefill('?bedrooms=-1').bedrooms, undefined);
  assert.equal(readPrefill('?bathrooms=1').bathrooms, 1);
  assert.equal(readPrefill('?bathrooms=0').bathrooms, undefined);
  assert.equal(readPrefill('?bathrooms=6').bathrooms, undefined);
});

test('property type is matched loosely to the four form options', () => {
  assert.equal(readPrefill('?type=Flat').propertyType, 'Flat');
  assert.equal(readPrefill('?type=semi%20detached').propertyType, 'Semi-detached');
  assert.equal(readPrefill('?type=Semi-Detached+House').propertyType, 'Semi-detached');
  assert.equal(readPrefill('?type=terraced').propertyType, 'Terraced');
  assert.equal(readPrefill('?type=DETACHED').propertyType, 'Detached');
  assert.equal(readPrefill('?type=bungalow').propertyType, undefined);
});

test('rejects an email that is not email-shaped', () => {
  assert.equal(readPrefill('?email=not-an-email').email, undefined);
  assert.equal(readPrefill('?email=a@b').email, undefined);
  assert.equal(readPrefill('?email=jane%40example.co.uk').email, 'jane@example.co.uk');
});

test('desired rent in whole pounds, within reason', () => {
  assert.equal(readPrefill('?rent=1200').desiredRent, 1200);
  assert.equal(readPrefill('?rent=%C2%A31,250').desiredRent, 1250);
  assert.equal(readPrefill('?rent=1200.50').desiredRent, 1201);
  assert.equal(readPrefill('?rent=0').desiredRent, undefined);
  assert.equal(readPrefill('?rent=-500').desiredRent, undefined);
  assert.equal(readPrefill('?rent=lots').desiredRent, undefined);
  assert.equal(readPrefill('?rent=50001').desiredRent, undefined);
});

test('a demo link pre-fills nothing', () => {
  assert.deepEqual(readPrefill('?demo=true&email=jane@example.co.uk&bedrooms=3'), {});
});

test('a bare link pre-fills nothing', () => {
  assert.deepEqual(readPrefill(''), {});
});

// ── Lead source ───────────────────────────────────────────────────

test('reads every UTM tag and the sending page', () => {
  const search =
    '?utm_source=facebook&utm_medium=paid&utm_campaign=leeds-oct&utm_content=video1&utm_term=airbnb+management&from=/airbnb-management-leeds';
  assert.deepEqual(readAttribution(search), {
    utm_source: 'facebook',
    utm_medium: 'paid',
    utm_campaign: 'leeds-oct',
    utm_content: 'video1',
    utm_term: 'airbnb management',
    from: '/airbnb-management-leeds',
  });
});

test('no source fields gives null', () => {
  assert.equal(readAttribution('?address=12%20High%20Street'), null);
  assert.equal(readAttribution('?utm_source=%20%20'), null);
});

test('a full stayful.co.uk address is reduced to its path', () => {
  assert.equal(
    readAttribution('?from=https://www.stayful.co.uk/airbnb-management-leeds?x=1')?.from,
    '/airbnb-management-leeds',
  );
});

test('a page on another site, or junk, is dropped', () => {
  assert.equal(readAttribution('?from=https://evil.example/stayful.co.uk'), null);
  assert.equal(readAttribution('?from=//evil.example/page'), null);
  assert.equal(readAttribution('?from=javascript:alert(1)'), null);
});

test('long tags are capped and control characters removed', () => {
  const a = sanitiseAttribution({ utm_campaign: `${'x'.repeat(200)}`, utm_source: 'face\u0000book\n' });
  assert.equal(a?.utm_campaign?.length, 150);
  assert.equal(a?.utm_source, 'face book');
});

test('sanitise ignores unknown keys and non-objects', () => {
  assert.deepEqual(sanitiseAttribution({ utm_source: 'test', admin: 'yes' }), { utm_source: 'test' });
  assert.equal(sanitiseAttribution('utm_source=test'), null);
  assert.equal(sanitiseAttribution(null), null);
  assert.equal(sanitiseAttribution({ utm_source: 42 }), null);
});

// ── Test leads ────────────────────────────────────────────────────

test('test emails are recognised in any case', () => {
  assert.equal(isTestEmail('zac@test.stayful.co.uk'), true);
  assert.equal(isTestEmail(' Zac@TEST.Stayful.co.uk '), true);
  assert.equal(isTestEmail('zac@stayful.co.uk'), false);
  assert.equal(isTestEmail('zac@nottest.stayful.co.uk'), false);
  assert.equal(isTestEmail(null), false);
});

test('CALCULATOR_TEST_MODE=1 makes every run a test lead', () => {
  const before = process.env.CALCULATOR_TEST_MODE;
  try {
    process.env.CALCULATOR_TEST_MODE = '1';
    assert.equal(isTestLead('jane@example.co.uk'), true);
    delete process.env.CALCULATOR_TEST_MODE;
    assert.equal(isTestLead('jane@example.co.uk'), false);
    assert.equal(isTestLead('jane@test.stayful.co.uk'), true);
  } finally {
    if (before === undefined) delete process.env.CALCULATOR_TEST_MODE;
    else process.env.CALCULATOR_TEST_MODE = before;
  }
});

// ── Keeping the visitor's details out of the address bar ─────────

// A stand-in browser: an address bar, history.replaceState and session storage.
function fakeBrowser(href: string, storage = new Map<string, string>()) {
  const w: Record<string, unknown> = {};
  const setHref = (h: string) => {
    const u = new URL(h, 'https://calculator.stayful.co.uk');
    w.location = { href: u.href, pathname: u.pathname, search: u.search, hash: u.hash };
  };
  setHref(href);
  w.history = { state: null, replaceState: (_s: unknown, _t: string, url: string) => setHref(url) };
  w.sessionStorage = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
  };
  return { w, storage, run: () => new Function('window', PREFILL_GUARD_SCRIPT)(w) };
}

function withWindow<T>(w: Record<string, unknown>, fn: () => T): T {
  const g = globalThis as Record<string, unknown>;
  const before = g.window;
  g.window = w;
  try { return fn(); } finally { if (before === undefined) delete g.window; else g.window = before; }
}

const LINK = '/?address=10%20Park%20Square%20East&postcode=LS1%202LH&email=jo%40example.co.uk&bedrooms=2&from=%2Fairbnb-management-leeds&utm_source=google';

test('the email, address and postcode leave the address bar; everything else stays', () => {
  const b = fakeBrowser(LINK);
  b.run();
  const loc = b.w.location as { pathname: string; search: string };
  assert.equal(loc.pathname + loc.search, '/?bedrooms=2&from=%2Fairbnb-management-leeds&utm_source=google');
  assert.doesNotMatch(String((b.w.location as { href: string }).href), /example\.co\.uk|Park|LS1/);
});

test('the page still reads the whole link, so the form is pre-filled as before', () => {
  const b = fakeBrowser(LINK);
  b.run();
  b.run(); // the pixel's script runs it again: no change
  const search = withWindow(b.w, () => prefillSearch());
  assert.deepEqual(readPrefill(search), { address: '10 Park Square East', postcode: 'LS1 2LH', email: 'jo@example.co.uk', bedrooms: 2 });
  assert.deepEqual(readAttribution(search), { utm_source: 'google', from: '/airbnb-management-leeds' });
});

test('a reload of the cleaned address finds the details again; another page does not', () => {
  const first = fakeBrowser(LINK);
  first.run();
  const clean = (first.w.location as { pathname: string; search: string });
  const reload = fakeBrowser(clean.pathname + clean.search, first.storage);
  reload.run();
  assert.equal(readPrefill(withWindow(reload.w, () => prefillSearch())).email, 'jo@example.co.uk');
  const other = fakeBrowser('/?demo=manchester', first.storage);
  other.run();
  assert.equal(readPrefill(withWindow(other.w, () => prefillSearch())).email, undefined);
  assert.equal(first.storage.size, 0, 'the kept details are dropped');
});

test('a link without personal details is left alone', () => {
  const b = fakeBrowser('/?bedrooms=3&utm_source=meta');
  b.run();
  assert.equal((b.w.location as { search: string }).search, '?bedrooms=3&utm_source=meta');
  assert.equal(b.storage.size, 0);
  assert.equal(withWindow(b.w, () => prefillSearch()), '?bedrooms=3&utm_source=meta');
});

test('blocked session storage: the address bar is still cleaned and this page load still pre-fills', () => {
  const b = fakeBrowser(LINK);
  b.w.sessionStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
  b.run();
  assert.doesNotMatch((b.w.location as { search: string }).search, /email|address|postcode/);
  assert.equal(readPrefill(withWindow(b.w, () => prefillSearch())).postcode, 'LS1 2LH');
});
