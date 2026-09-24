import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SpreadsheetError, parseSpreadsheet } from './parse.ts';

function csv(text: string, name = 'leads.csv') {
  return parseSpreadsheet({ name, buffer: Buffer.from(text, 'utf8') });
}

const HEADER = 'Email,Phone,Address,Bedrooms\n';

// ─── Header detection and mapping ─────────────────────────────────

test('parses a straightforward sheet', async () => {
  const result = await csv(
    HEADER + 'a@b.com,07896959558,"12 High Street, Nottingham NG1 5GY",2\n',
  );
  assert.equal(result.rows.length, 1);
  const row = result.rows[0];
  assert.equal(row.email, 'a@b.com');
  assert.equal(row.phone, '07896959558');
  assert.equal(row.postcode, 'NG1 5GY');
  assert.equal(row.bedrooms, 2);
  assert.equal(row.guests, 6, 'beds x 2 + 2');
  assert.equal(row.blocking, false);
  assert.equal(row.rowNumber, 2, '1-based, header is row 1');
});

test('accepts header synonyms and odd casing', async () => {
  const result = await csv(
    'Email Address,Contact Number,Property Address,No. of Bedrooms\n' +
    'a@b.com,07896959558,"12 High Street, NG1 5GY",3\n',
  );
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].email, 'a@b.com');
  assert.equal(result.rows[0].bedrooms, 3);
  assert.equal(result.headerMap.bedrooms, 'No. of Bedrooms');
});

test('finds the header when a title row is prepended', async () => {
  const result = await csv(
    'Management Leads export — August\n' +
    '\n' +
    HEADER +
    'a@b.com,07896959558,"12 High Street, NG1 5GY",2\n',
  );
  assert.equal(result.headerRowIndex, 2);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].rowNumber, 4);
});

test('addresses containing commas survive — the reason for a real CSV parser', async () => {
  const result = await csv(
    HEADER + 'a@b.com,07896959558,"Flat 2, 6a Long Street, Tetbury, Gloucestershire GL8 8AQ",1\n',
  );
  assert.equal(result.rows[0].address, 'Flat 2, 6a Long Street, Tetbury, Gloucestershire GL8 8AQ');
  assert.equal(result.rows[0].postcode, 'GL8 8AQ');
});

test('strips the UTF-8 BOM Excel writes', async () => {
  const result = await csv('﻿' + HEADER + 'a@b.com,07896959558,"12 High St, NG1 5GY",2\n');
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].email, 'a@b.com');
});

test('handles CRLF line endings', async () => {
  const result = await csv(
    'Email,Phone,Address,Bedrooms\r\na@b.com,07896959558,"12 High St, NG1 5GY",2\r\n',
  );
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].postcode, 'NG1 5GY');
});

test('drops blank trailing rows rather than counting them', async () => {
  const result = await csv(HEADER + 'a@b.com,07896959558,"12 High St, NG1 5GY",2\n,,,\n,,,\n');
  assert.equal(result.rows.length, 1);
  assert.equal(result.droppedBlankRows, 2);
});

// ─── Per-row validation ───────────────────────────────────────────

test('blocks a row whose address has no postcode', async () => {
  // "Sharrow Vale" is a real Address value from the board.
  const result = await csv(HEADER + 'a@b.com,07896959558,Sharrow Vale,2\n');
  assert.equal(result.rows[0].blocking, true);
  assert.ok(result.rows[0].warnings.includes('missing_postcode'));
  assert.equal(result.rows[0].postcode, null);
});

test('blocks a row with two different postcodes rather than guessing', async () => {
  const result = await csv(HEADER + 'a@b.com,07896959558,"Somewhere TR26 2QH or TR27 1AA",2\n');
  assert.equal(result.rows[0].blocking, true);
  assert.ok(result.rows[0].warnings.includes('ambiguous_postcode'));
});

test('a duplicated postcode is not ambiguous', async () => {
  // Real board value: "…Cornwall TR26 2QH TR26 2QH".
  const result = await csv(HEADER + 'a@b.com,07896959558,"Carbis Bay TR26 2QH TR26 2QH",2\n');
  assert.equal(result.rows[0].blocking, false);
  assert.equal(result.rows[0].postcode, 'TR26 2QH');
});

test('blocks rows with unusable bedrooms', async () => {
  for (const value of ['', 'lots', '11', '-1']) {
    const result = await csv(HEADER + `a@b.com,07896959558,"12 High St, NG1 5GY",${value}\n`);
    assert.equal(result.rows[0].blocking, true, `bedrooms=${JSON.stringify(value)}`);
    assert.ok(result.rows[0].warnings.includes('invalid_bedrooms'));
  }
});

test('reads bedrooms out of free text', async () => {
  const cases: Array<[string, number]> = [['3 bed', 3], ['3.0', 3], ['Studio', 0], ['2 bedrooms', 2]];
  for (const [value, expected] of cases) {
    const result = await csv(HEADER + `a@b.com,07896959558,"12 High St, NG1 5GY",${value}\n`);
    assert.equal(result.rows[0].bedrooms, expected, `bedrooms=${value}`);
    assert.equal(result.rows[0].blocking, false);
  }
});

test('warns but does not block above 5 bedrooms', async () => {
  // The form caps at 5 and PropertyData clamps to 5, so 7 is outside the
  // calibrated range but still runnable.
  const result = await csv(HEADER + 'a@b.com,07896959558,"12 High St, NG1 5GY",7\n');
  assert.equal(result.rows[0].blocking, false);
  assert.ok(result.rows[0].warnings.includes('bedrooms_out_of_range'));
  assert.equal(result.rows[0].guests, 16, 'clamped so the row stays runnable');
});

