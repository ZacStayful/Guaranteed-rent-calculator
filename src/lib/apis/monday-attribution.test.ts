import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { syncAttributionToMonday } from './monday.ts';

// syncAttributionToMonday against a fake Monday API: it must read the source
// columns first and write only the empty ones, in a write of its own.

type Call = { query: string; variables: Record<string, unknown> };
let calls: Call[] = [];
let currentText: Record<string, string> = {};
let readFails = false;
const realFetch = globalThis.fetch;
const savedToken = process.env.MONDAY_API_TOKEN;

beforeEach(() => {
  calls = [];
  currentText = {};
  readFails = false;
  process.env.MONDAY_API_TOKEN = 'test-token';
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    const { query, variables } = JSON.parse(init.body);
    calls.push({ query, variables });
    if (query.includes('change_multiple_column_values')) {
      return new Response(JSON.stringify({ data: { change_multiple_column_values: { id: '1' } } }));
    }
    if (readFails) return new Response('boom', { status: 500 });
    const cols = variables.cols as string[];
    const column_values = cols.map((id) => ({ id, text: currentText[id] ?? '' }));
    return new Response(JSON.stringify({ data: { items: [{ column_values }] } }));
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  if (savedToken === undefined) delete process.env.MONDAY_API_TOKEN;
  else process.env.MONDAY_API_TOKEN = savedToken;
});

const writes = () => calls.filter((c) => c.query.includes('change_multiple_column_values'));

test('writes every source field into empty columns', async () => {
  const ok = await syncAttributionToMonday('123', { from: '/guaranteed-rent-leeds', utm_source: 'google' });
  assert.equal(ok, true);
  assert.equal(writes().length, 1);
  assert.deepEqual(JSON.parse(writes()[0].variables.values as string), {
    text_mm86x9r1: '/guaranteed-rent-leeds',
    text_mm86hvgw: 'google',
  });
});

test('keeps a source that is already set and fills the rest', async () => {
  currentText = { text_mm86x9r1: '/guaranteed-rent-york' };
  await syncAttributionToMonday('123', { from: '/guaranteed-rent-leeds', utm_campaign: 'oct' });
  assert.deepEqual(JSON.parse(writes()[0].variables.values as string), { text_mm86a00f: 'oct' });
});

test('writes nothing when every column is already set', async () => {
  currentText = { text_mm86x9r1: '/a', text_mm86hvgw: 'b' };
  const ok = await syncAttributionToMonday('123', { from: '/x', utm_source: 'y' });
  assert.equal(ok, true);
  assert.equal(writes().length, 0);
});

test('writes nothing when the current values cannot be read', async () => {
  readFails = true;
  const ok = await syncAttributionToMonday('123', { from: '/x' });
  assert.equal(ok, false);
  assert.equal(writes().length, 0);
});

test('does nothing without a Monday credential', async () => {
  delete process.env.MONDAY_API_TOKEN;
  const savedKey = process.env.MONDAY_API_KEY;
  delete process.env.MONDAY_API_KEY;
  try {
    assert.equal(await syncAttributionToMonday('123', { from: '/x' }), false);
    assert.equal(calls.length, 0);
  } finally {
    if (savedKey !== undefined) process.env.MONDAY_API_KEY = savedKey;
  }
});
