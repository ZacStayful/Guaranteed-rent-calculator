// ─── Spreadsheet parsing ──────────────────────────────────────────
//
// Turns an uploaded .csv/.xlsx into validated rows ready for the analyser.
//
// The sheet carries: email, contact number, property address, bedrooms. It is
// the SOLE source of the analysis inputs — nothing is ever read back off the
// Monday board, which is only used to locate the item to write to.
//
// Server-only: never import this from a client component.
//
// Library choice: papaparse for CSV, read-excel-file for XLSX.
//   • papaparse is not optional for CSV — addresses contain commas, so a naive
//     split silently corrupts rows. It also handles the UTF-8 BOM Excel writes,
//     CRLF, and quoted fields.
//   • read-excel-file rather than the npm `xlsx` package (stale since 2022,
//     prototype-pollution advisory, current builds only on SheetJS's own CDN)
//     and rather than exceljs (pulls a `uuid` advisory transitively).
//     read-excel-file adds zero advisories.

import Papa from 'papaparse';
import readXlsxFile from 'read-excel-file/node';
import { defaultGuests } from '../pipeline/input.ts';
import { extractPostcodes } from '../utils/postcode.ts';
import { normaliseUkPhone } from '../utils/phone.ts';
import { BLOCKING_WARNINGS, type RowWarning } from './warnings.ts';

export type BulkField = 'email' | 'phone' | 'address' | 'bedrooms';

// Warning types and labels live in ./warnings.ts, which is client-safe — this
// module is server-only. Re-exported for convenience on the server.
export { BLOCKING_WARNINGS, WARNING_LABELS } from './warnings.ts';
export type { RowWarning } from './warnings.ts';

export interface ParsedRow {
  /** 1-based row number in the source sheet, for talking to the user. */
  rowNumber: number;
  email: string | null;
  phone: string | null;
  phoneE164: string | null;
  address: string | null;
  postcode: string | null;
  bedrooms: number | null;
  guests: number | null;
  warnings: RowWarning[];
  /** True when the row cannot be run and must be skipped. */
  blocking: boolean;
}

export interface ParseResult {
  rows: ParsedRow[];
  /** Which source header each field was taken from, so the UI can show/correct it. */
  headerMap: Record<BulkField, string | null>;
  headerRowIndex: number;
  droppedBlankRows: number;
}

export class SpreadsheetError extends Error {}

/** Default row cap. Batches of ~100 keep each spend decision small. */
export const DEFAULT_MAX_ROWS = 100;
const MAX_HEADER_SCAN_ROWS = 5;

// Header synonyms, matched after stripping to lowercase alphanumerics, so
// "Email Address", "email_address" and "EMAIL-ADDRESS" all collapse together.
const FIELD_ALIASES: Record<BulkField, string[]> = {
  email: ['email', 'emailaddress', 'eaddress', 'contactemail', 'leademail', 'owneremail'],
  phone: [
    'phone', 'phonenumber', 'contactnumber', 'contactno', 'contact', 'mobile',
    'mobilenumber', 'tel', 'telephone', 'number', 'phone1',
  ],
  address: [
    'address', 'propertyaddress', 'fulladdress', 'addressline1', 'address1',
    'property', 'propertyaddressline1',
  ],
  bedrooms: [
    'bedrooms', 'bedroom', 'beds', 'bed', 'numberofbedrooms', 'noofbedrooms',
    'nobedrooms', 'numbeds', 'bedroomcount',
  ],
};

function normaliseHeader(value: unknown): string {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Flatten a cell to a trimmed string.
 *
 * read-excel-file yields Date/number/boolean/null as well as strings, and
 * collapses non-breaking spaces poorly, so normalise here rather than at every
 * call site.
 */
function cellToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    // Defensive: some readers return rich text / hyperlink objects.
    const obj = value as { text?: unknown; richText?: Array<{ text?: unknown }> };
    if (Array.isArray(obj.richText)) return obj.richText.map((r) => String(r.text ?? '')).join('').trim();
    if (obj.text !== undefined) return String(obj.text).trim();
  }
  return String(value).replace(/ /g, ' ').trim();
}

/**
 * Bedrooms from "3", "3 bed", "3.0", "Studio".
 *
 * The minus sign is part of the match on purpose: without it "-1" yields 1,
 * silently turning an invalid value into a plausible one instead of failing
 * validation.
 */
