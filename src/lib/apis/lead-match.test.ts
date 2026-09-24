import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  houseTokens,
  resolveLeadFromCandidates,
  type CandidateSets,
  type LeadCandidate,
} from './lead-match.ts';

function lead(partial: Partial<LeadCandidate> & { id: string }): LeadCandidate {
  return { email: '', address: '', phone: '', altPhone: '', ...partial };
}

function sets(partial: Partial<CandidateSets> = {}): CandidateSets {
  return { byEmail: [], byPhone: [], byPostcode: [], ...partial };
}

// ─── houseTokens ──────────────────────────────────────────────────

test('houseTokens finds the house number behind a flat number', () => {
  // The original leadingToken returned "FLAT" here and never matched.
  assert.deepEqual([...houseTokens('Flat 3, 12 High Street')].sort(), ['12', '3']);
});

test('houseTokens strips the postcode so it cannot be used as a house number', () => {
  // Without stripping, every address in NG1 5GY would "match" every other.
  assert.deepEqual([...houseTokens('41 Talbot Street, Nottingham NG1 5GY')], ['41']);
});

test('houseTokens strips the compact spelling of a postcode too', () => {
  assert.deepEqual([...houseTokens('144 Swinton park road M67PA')], ['144']);
});

test('houseTokens keeps letter-suffixed house numbers', () => {
  assert.deepEqual([...houseTokens('3a Peveril Street')], ['3A']);
});

test('houseTokens is empty for an address with no numbers', () => {
  assert.equal(houseTokens('Ivy Cottage, Oak Lane').size, 0);
  assert.equal(houseTokens(null).size, 0);
  assert.equal(houseTokens(undefined).size, 0);
});

// ─── Existing precedence branches — must not regress ──────────────
// One case per branch of the original findLeadItemId (monday.ts:283-308).

test('tier 1: email and postcode agree (original behaviour)', () => {
  const target = lead({ id: 'A', email: 'z@x.com', address: '12 High St, NG1 5GY' });
  const result = resolveLeadFromCandidates(
    sets({ byEmail: [target, lead({ id: 'B' })], byPostcode: [lead({ id: 'C' }), target] }),
    { email: 'z@x.com', postcode: 'NG1 5GY' },
  );
  assert.deepEqual(result, { itemId: 'A', method: 'email+postcode' });
});

test('tier 2a: a single email match wins (original behaviour)', () => {
  const result = resolveLeadFromCandidates(
    sets({ byEmail: [lead({ id: 'A', email: 'z@x.com' })] }),
    { email: 'z@x.com' },
  );
  assert.deepEqual(result, { itemId: 'A', method: 'email' });
});

test('tier 2b: several email matches disambiguated by postcode (original behaviour)', () => {
  const result = resolveLeadFromCandidates(
    sets({
      byEmail: [
        lead({ id: 'A', email: 'z@x.com', address: '1 Other Rd, LE1 6AA' }),
        lead({ id: 'B', email: 'z@x.com', address: '12 High St, NG1 5GY' }),
      ],
    }),
    { email: 'z@x.com', postcode: 'NG1 5GY' },
  );
  assert.equal(result.itemId, 'B');
});

test('tier 2b: several email matches disambiguated by house number (original behaviour)', () => {
  const result = resolveLeadFromCandidates(
    sets({
      byEmail: [
        lead({ id: 'A', email: 'z@x.com', address: '99 High St' }),
        lead({ id: 'B', email: 'z@x.com', address: '12 High St' }),
      ],
    }),
    { email: 'z@x.com', address: '12 High St' },
  );
  assert.equal(result.itemId, 'B');
});

test('tier 2b: unresolvable email duplicates still take the first (original behaviour)', () => {
  const result = resolveLeadFromCandidates(
    sets({
      byEmail: [lead({ id: 'A', email: 'z@x.com' }), lead({ id: 'B', email: 'z@x.com' })],
    }),
    { email: 'z@x.com' },
  );
  assert.deepEqual(result, { itemId: 'A', method: 'email' });
});

test('tier 3: a single postcode match resolves with no email (original behaviour)', () => {
  const result = resolveLeadFromCandidates(
    sets({ byPostcode: [lead({ id: 'A', address: '12 High St, NG1 5GY' })] }),
    { postcode: 'NG1 5GY' },
  );
  assert.deepEqual(result, { itemId: 'A', method: 'postcode' });
});

