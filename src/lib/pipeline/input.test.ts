import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultGuests, normaliseAnalysisInput } from './input.ts';

function valid(overrides: Record<string, unknown> = {}) {
  return {
    address: '12 High Street, Nottingham NG1 5GY',
    postcode: 'NG1 5GY',
    bedrooms: 2,
    guests: 6,
    ...overrides,
  };
}

// ─── Validation parity ────────────────────────────────────────────
// These messages are returned to the browser verbatim as 400 responses by
// /api/analyse. Changing the wording here changes what a user sees.

test('accepts a well-formed body', () => {
  const result = normaliseAnalysisInput(valid());
  assert.equal(result.ok, true);
});

const REJECTIONS: Array<[Record<string, unknown>, string, string]> = [
  [valid({ address: '' }), 'A valid property address is required.', 'empty address'],
  [valid({ address: '   ' }), 'A valid property address is required.', 'whitespace address'],
  [valid({ address: 123 }), 'A valid property address is required.', 'non-string address'],
  [valid({ postcode: 'NG' }), 'A valid UK postcode is required.', 'postcode under 3 chars'],
  [valid({ postcode: undefined }), 'A valid UK postcode is required.', 'missing postcode'],
  [valid({ bedrooms: 11 }), 'Bedrooms must be a number between 0 and 10.', 'bedrooms above 10'],
  [valid({ bedrooms: -1 }), 'Bedrooms must be a number between 0 and 10.', 'negative bedrooms'],
  [valid({ bedrooms: 'lots' }), 'Bedrooms must be a number between 0 and 10.', 'non-numeric bedrooms'],
  [valid({ guests: 17 }), 'Guests must be a number between 1 and 16.', 'guests above 16'],
  [valid({ guests: 0 }), 'Guests must be a number between 1 and 16.', 'zero guests'],
];

for (const [body, expected, note] of REJECTIONS) {
  test(`rejects ${note}`, () => {
    const result = normaliseAnalysisInput(body);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.error, expected);
  });
}

test('validation order matches the route: address before postcode before bedrooms', () => {
  // A body broken in several ways must report the FIRST problem, as the
  // original inline validation did.
  const result = normaliseAnalysisInput({ address: '', postcode: '', bedrooms: 99, guests: 99 });
  assert.equal(result.ok === false && result.error, 'A valid property address is required.');

  const result2 = normaliseAnalysisInput({ address: 'x', postcode: '', bedrooms: 99, guests: 99 });
  assert.equal(result2.ok === false && result2.error, 'A valid UK postcode is required.');

  const result3 = normaliseAnalysisInput({ address: 'x', postcode: 'NG1 5GY', bedrooms: 99, guests: 99 });
  assert.equal(result3.ok === false && result3.error, 'Bedrooms must be a number between 0 and 10.');
});

// ─── Mapping parity ───────────────────────────────────────────────

test('trims the address and uppercases the postcode', () => {
  const result = normaliseAnalysisInput(valid({ address: '  12 High St  ', postcode: 'ng1 5gy' }));
  assert.ok(result.ok);
  assert.equal(result.input.property.address, '12 High St');
  assert.equal(result.input.property.postcode, 'NG1 5GY');
});

test('maps property types to the PropertyData vocabulary', () => {
  const cases: Array<[string | undefined, string]> = [
    ['Flat', 'flat'],
    ['Terraced', 'terraced_house'],
    ['Semi-detached', 'semi-detached_house'],
    ['Detached', 'detached_house'],
    ['Terraced House', 'terraced_house'], // legacy
    ['Semi-Detached House', 'semi-detached_house'], // legacy
    ['Detached House', 'detached_house'], // legacy
    ['nonsense', 'flat'], // unknown falls back
    [undefined, 'flat'], // absent falls back
  ];
  for (const [input, expected] of cases) {
    const result = normaliseAnalysisInput(valid({ propertyType: input }));
    assert.ok(result.ok);
    assert.equal(result.input.mappedPropertyType, expected, `propertyType=${input}`);
  }
});