test('normalises phone numbers and flags non-UK ones', async () => {
  const result = await csv(
    HEADER +
    'a@b.com,+4407896959558,"12 High St, NG1 5GY",2\n' +
    'b@b.com,+34606102164,"13 High St, NG1 5GY",2\n',
  );
  assert.equal(result.rows[0].phone, '07896959558', '+44 with a doubled trunk zero');
  assert.equal(result.rows[0].phoneE164, '+447896959558');
  assert.ok(result.rows[1].warnings.includes('invalid_phone'), 'Spanish number');
  assert.equal(result.rows[1].phoneE164, null);
});

test('flags a row with neither email nor usable phone', async () => {
  const result = await csv(HEADER + ',,"12 High St, NG1 5GY",2\n');
  assert.ok(result.rows[0].warnings.includes('no_contact_signal'));
  assert.equal(result.rows[0].blocking, false, 'still matchable by property');
});

test('flags a malformed email and ignores it', async () => {
  const result = await csv(HEADER + 'not-an-email,07896959558,"12 High St, NG1 5GY",2\n');
  assert.equal(result.rows[0].email, null);
  assert.ok(result.rows[0].warnings.includes('invalid_email'));
});

test('flags a second row pointing at the same property', async () => {
  const result = await csv(
    HEADER +
    'a@b.com,07896959558,"12 High St, NG1 5GY",2\n' +
    'b@b.com,07896959559,"12 High St, NG1 5GY",2\n',
  );
  assert.equal(result.rows[0].warnings.includes('duplicate_row'), false);
  assert.ok(result.rows[1].warnings.includes('duplicate_row'), 'would double-spend');
});

// ─── File-level errors ────────────────────────────────────────────

test('rejects a sheet with no recognisable header', async () => {
  await assert.rejects(
    () => csv('Widget,Sprocket,Gizmo\n1,2,3\n'),
    (err: Error) => err instanceof SpreadsheetError && /header row/i.test(err.message),
  );
});

test('rejects a sheet with no address column', async () => {
  await assert.rejects(
    () => csv('Email,Phone,Bedrooms\na@b.com,07896959558,2\n'),
    (err: Error) => err instanceof SpreadsheetError && /address column/i.test(err.message),
  );
});

test('rejects an empty file', async () => {
  await assert.rejects(() => csv(''), SpreadsheetError);
});

test('rejects a header with no data rows', async () => {
  await assert.rejects(
    () => csv(HEADER),
    (err: Error) => err instanceof SpreadsheetError && /No data rows/i.test(err.message),
  );
});

test('rejects an unsupported file type', async () => {
  await assert.rejects(
    () => parseSpreadsheet({ name: 'leads.pdf', buffer: Buffer.from('x') }),
    (err: Error) => err instanceof SpreadsheetError && /\.csv or \.xlsx/i.test(err.message),
  );
});

test('rejects a sheet over the row cap, telling the user to batch', async () => {
  const rows = Array.from(
    { length: 101 },
    (_, i) => `a${i}@b.com,07896959558,"${i} High St, NG1 5GY",2`,
  ).join('\n');
  await assert.rejects(
    () => csv(HEADER + rows + '\n'),
    (err: Error) => err instanceof SpreadsheetError && /batches of 100/i.test(err.message),
  );
});

test('the row cap is configurable', async () => {
  const rows = Array.from(
    { length: 6 },
    (_, i) => `a${i}@b.com,07896959558,"${i} High St, NG1 5GY",2`,
  ).join('\n');
  const result = await parseSpreadsheet(
    { name: 'x.csv', buffer: Buffer.from(HEADER + rows + '\n') },
    { maxRows: 10 },
  );
  assert.equal(result.rows.length, 6);
  await assert.rejects(
    () => parseSpreadsheet({ name: 'x.csv', buffer: Buffer.from(HEADER + rows + '\n') }, { maxRows: 5 }),
    SpreadsheetError,
  );
});

// ─── XLSX ─────────────────────────────────────────────────────────
// Exercised against a real .xlsx (see __fixtures__/leads.xlsx), because the
// interesting failures are type-coercion ones that a CSV fixture cannot show.

test('reads a real .xlsx, including Excel eating a phone number leading zero', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const path = fileURLToPath(new URL('./__fixtures__/leads.xlsx', import.meta.url));

  const result = await parseSpreadsheet({ name: 'leads.xlsx', buffer: readFileSync(path) });

  assert.equal(result.headerRowIndex, 1, 'header sits below a title row');
  assert.equal(result.rows.length, 3);
  // read-excel-file trims the trailing blank row itself, so nothing reaches us.
  assert.equal(result.droppedBlankRows, 0);

  // Stored as the NUMBER 7896959558 — the leading zero is gone in the file
  // itself, so the parser has to put it back.
  const [first, second, third] = result.rows;
  assert.equal(first.phone, '07896959558');
  assert.equal(first.phoneE164, '+447896959558');
  assert.equal(first.postcode, 'NG1 5GY');
  assert.equal(first.bedrooms, 2);
  assert.equal(first.guests, 6);
  assert.equal(first.blocking, false);
  assert.equal(first.rowNumber, 3, 'row numbers match the spreadsheet');

  // Mixed-case postcode with no space, bedrooms as free text.
  assert.equal(second.postcode, 'BS1 4RR');
  assert.equal(second.bedrooms, 3);
  assert.equal(second.phone, '07718895193', '+44 with a doubled trunk zero');

  // No postcode in the address — blocked rather than guessed.
  assert.equal(third.blocking, true);
  assert.ok(third.warnings.includes('missing_postcode'));
});
