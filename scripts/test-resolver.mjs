// Test-only module resolver.
//
// The app is bundled by Next, which infers file extensions and understands the
// "@/*" path alias from tsconfig. Bare `node --test` does neither, so importing
// any module that reaches the rest of the codebase fails with
// ERR_MODULE_NOT_FOUND on the first extensionless relative import.
//
// This hook only runs when normal resolution has already failed, so it cannot
// change how anything resolves at build time — it just lets the test runner
// follow the same imports the bundler does. Nothing here ships to production.

import { existsSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PROJECT_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');
const CANDIDATE_SUFFIXES = ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx'];

function firstExisting(basePath) {
  for (const suffix of CANDIDATE_SUFFIXES) {
    const candidate = `${basePath}${suffix}`;
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  // "@/*" maps to "./src/*" (see tsconfig paths).
  if (specifier.startsWith('@/')) {
    const basePath = resolvePath(PROJECT_ROOT, 'src', specifier.slice(2));
    const found = existsSync(basePath) ? basePath : firstExisting(basePath);
    if (found) {
      return { url: pathToFileURL(found).href, shortCircuit: true };
    }
  }

  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (!specifier.startsWith('.') || !context.parentURL) throw error;

    const basePath = resolvePath(dirname(fileURLToPath(context.parentURL)), specifier);
    const found = firstExisting(basePath);
    if (!found) throw error;

    return { url: pathToFileURL(found).href, shortCircuit: true };
  }
}
