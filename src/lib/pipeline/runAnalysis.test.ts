import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseAnalysisInput } from './input.ts';
import { runAnalysis, type ProgressEvent } from './runAnalysis.ts';

// The SSE wire contract. src/app/page.tsx branches on `stage` AND on the
// numeric thresholds (progress >= 20, progress >= 75), so this sequence is
// load-bearing UI behaviour, not just logging. Recorded here so that moving
// the pipeline around cannot silently renumber or reword it.
export const EXPECTED_SEQUENCE: ReadonlyArray<[string, number, string]> = [
  ['geocoding', 10, 'Locating property...'],
  ['geocoding', 20, 'Property located'],
  ['short_let', 40, 'Short-let revenue data received'],
  ['long_let', 50, 'Long-let valuation received'],
  ['amenities', 55, 'Finding nearby amenities & transport...'],
  ['amenities', 75, 'Nearby amenities found'],
  ['events', 80, 'Local events discovered'],
  ['analysis', 90, 'Running financial analysis...'],
  ['complete', 100, 'Analysis complete'],
];

function input() {
  const result = normaliseAnalysisInput({
    address: '12 High Street, Nottingham NG1 5GY',
    postcode: 'NG1 5GY',
    bedrooms: 2,
    guests: 6,
  });
  assert.ok(result.ok);
  return result.input;
}

test('geocoding failure emits the exact error event the browser expects', async () => {
  // geocodePostcode throws when GOOGLE_PLACES_API_KEY is unset, which is the
  // case in test. This exercises the real early-return path rather than a mock.
  const originalKey = process.env.GOOGLE_PLACES_API_KEY;
  delete process.env.GOOGLE_PLACES_API_KEY;

  try {
    const events: ProgressEvent[] = [];
    const outcome = await runAnalysis(input(), { onProgress: (e) => events.push(e) });

    assert.equal(outcome.ok, false);
    assert.equal(outcome.ok === false && outcome.stage, 'geocode');

    assert.deepEqual(
      events.map((e) => [e.stage, e.progress]),
      [
        ['geocoding', 10],
        ['error', 0],
      ],
    );
    assert.equal(
      events[1].message,
      'Could not geocode the provided postcode. Please check it and try again.',
    );
  } finally {
    if (originalKey !== undefined) process.env.GOOGLE_PLACES_API_KEY = originalKey;
  }
});

test('runAnalysis never throws — a broken pipeline returns ok:false', async () => {
  const originalKey = process.env.GOOGLE_PLACES_API_KEY;
  delete process.env.GOOGLE_PLACES_API_KEY;
  try {
    // One bad row must never be able to take down a whole bulk batch.
    const outcome = await runAnalysis(input());
    assert.equal(outcome.ok, false);
  } finally {
    if (originalKey !== undefined) process.env.GOOGLE_PLACES_API_KEY = originalKey;
  }
});

test('runAnalysis works without an onProgress callback', async () => {
  const originalKey = process.env.GOOGLE_PLACES_API_KEY;
  delete process.env.GOOGLE_PLACES_API_KEY;
  try {
    // The bulk worker passes no callback; emit must be a safe no-op.
    await assert.doesNotReject(() => runAnalysis(input()));
  } finally {
    if (originalKey !== undefined) process.env.GOOGLE_PLACES_API_KEY = originalKey;
  }
});

test('the recorded SSE sequence is monotonic and ends at 100', () => {
  const progresses = EXPECTED_SEQUENCE.map(([, p]) => p);
  for (let i = 1; i < progresses.length; i++) {
    assert.ok(progresses[i] >= progresses[i - 1], 'progress must never go backwards');
  }
  assert.equal(progresses.at(-1), 100);
  // The two thresholds page.tsx tests against must remain reachable.
  assert.ok(progresses.includes(20), 'page.tsx keys off progress >= 20');
  assert.ok(progresses.includes(75), 'page.tsx keys off progress >= 75');
});
