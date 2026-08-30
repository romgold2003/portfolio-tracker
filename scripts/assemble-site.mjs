/**
 * Turns the built single file into a deployable site directory.
 *
 * GitHub Pages and Vercel both publish a folder, and both were assembling that
 * folder with their own copy of these three steps. Keeping the steps here means
 * the two hosts cannot drift apart, and the checks below run for both.
 *
 * Usage: node scripts/assemble-site.mjs [outputDir]   (default: _site)
 */
import { mkdir, copyFile, writeFile, readFile, stat, readdir } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUILT = join(ROOT, 'dist', 'portfolio-tracker.html');
const OUT = resolve(ROOT, process.argv[2] || '_site');

/**
 * A build that half-succeeds is worse than one that fails: it deploys a page
 * that loads and then does nothing. Each check below is a way that has actually
 * been possible — markup without code, code without markup, or an inlining step
 * that quietly left a tag pointing at a file the site does not serve.
 */
const CHECKS = [
  [/id="homePositions"/, 'app markup missing'],
  [/sanitizePosition/, 'app code missing'],
  [/data-tf="YTD"/, 'timeframe buttons missing'],
];
const MUST_NOT = [
  [/<script type="module"/, 'bundling did not inline the modules'],
  [/cdnjs/, 'Chart.js was not inlined'],
  [/<link rel="stylesheet"/, 'the stylesheets were not inlined'],
];

/**
 * Copies assets/ into the output, if there is one.
 *
 * Flat on purpose: the moment this walks a tree it needs to care about symlinks,
 * hidden files and what is safe to publish. One folder of files it is.
 */
async function copyAssets() {
  const from = join(ROOT, 'assets');
  const names = await readdir(from).catch(() => null);
  if (!names || !names.length) return [];

  await mkdir(join(OUT, 'assets'), { recursive: true });
  const copied = [];
  for (const name of names) {
    const info = await stat(join(from, name));
    if (!info.isFile()) continue;
    await copyFile(join(from, name), join(OUT, 'assets', name));
    copied.push([name, info.size]);
  }
  return copied;
}

async function assemble() {
  const info = await stat(BUILT).catch(() => null);
  if (!info || !info.size) {
    throw new Error(`${BUILT} is missing or empty — run "npm run build" first`);
  }

  const html = await readFile(BUILT, 'utf8');
  for (const [pattern, message] of CHECKS) {
    if (!pattern.test(html)) throw new Error(message);
  }
  for (const [pattern, message] of MUST_NOT) {
    if (pattern.test(html)) throw new Error(message);
  }

  await mkdir(OUT, { recursive: true });
  // The bundled file becomes the site's index, so the URL serves exactly one
  // resource and cannot be half-updated by a browser cache.
  await copyFile(BUILT, join(OUT, 'index.html'));
  // The same file, offered as a download for anyone who wants it offline.
  await copyFile(BUILT, join(OUT, 'portfolio-tracker.html'));
  // Tells GitHub Pages not to run the files through Jekyll. Vercel ignores it.
  await writeFile(join(OUT, '.nojekyll'), '');

  // Anything too big to inline. Today that is the sign-in video: at 16 MB it
  // would be 21 MB of base64 inside a 456 KB page, so the hosted site fetches
  // it and the single file goes without and falls back to the drawn scene.
  const copied = await copyAssets();

  console.log(`Assembled ${OUT}`);
  console.log(`  index.html — ${Math.round(html.length / 1024)} KB, self-contained`);
  for (const [name, bytes] of copied) {
    console.log(`  assets/${name} — ${Math.round(bytes / 1024)} KB`);
  }
}

assemble().catch((err) => {
  console.error(`Assemble failed: ${err.message}`);
  process.exit(1);
});
