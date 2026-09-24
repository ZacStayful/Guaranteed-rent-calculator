import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractPostcode,
  extractPostcodeArea,
  extractPostcodes,
  normalisePostcode,
} from './postcode.ts';

test('extracts a two-letter area from a full address', () => {
  assert.equal(extractPostcodeArea('123 Example St, Nottingham NG1 5GB'), 'NG');
});

test('extracts a single-letter London-style area', () => {
  assert.equal(extractPostcodeArea('E11 3LQ'), 'E');
});

test('extracts area from a bare postcode with no space', () => {
  assert.equal(extractPostcodeArea('LE16AA'), 'LE');
});

test('uppercases the captured area', () => {
  assert.equal(extractPostcodeArea('flat 2, m1 1ae'), 'M');
});

test('handles longer outward codes (letter suffix)', () => {
  assert.equal(extractPostcodeArea('EC1A 1BB'), 'EC');
});

test('returns null when no postcode is present', () => {
  assert.equal(extractPostcodeArea('123 Example Street, Some Town'), null);
});

test('returns null for a malformed / partial postcode', () => {
  assert.equal(extractPostcodeArea('NG1'), null);
});

test('returns null for empty input', () => {
  assert.equal(extractPostcodeArea(''), null);
});

// ─── Full postcode extraction ─────────────────────────────────────
// Every "(board)" case below is a verbatim Address value from the live
// Management Leads board — this is the real shape of the input.

const EXTRACT_CASES: Array<[string, string | null, string]> = [
  ['43-45 dickson road Blackpool FY12AT', 'FY1 2AT', 'no space (board)'],
  ['5 Molineaux Road, Ll18 3TY', 'LL18 3TY', 'wrong case (board)'],
  ['144 Swinton park road M67PA', 'M6 7PA', 'no space, single-letter area (board)'],
  ['3 ivy terrace ba151QW', 'BA15 1QW', 'lowercase, no space (board)'],
  ['68 shakespeare avenue, bath BA24RG', 'BA2 4RG', 'no space (board)'],
  ['Birmingham B12 9PY', 'B12 9PY', 'no street (board)'],
  ['1 Marlow avenue ct1 2qn', 'CT1 2QN', 'all lowercase (board)'],
  ['Flat 9 Riverside House Welshback Bs1 4rr', 'BS1 4RR', 'mixed case (board)'],
  ['Apartment 201 Northwest, 41 Talbot Street, Nottingham NG1 5GY', 'NG1 5GY', 'flat + house numbers (board)'],
  ['Flat 2, 6a Long Street, Tetbury, Gloucestershire Gl88aq', 'GL8 8AQ', 'flat + letter suffix (board)'],
  ['Ivy Cottage, Ferret Oak Lane, Haughton, Cheshire CW6 9RQ', 'CW6 9RQ', 'named house (board)'],
  ['EC1A 1BB', 'EC1A 1BB', 'letter-suffixed outward code'],
  ['Flat 2A, 12 Bank St, M1 1AE', 'M1 1AE', 'flat letter must not be mistaken for a postcode'],
  ['Sharrow Vale', null, 'no postcode at all (board)'],
  ['12 High St, Some Town', null, 'no postcode'],
  ['Somewhere in NG7', null, 'outward code only — never guessed'],
  ['', null, 'empty'],
];

for (const [input, expected, note] of EXTRACT_CASES) {
  test(`extractPostcode: ${note}`, () => {
    assert.equal(extractPostcode(input), expected);
  });
}

test('a duplicated postcode collapses to one (board)', () => {
  const input = "Logan's Court, Carbis Bay, Cornwall TR26 2QH TR26 2QH";
  assert.deepEqual(extractPostcodes(input), ['TR26 2QH']);
  assert.equal(extractPostcode(input), 'TR26 2QH');
});

test('two distinct postcodes are both surfaced so the caller can flag ambiguity', () => {
  const input = 'TR26 2QH somewhere near TR27 1AA';
  assert.deepEqual(extractPostcodes(input), ['TR26 2QH', 'TR27 1AA']);
  // extractPostcode takes the last, since a UK address ends with its postcode.
  assert.equal(extractPostcode(input), 'TR27 1AA');
});

test('extractPostcodes is not corrupted by the global regex lastIndex', () => {
  // A /g regex is stateful; calling twice must give the same answer.
  const input = '68 shakespeare avenue, bath BA24RG';
  assert.deepEqual(extractPostcodes(input), extractPostcodes(input));
  assert.equal(extractPostcode(input), 'BA2 4RG');
});

test('extractPostcode agrees with the existing extractPostcodeArea', () => {
  for (const [input, expected] of EXTRACT_CASES) {
    if (!expected) continue;
    assert.equal(extractPostcodeArea(input), expected.split(/\d/)[0]);
  }
});

const NORMALISE_CASES: Array<[string, string | null]> = [
  ['ll183ty', 'LL18 3TY'],
  ['LL18 3TY', 'LL18 3TY'],
  ['  m1  1ae ', 'M1 1AE'],
  ['FY12AT', 'FY1 2AT'],
  ['EC1A1BB', 'EC1A 1BB'],
  ['NG7', null],
  ['NOTAPOSTCODE', null],
  ['12345', null],
  ['', null],
];

for (const [input, expected] of NORMALISE_CASES) {
  test(`normalisePostcode: ${JSON.stringify(input)} -> ${expected}`, () => {
    assert.equal(normalisePostcode(input), expected);
  });
}
