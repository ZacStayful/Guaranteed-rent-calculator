import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isTestEmail,
  isTestLead,
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