test('maps parking to its numeric value and hasParking flag', () => {
  const cases: Array<[string, number, boolean]> = [
    ['no_parking', 0, false],
    ['on_street', 0, false],
    ['allocated', 1, true],
    ['garage', 1, true],
    ['driveway_1', 1, true],
    ['driveway_2', 2, true],
    ['unknown', 0, false],
  ];
  for (const [input, value, has] of cases) {
    const result = normaliseAnalysisInput(valid({ parking: input }));
    assert.ok(result.ok);
    assert.equal(result.input.parkingValue, value, `parking=${input}`);
    assert.equal(result.input.validHasParking, has, `parking=${input}`);
  }
});

test('maps outdoor space to the PropertyData vocabulary', () => {
  const cases: Array<[string | undefined, string]> = [
    ['none', 'none'],
    ['balcony', 'balcony_terrace'],
    ['roof_terrace', 'balcony_terrace'],
    ['garden', 'garden'],
    [undefined, 'none'],
  ];
  for (const [input, expected] of cases) {
    const result = normaliseAnalysisInput(valid({ outdoorSpace: input }));
    assert.ok(result.ok);
    assert.equal(result.input.validOutdoorSpace, expected, `outdoorSpace=${input}`);
  }
});

test('finish quality is pinned to average', () => {
  // Was 'very_high', which applied a 1.38x multiplier to every estimate.
  const result = normaliseAnalysisInput(valid({ finishQuality: 'very_high' }));
  assert.ok(result.ok);
  assert.equal(result.input.validFinishQuality, 'average');
});

test('bathrooms below 1 are treated as absent', () => {
  for (const [input, expected] of [[0, undefined], [0.5, undefined], [2, 2], ['x', undefined]] as const) {
    const result = normaliseAnalysisInput(valid({ bathrooms: input }));
    assert.ok(result.ok);
    assert.equal(result.input.validBathrooms, expected, `bathrooms=${input}`);
  }
});

test('a long-let figure is only honoured when positive and not "not sure"', () => {
  const withFigure = normaliseAnalysisInput(valid({ longLetMonthly: 1200 }));
  assert.ok(withFigure.ok);
  assert.equal(withFigure.input.hasLongLetMonthly, true);

  const notSure = normaliseAnalysisInput(valid({ longLetMonthly: 1200, longLetNotSure: true }));
  assert.ok(notSure.ok);
  assert.equal(notSure.input.hasLongLetMonthly, false);

  // "0" is the most common value in the Monday Rent/Mortgage column and must
  // never be treated as a real rent — it would make the uplift meaningless.
  const zero = normaliseAnalysisInput(valid({ longLetMonthly: 0 }));
  assert.ok(zero.ok);
  assert.equal(zero.input.hasLongLetMonthly, false);

  const absent = normaliseAnalysisInput(valid());
  assert.ok(absent.ok);
  assert.equal(absent.input.hasLongLetMonthly, false);
});

test('email is only kept when it looks like an address', () => {
  const good = normaliseAnalysisInput(valid({ email: '  Z@x.com ' }));
  assert.ok(good.ok);
  assert.equal(good.input.email, 'Z@x.com');

  const bad = normaliseAnalysisInput(valid({ email: 'not-an-email' }));
  assert.ok(bad.ok);
  assert.equal(bad.input.email, null);
});

// ─── defaultGuests ────────────────────────────────────────────────

test('defaultGuests mirrors the public form (beds x 2 + 2)', () => {
  assert.equal(defaultGuests(1), 4);
  assert.equal(defaultGuests(2), 6);
  assert.equal(defaultGuests(5), 12);
});

test('defaultGuests clamps so a large spreadsheet row stays runnable', () => {
  // The form caps bedrooms at 5 so it never overflows; a spreadsheet can carry
  // 8, which would derive 18 guests and fail validation.
  assert.equal(defaultGuests(8), 16);
  assert.equal(defaultGuests(10), 16);
  assert.equal(defaultGuests(0), 2);
  const result = normaliseAnalysisInput(valid({ bedrooms: 8, guests: defaultGuests(8) }));
  assert.equal(result.ok, true);
});
