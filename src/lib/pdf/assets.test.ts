import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { pdfFontPaths } from './theme.ts';

/**
 * The report reads these off the filesystem at request time via statically
 * written paths — there is no runtime existence check, because probing made the
 * bundler trace the whole project into every render route.
 *
 * So the guard lives here instead: if a font or image is renamed, moved or
 * dropped, this fails in CI rather than at a lead's download.
 *
 * The matching production-side check is `outputFileTracingIncludes` in
 * next.config.ts, which puts these same files into each route's bundle.
 */

test('every registered report font is on disk and is a real TTF', () => {
  const paths = pdfFontPaths();
  assert.equal(paths.length, 4, 'expected 2 sans weights + 2 mono weights');

  for (const p of paths) {
    assert.ok(fs.existsSync(p), `missing font file: ${p}`);
    const stat = fs.statSync(p);
    assert.ok(stat.size > 20_000, `suspiciously small font file: ${p} (${stat.size} bytes)`);

    // sfnt magic: 0x00010000 for TrueType outlines.
    const head = Buffer.alloc(4);
    const fd = fs.openSync(p, 'r');
    try {
      fs.readSync(fd, head, 0, 4, 0);
    } finally {
      fs.closeSync(fd);
    }
    assert.equal(head.toString('hex'), '00010000', `not a TrueType font: ${p}`);
  }
});

test('the wordmark and booking QR are on disk and are PNGs', () => {
  for (const rel of ['public/images/stayful-logo.png', 'public/images/qr-book-call.png']) {
    const p = path.join(process.cwd(), rel);
    assert.ok(fs.existsSync(p), `missing image: ${rel}`);

    const head = Buffer.alloc(8);
    const fd = fs.openSync(p, 'r');
    try {
      fs.readSync(fd, head, 0, 8, 0);
    } finally {
      fs.closeSync(fd);
    }
    assert.equal(head.toString('hex'), '89504e470d0a1a0a', `not a PNG: ${rel}`);
  }
});
