/**
 * Builds a single self-contained HTML file that runs from a double-click.
 *
 *   npm run build
 *
 * The app is normally served over HTTP because browsers refuse to load ES
 * modules from `file://`. Bundling every module into one classic script removes
 * the module loader from the picture entirely, so the result needs no server,
 * no install, and no network except for live prices.
 *
 * esbuild is fetched on demand by npx and is a build-time tool only. The file
 * it produces still has zero runtime dependencies, which is the promise that
 * matters.
 */
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../', import.meta.url)));
const OUT_DIR = join(ROOT, 'dist');
const OUT_FILE = join(OUT_DIR, 'portfolio-tracker.html');
const TMP_BUNDLE = join(OUT_DIR, '.bundle.js');

/** Pinned, so a new esbuild release can never change what this produces. */
const ESBUILD_VERSION = 'esbuild@0.24.0';

const CHART_URL = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js';

const read = (relative) => readFile(join(ROOT, relative), 'utf8');

/**
 * Chart.js is pulled in at build time so the finished file works offline.
 * If it cannot be fetched, fall back to the CDN tag rather than failing the
 * build — charts then need a connection, everything else still works.
 */
async function inlineChartJs() {
  try {
    const res = await fetch(CHART_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const source = await res.text();
    console.log(`  Chart.js inlined (${Math.round(source.length / 1024)} KB)`);
    return `<script>${source}</script>`;
  } catch (err) {
    console.warn(`  Chart.js could not be fetched (${err.message}) — leaving the CDN tag`);
    return `<script src="${CHART_URL}"></script>`;
  }
}

async function bundleApp() {
  await mkdir(OUT_DIR, { recursive: true });
  // Node refuses to spawn a .cmd without a shell on Windows, and npx is a .cmd
  // there. Quoting the paths keeps a space in the project folder from splitting
  // into two arguments once the shell gets involved.
  const isWindows = process.platform === 'win32';
  const quote = (value) => (isWindows ? `"${value}"` : value);
  execFileSync(
    'npx',
    ['--yes', ESBUILD_VERSION, quote(join(ROOT, 'src/main.js')),
      '--bundle', '--format=iife', '--target=es2022', `--outfile=${quote(TMP_BUNDLE)}`],
    { stdio: ['ignore', 'ignore', 'inherit'], shell: isWindows },
  );
  const code = await readFile(TMP_BUNDLE, 'utf8');
  await rm(TMP_BUNDLE, { force: true });
  console.log(`  app bundled (${Math.round(code.length / 1024)} KB)`);
  return code;
}

/** Everything the four stylesheets hold, in the order the page links them. */
async function inlineStyles() {
  const sheets = ['tokens', 'base', 'layout', 'components'];
  const parts = await Promise.all(sheets.map((name) => read(`styles/${name}.css`)));
  return parts.join('\n');
}

async function build() {
  console.log('Building standalone file…');

  const [html, css, chartTag, appCode] = await Promise.all([
    read('index.html'),
    inlineStyles(),
    inlineChartJs(),
    bundleApp(),
  ]);

  let out = html
    // The four <link> tags become one inline stylesheet.
    .replace(
      /<!-- Stylesheets[\s\S]*?<link rel="stylesheet" href="styles\/components\.css">/,
      `<style>\n${css}\n</style>`,
    )
    // The CDN script tag becomes the library itself.
    .replace(
      /<!-- Charting[\s\S]*?<script src="https:\/\/cdnjs[^>]*><\/script>/,
      chartTag,
    )
    // The module entry point becomes the whole bundled app.
    .replace(
      /<!-- The app boots[\s\S]*?<script type="module" src="src\/main\.js"><\/script>/,
      `<script>\n${appCode}\n</script>`,
    );

  // A missed replacement would ship a file that silently does nothing.
  const leftovers = [
    [/<link rel="stylesheet"/, 'a stylesheet link'],
    [/<script type="module"/, 'the module script tag'],
    [/src="src\/main\.js"/, 'the app entry point'],
  ].filter(([pattern]) => pattern.test(out));
  if (leftovers.length) {
    throw new Error(`Inlining missed: ${leftovers.map(([, what]) => what).join(', ')}`);
  }

  /**
   * Stamp the build so a running page can say which one it is.
   *
   * The commit and the day it was built, nothing else. This exists because
   * "that is fixed" and "it still does it" have crossed more than once, and
   * every time the answer was a tab holding JavaScript from an earlier deploy
   * — which nothing on screen could have told either of us.
   *
   * Falls back to the date alone outside a git checkout, so a build never
   * fails for want of it.
   */
  let commit = '';
  try {
    commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch { /* not a checkout, or no git; the date alone still identifies it */ }
  const stamp = [commit, new Date().toISOString().slice(0, 10)].filter(Boolean).join(' · ');
  out = out.replace('<span id="buildStamp">—</span>', `<span id="buildStamp">${stamp}</span>`);

  await mkdir(dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, out, 'utf8');
  console.log(`\nWrote ${OUT_FILE}`);
  console.log(`  ${Math.round(out.length / 1024)} KB, self-contained`);
  console.log('  Double-click it. No server, no install.');
}

build().catch((err) => {
  console.error(`Build failed: ${err.message}`);
  process.exit(1);
});