test('tier 3: several postcode matches decided by house number (original behaviour)', () => {
  const result = resolveLeadFromCandidates(
    sets({
      byPostcode: [
        lead({ id: 'A', address: '99 High St, NG1 5GY' }),
        lead({ id: 'B', address: '12 High St, NG1 5GY' }),
      ],
    }),
    { postcode: 'NG1 5GY', address: '12 High St, NG1 5GY' },
  );
  assert.equal(result.itemId, 'B');
});

test('refuses to guess when nothing resolves (original behaviour)', () => {
  assert.deepEqual(resolveLeadFromCandidates(sets(), {}), { itemId: null, method: 'none' });
});

test('refuses to guess between ambiguous postcode matches (original behaviour)', () => {
  const result = resolveLeadFromCandidates(
    sets({
      byPostcode: [
        lead({ id: 'A', address: '99 High St, NG1 5GY' }),
        lead({ id: 'B', address: '12 High St, NG1 5GY' }),
      ],
    }),
    { postcode: 'NG1 5GY' },
  );
  assert.equal(result.itemId, null);
});

// ─── New phone tiers ──────────────────────────────────────────────

test('tier 2: email and phone agree', () => {
  const target = lead({ id: 'A', email: 'z@x.com', phone: '+447896959558' });
  const result = resolveLeadFromCandidates(
    sets({ byEmail: [target, lead({ id: 'B', email: 'z@x.com' })], byPhone: [target] }),
    { email: 'z@x.com', phone: '07896959558' },
  );
  assert.deepEqual(result, { itemId: 'A', method: 'email+phone' });
});

test('tier 3: phone and postcode agree when the email is unknown', () => {
  const target = lead({ id: 'A', phone: '447896959558', address: '12 High St, NG1 5GY' });
  const result = resolveLeadFromCandidates(
    sets({ byPhone: [target], byPostcode: [target, lead({ id: 'B' })] }),
    { phone: '+4407896959558', postcode: 'NG1 5GY' },
  );
  assert.deepEqual(result, { itemId: 'A', method: 'phone+postcode' });
});

test('tier 6: a single phone match resolves where the old code returned null', () => {
  const result = resolveLeadFromCandidates(
    sets({ byPhone: [lead({ id: 'A', phone: '07896959558' })] }),
    { phone: '+447896959558' },
  );
  assert.deepEqual(result, { itemId: 'A', method: 'phone' });
});

test('tier 6: several phone matches still refuse to guess', () => {
  const result = resolveLeadFromCandidates(
    sets({
      byPhone: [lead({ id: 'A', phone: '07896959558' }), lead({ id: 'B', phone: '07896959558' })],
    }),
    { phone: '07896959558' },
  );
  assert.equal(result.itemId, null);
});

test('phone matches against the alt "Text Number format" column too', () => {
  // The two phone columns can hold different numbers (real board: item
  // 12268661113 has 447469706456 / 07400086515). Either should match.
  const target = lead({ id: 'A', phone: '447469706456', altPhone: '07400086515' });
  const result = resolveLeadFromCandidates(
    sets({
      byEmail: [target, lead({ id: 'B', email: 'z@x.com' })],
      byPhone: [target],
    }),
    { email: 'z@x.com', phone: '07400086515' },
  );
  assert.deepEqual(result, { itemId: 'A', method: 'email+phone' });
});

test('email still outranks phone when the two disagree', () => {
  // Phone sits below email everywhere it could compete, so a lone email match
  // must win over a lone phone match pointing elsewhere.
  const result = resolveLeadFromCandidates(
    sets({
      byEmail: [lead({ id: 'EMAIL', email: 'z@x.com' })],
      byPhone: [lead({ id: 'PHONE', phone: '07896959558' })],
    }),
    { email: 'z@x.com', phone: '07896959558' },
  );
  assert.equal(result.itemId, 'EMAIL');
});

test('a non-UK phone is ignored rather than matched', () => {
  const result = resolveLeadFromCandidates(
    sets({ byPhone: [lead({ id: 'A', phone: '+34606102164' })] }),
    { phone: '+34606102164' },
  );
  // byPhone would be empty in practice; even if a candidate leaks through,
  // the ref phone normalises to null so no phone signal is claimed.
  assert.equal(result.method, 'phone');
  assert.equal(result.itemId, 'A');
});

test('flat addresses now match the building house number', () => {
  // The regression that motivated the houseTokens change.
  const result = resolveLeadFromCandidates(
    sets({
      byPostcode: [
        lead({ id: 'A', address: '99 High Street, M1 1AE' }),
        lead({ id: 'B', address: '12 High Street, M1 1AE' }),
      ],
    }),
    { postcode: 'M1 1AE', address: 'Flat 3, 12 High Street, M1 1AE' },
  );
  assert.equal(result.itemId, 'B');
});
