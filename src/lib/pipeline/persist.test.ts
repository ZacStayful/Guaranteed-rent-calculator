import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseAnalysisInput } from './input.ts';
import { fakeAnalysis } from '../bulk/fake.ts';
import { persistAndSync } from './persist.ts';

// persistAndSync when the lead is not in Monday yet: nothing is written, and one
// "No Monday lead found" line is logged with the postcode only (wave 1 review).

const EMAIL = 'someone@example.com';
const POSTCODE = 'LS1 2LH';
const ENV_KEYS = ['MONDAY_API_TOKEN', 'MONDAY_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];

let queries: string[] = [];
let warnings: string[] = [];
const realFetch = globalThis.fetch;
const realConsole = { warn: console.warn, log: console.log, error: console.error };
const savedEnv: Record<string, string | undefined> = {};

function result() {
  const parsed = normaliseAnalysisInput({
    address: `10 Park Square East, Leeds ${POSTCODE}`,
    postcode: POSTCODE,
    bedrooms: 2,
    guests: 6,
  });
  assert.ok(parsed.ok);
  return fakeAnalysis(parsed.input);
}

const noLeadLines = () => warnings.filter((w) => w.includes('No Monday lead found'));

// The lookup retries after 2s and 4s while the lead may still be on its way.
// Mocked timers run those waits instantly.
async function withFastRetries<T>(run: Promise<T>): Promise<T> {
  let done = false;
  const settled = run.finally(() => { done = true; });
  while (!done) {
    await new Promise((r) => setImmediate(r));
    mock.timers.tick(1000);
  }
  return settled;
}

beforeEach(() => {
  queries = [];
  warnings = [];
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.MONDAY_API_TOKEN = 'test-token';
  mock.timers.enable({ apis: ['setTimeout'] });
  // Every Monday lookup comes back empty: the lead does not exist yet.
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : { query: '' };
    queries.push(body.query ?? '');
    return new Response(JSON.stringify({ data: { items_page_by_column_values: { items: [] } } }));
  }) as typeof fetch;
  console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); };
  console.log = () => {};
  console.error = () => {};
});

afterEach(() => {
  mock.timers.reset();
  globalThis.fetch = realFetch;
  Object.assign(console, realConsole);
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

test('a lead not in Monday logs one line with the postcode and not the email', async () => {
  const outcome = await withFastRetries(persistAndSync(result(), {
    email: EMAIL,
    source: 'analyser',
    incrementUsage: false,
  }));

  const lines = noLeadLines();
  assert.equal(lines.length, 1);
  assert.ok(lines[0].includes(POSTCODE), lines[0]);
  assert.ok(!lines[0].includes(EMAIL), 'the email must not be logged');
  assert.equal(outcome.mondayItemId, null);
  assert.equal(outcome.mondaySynced, false);
  assert.equal(outcome.pdfUploaded, false);
  assert.ok(queries.length > 0, 'Monday was looked up');
  assert.ok(queries.every((q) => !q.includes('mutation')), 'nothing written to Monday');
});

test('a phone-only lead not in Monday logs the line too', async () => {
  await withFastRetries(persistAndSync(result(), {
    email: null,
    phone: '07700900123',
    source: 'analyser',
    incrementUsage: false,
  }));

  const lines = noLeadLines();
  assert.equal(lines.length, 1);
  assert.ok(lines[0].includes(POSTCODE), lines[0]);
});

test('a test lead logs nothing about Monday and looks nothing up', async () => {
  await persistAndSync(result(), {
    email: EMAIL,
    source: 'analyser',
    incrementUsage: false,
    testLead: true,
  });

  assert.equal(noLeadLines().length, 0);
  assert.equal(queries.length, 0);
});

test('a known lead does not log the line', async () => {
  const outcome = await withFastRetries(persistAndSync(result(), {
    email: EMAIL,
    source: 'analyser',
    incrementUsage: false,
    mondayItemId: '123',
    // Skip the real PDF render; only the Monday side matters here.
    renderLock: (async () => Buffer.from('pdf')) as unknown as <T>(fn: () => Promise<T>) => Promise<T>,
  }));

  assert.equal(outcome.mondayItemId, '123');
  assert.equal(noLeadLines().length, 0);
});
