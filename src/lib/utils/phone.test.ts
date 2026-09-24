import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseUkPhone, ukPhoneKey, ukPhoneSearchVariants } from './phone.ts';

// Every "real board" case below was taken from live Management Leads rows.
const UK_CASES: Array<[string, string, string]> = [
  // input                     national         note
  ['+447896959558', '07896959558', 'e164 mobile'],
  ['447456850528', '07456850528', 'country code, no plus (real board)'],
  ['+4407896959558', '07896959558', '+44 followed by trunk zero (real board)'],
  ['+4407718895193', '07718895193', '+44 followed by trunk zero (real board)'],
  ['07702618284', '07702618284', 'plain national (real board)'],
  ['0044 7123 456789', '07123456789', '00 international prefix'],
  ['+44 (0)7123 456789', '07123456789', 'bracketed trunk zero'],
  ['+44 7123 456789', '07123456789', 'spaced'],
  ['07123 456789', '07123456789', 'spaced national'],
  ['07123-456-789', '07123456789', 'dashed'],
  ['7123456789', '07123456789', 'Excel ate the leading zero'],
  ['0115 960 0000', '01159600000', 'landline'],
  ['  +447984670995  ', '07984670995', 'surrounding whitespace'],
];

for (const [input, expected, note] of UK_CASES) {
  test(`normaliseUkPhone: ${note} — ${input}`, () => {
    const result = normaliseUkPhone(input);
    assert.ok(result, `expected ${input} to normalise, got null`);
    assert.equal(result.national, expected);
    assert.equal(result.e164, `+44${expected.slice(1)}`);
    assert.equal(result.significant, expected.slice(1));
  });
}

// Non-UK numbers must return null rather than being coerced into a
// wrong-but-plausible UK number. All three appear on the live board.
const REJECTED: Array<[unknown, string]> = [
  ['+34606102164', 'Spanish (real board)'],
  ['+12046982467', 'North American (real board)'],
  ['491748140802', 'German (real board)'],
  ['', 'empty string'],
  ['   ', 'whitespace only'],
  ['not a phone', 'no digits'],
  ['12345', 'too short'],
  ['012345678901234', 'too long'],
  [null, 'null'],
  [undefined, 'undefined'],
  [12345 as unknown, 'non-string'],
];

for (const [input, note] of REJECTED) {
  test(`normaliseUkPhone rejects: ${note}`, () => {
    assert.equal(normaliseUkPhone(input as string | null | undefined), null);
  });
}

test('all UK variants of the same number share one comparison key', () => {
  const variants = [
    '+447896959558',
    '447896959558',
    '+4407896959558',
    '07896959558',
    '7896959558',
    '+44 (0)7896 959558',
    '00447896959558',
  ];
  const keys = new Set(variants.map(ukPhoneKey));
  assert.equal(keys.size, 1, `expected one key, got ${[...keys].join(', ')}`);
  assert.equal([...keys][0], '07896959558');
});

test('ukPhoneSearchVariants covers every shape seen on the live board', () => {
  const phone = normaliseUkPhone('07896959558');
  assert.ok(phone);
  const variants = ukPhoneSearchVariants(phone);
  assert.equal(new Set(variants).size, variants.length, 'variants must be deduped');
  // All six formats found in a 50-row sample of the Phone column.
  const boardShapes = [
    '+447896959558', // proper E.164
    '+4407896959558', // +44 then national incl. trunk zero
    '447896959558', // 44 then significant
    '4407896959558', // 44 then national incl. trunk zero
    '07896959558', // plain national
    '7896959558', // significant only
  ];
  for (const expected of boardShapes) {
    assert.ok(variants.includes(expected), `missing variant ${expected}`);
  }
});

test('ukPhoneKey returns null for unparseable input', () => {
  assert.equal(ukPhoneKey('+34606102164'), null);
  assert.equal(ukPhoneKey(null), null);
});