function parseBedrooms(raw: string): number | null {
  if (!raw) return null;
  if (/studio/i.test(raw)) return 0;
  const match = raw.match(/-?\d+/);
  if (!match) return null;
  const n = Number.parseInt(match[0], 10);
  return Number.isFinite(n) ? n : null;
}

function isRowBlank(cells: unknown[]): boolean {
  return cells.every((c) => cellToString(c) === '');
}

/**
 * Find the header row and which column holds each field.
 *
 * Scans the first few rows rather than assuming row 1, because exports often
 * prepend a title row.
 */
function detectHeader(rows: unknown[][]): {
  headerRowIndex: number;
  columnIndex: Record<BulkField, number | null>;
  headerMap: Record<BulkField, string | null>;
} {
  let best: {
    index: number;
    matched: number;
    columnIndex: Record<BulkField, number | null>;
    headerMap: Record<BulkField, string | null>;
  } | null = null;

  const limit = Math.min(MAX_HEADER_SCAN_ROWS, rows.length);
  for (let i = 0; i < limit; i++) {
    const cells = rows[i] ?? [];
    const columnIndex: Record<BulkField, number | null> = {
      email: null, phone: null, address: null, bedrooms: null,
    };
    const headerMap: Record<BulkField, string | null> = {
      email: null, phone: null, address: null, bedrooms: null,
    };

    cells.forEach((cell, col) => {
      const key = normaliseHeader(cell);
      if (!key) return;
      for (const field of Object.keys(FIELD_ALIASES) as BulkField[]) {
        if (columnIndex[field] === null && FIELD_ALIASES[field].includes(key)) {
          columnIndex[field] = col;
          headerMap[field] = cellToString(cell);
        }
      }
    });

    const matched = Object.values(columnIndex).filter((v) => v !== null).length;
    if (matched >= 2 && (!best || matched > best.matched)) {
      best = { index: i, matched, columnIndex, headerMap };
    }
  }

  if (!best) {
    throw new SpreadsheetError(
      'Could not find a header row. The sheet needs columns for at least the property address and bedrooms — for example: Email, Phone, Address, Bedrooms.',
    );
  }
  if (best.columnIndex.address === null) {
    throw new SpreadsheetError(
      'No address column found. Add a column headed "Address" (or "Property Address") and upload again.',
    );
  }

  return { headerRowIndex: best.index, columnIndex: best.columnIndex, headerMap: best.headerMap };
}

async function readRows(file: { name: string; buffer: Buffer }): Promise<unknown[][]> {
  const isCsv = /\.(csv|tsv|txt)$/i.test(file.name);

  if (isCsv) {
    // Strip the UTF-8 BOM Excel writes, which would otherwise become part of
    // the first header name and stop it matching. Also strip ONE trailing
    // newline, which would otherwise parse as a phantom empty final row.
    const text = file.buffer
      .toString('utf8')
      .replace(/^﻿/, '')
      .replace(/\r?\n$/, '');

    // skipEmptyLines is deliberately OFF. Letting papaparse drop blank lines
    // shifts every subsequent index, so the row numbers we report back would
    // no longer match the rows the user sees in their spreadsheet. Blank rows
    // are recognised and dropped below instead, after indices are fixed.
    const parsed = Papa.parse<string[]>(text, { header: false, skipEmptyLines: false });
    if (parsed.errors.length) {
      const first = parsed.errors[0];
      // Field-count mismatches are common and harmless (ragged trailing
      // commas); only genuinely undecodable input should fail the upload.
      const fatal = parsed.errors.filter((e) => e.type === 'Quotes' || e.type === 'Delimiter');
      if (fatal.length) {
        throw new SpreadsheetError(`Could not read the CSV (row ${(first.row ?? 0) + 1}: ${first.message}).`);
      }
    }
    return parsed.data as unknown[][];
  }

  if (!/\.xlsx$/i.test(file.name)) {
    throw new SpreadsheetError('Unsupported file type. Upload a .csv or .xlsx file.');
  }

  try {
    const parsed = (await readXlsxFile(file.buffer)) as unknown;

    // read-excel-file's types say SheetData (rows of cells), but given a
    // Buffer it actually returns [{ sheet, data }] — a list of sheets. Handle
    // both so a version bump can't silently break the upload. Only the first
    // sheet is read; a workbook's other tabs are ignored.
    if (Array.isArray(parsed) && parsed.length > 0) {
      const first = parsed[0] as { data?: unknown } | unknown[];
      if (!Array.isArray(first) && first && Array.isArray((first as { data?: unknown }).data)) {
        return (first as { data: unknown[][] }).data;
      }
    }
    return parsed as unknown[][];
  } catch (err) {
    throw new SpreadsheetError(
      `Could not read the spreadsheet (${err instanceof Error ? err.message : 'unknown error'}). ` +
      'If it was exported from Google Sheets, try downloading it as .csv instead.',
    );
  }
}

