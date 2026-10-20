/**
 * The app bundles.
 *
 * On 20 October 2026 a removed line left an `else` with no `if` in
 * cryptoWhales.js. Every test passed — none of them loads that file, they read
 * its text — and the deploy failed on Vercel, so the site stayed on the build
 * before. Bundling here catches a syntax error anywhere the app reaches.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('every module the app loads parses and bundles', { timeout: 180_000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'bundle-'));
  const main = fileURLToPath(new URL('../src/main.js', import.meta.url));
  // Quoted, because on Windows npx runs through a shell and this folder's name
  // has spaces in it.
  const q = (s) => `"${s}"`;
  try {
    execFileSync('npx', ['--yes', 'esbuild@0.24.0', q(main), '--bundle', '--format=iife', '--target=es2022',
      q(`--outfile=${join(dir, 'b.js')}`), '--log-level=error'], { stdio: 'pipe', shell: true });
  } catch (err) {
    assert.fail(`the bundle failed:\n${String(err.stderr || err.stdout || err.message).slice(0, 2000)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