export async function parseSpreadsheet(
  file: { name: string; buffer: Buffer },
  options: { maxRows?: number } = {},
): Promise<ParseResult> {
  const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;
  const raw = await readRows(file);
  if (!raw.length) throw new SpreadsheetError('The file is empty.');

  const { headerRowIndex, columnIndex, headerMap } = detectHeader(raw);

  const body = raw.slice(headerRowIndex + 1);
  const rows: ParsedRow[] = [];
  let droppedBlankRows = 0;

  // Detects two sheet rows pointing at the same property, which would spend
  // twice and have the second silently overwrite the first on the board.
  const seen = new Map<string, number>();

  for (let i = 0; i < body.length; i++) {
    const cells = body[i] ?? [];
    if (isRowBlank(cells)) {
      droppedBlankRows++;
      continue;
    }

    if (rows.length >= maxRows) {
      throw new SpreadsheetError(
        `This sheet has more than ${maxRows} rows. Split it into batches of ${maxRows} — each batch gets its own preview and cost confirmation.`,
      );
    }

    // +1 to convert to 1-based, +1 more to skip the header row itself.
    const rowNumber = headerRowIndex + i + 2;
    const at = (field: BulkField): string => {
      const col = columnIndex[field];
      return col === null ? '' : cellToString(cells[col]);
    };

    const warnings: RowWarning[] = [];

    // ── Email
    const rawEmail = at('email');
    let email: string | null = null;
    if (rawEmail) {
      if (rawEmail.includes('@') && !/\s/.test(rawEmail)) email = rawEmail;
      else warnings.push('invalid_email');
    }

    // ── Phone. Excel stores "07123456789" as the number 7123456789, so the
    //    leading zero is already gone by the time we see it — normaliseUkPhone
    //    puts it back.
    const rawPhone = at('phone');
    const parsedPhone = normaliseUkPhone(rawPhone);
    if (rawPhone && !parsedPhone) warnings.push('invalid_phone');

    if (!email && !parsedPhone) warnings.push('no_contact_signal');

    // ── Address + postcode
    const address = at('address') || null;
    let postcode: string | null = null;
    if (!address) {
      warnings.push('missing_address');
    } else {
      const found = extractPostcodes(address);
      if (found.length === 0) warnings.push('missing_postcode');
      else if (found.length > 1) warnings.push('ambiguous_postcode');
      // Last match wins: a UK address ends with its postcode.
      else postcode = found[found.length - 1];
    }

    // ── Bedrooms
    const bedrooms = parseBedrooms(at('bedrooms'));
    if (bedrooms === null || bedrooms < 0 || bedrooms > 10) {
      warnings.push('invalid_bedrooms');
    } else if (bedrooms > 5) {
      // The public form caps at 5 and PropertyData clamps to 5, so anything
      // larger is outside the calibrated range — worth flagging, not blocking.
      warnings.push('bedrooms_out_of_range');
    }

    const validBedrooms = bedrooms !== null && bedrooms >= 0 && bedrooms <= 10 ? bedrooms : null;

    // ── Duplicate detection within this sheet
    if (postcode && address) {
      const key = `${postcode}|${address.toUpperCase().replace(/[^A-Z0-9]/g, '')}`;
      if (seen.has(key)) warnings.push('duplicate_row');
      else seen.set(key, rowNumber);
    }

    rows.push({
      rowNumber,
      email,
      phone: parsedPhone?.national ?? (rawPhone || null),
      phoneE164: parsedPhone?.e164 ?? null,
      address,
      postcode,
      bedrooms: validBedrooms,
      guests: validBedrooms === null ? null : defaultGuests(validBedrooms),
      warnings,
      blocking: warnings.some((w) => BLOCKING_WARNINGS.has(w)),
    });
  }

  if (!rows.length) throw new SpreadsheetError('No data rows found below the header.');

  return { rows, headerMap, headerRowIndex, droppedBlankRows };
}

