/**
 * Spot whale trades, read from GeckoTerminal on the GitHub runner.
 *
 *   node scripts/collect-spot.mjs https://riskbook.vercel.app <key>
 *
 * Here rather than on the server because GeckoTerminal refused the server:
 * its limit is counted per IP, a serverless function shares its outgoing
 * addresses with every other site on the platform, and one run saw 13 of its
 * 17 calls come back 429. A runner has an address of its own, no sixty-second
 * ceiling, and time to pace itself — so it reads every known pool every run
 * instead of a fourteen-pool slice, slowly: GeckoTerminal's real allowance is
 * far below its published one (see GAP_MS).
 *
 * Asks the server what to read, reads it, posts it back. The server checks
 * everything posted against the current top fifty before writing any of it.
 */
import { discoverPools, readTrades } from '../api/_lib/dexspot.js';

const [BASE, KEY] = process.argv.slice(2);
if (!BASE || !KEY) {
  console.error('usage: node scripts/collect-spot.mjs <base-url> <key>');
  process.exit(2);
}

/**
 * The pace, measured rather than read off the documentation.
 *
 * GeckoTerminal publishes thirty calls a minute. Measured on 1 October 2026 it
 * allowed five calls at 2.5s apart before refusing for most of a minute, and at
 * 10s apart still refused two in fourteen. So: one call every ten seconds, a
 * refusal waited out and retried, and every refusal slows the rest of the run a
 * little more. Slow is free here; a run on a public repository costs nothing.
 */
const GAP_MS = 10_000;
const GAP_STEP_MS = 2_000;
const GAP_MAX_MS = 20_000;
const BACKOFF_MS = 30_000;
const ATTEMPTS = 3;
/** Pool lookups per run, for coins never searched or searched long ago. */
const DISCOVERY_CALLS = 12;
const STALE_S = 3 * 24 * 60 * 60;
/** Stop reading and post what there is, well inside the job's timeout. */
const DEADLINE_MS = 18 * 60_000;
const POST_BATCH = 1_000;

const started = Date.now();
const overDeadline = () => Date.now() - started > DEADLINE_MS;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let lastCall = 0;
let gap = GAP_MS;
let refusals = 0;
const failures = [];

/** One GeckoTerminal call, paced; a 429 is waited out and retried, and slows the run. */
async function paced(label, fn) {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const wait = lastCall + gap - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    try {
      return await fn();
    } catch (err) {
      const refused = /\b429\b/.test(err.message);
      if (refused) {
        refusals += 1;
        gap = Math.min(GAP_MAX_MS, gap + GAP_STEP_MS);
      }
      if (refused && attempt < ATTEMPTS && !overDeadline()) {
        console.log(`  ${label}: refused (429), waiting ${BACKOFF_MS / 1000}s; pace now ${gap / 1000}s`);
        await sleep(BACKOFF_MS);
        continue;
      }
      failures.push(`${label}: ${err.message}`);
      return null;
    }
  }
  return null;
}

async function server(resource, init = {}) {
  const res = await fetch(`${BASE}/api/whales?resource=${resource}&key=${encodeURIComponent(KEY)}`, {
    ...init,
    signal: AbortSignal.timeout(60_000),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`${resource} answered ${res.status}: ${body.slice(0, 300)}`);
  return JSON.parse(body);
}

/**
 * The server could not be reached or could not store: stop, in red.
 *
 * A failed run is what makes GitHub email the owner. GeckoTerminal refusing a
 * few calls is a bad afternoon and stays a warning; the server failing means
 * nothing is being collected at all, which is how the card went empty for four
 * days in September without anyone being told.
 */
function giveUp(what, err) {
  console.log(`::error::spot: could not ${what}: ${err.message}`);
  process.exit(1);
}

let plan;
try {
  plan = await server('spotplan');
} catch (err) {
  giveUp('get the plan from the server', err);
}
console.log(`plan: ${plan.coins.length} coins, ${plan.pools.length} known pools`);

/* ── discovery: coins never searched first, then the stalest ─────────── */

const nowS = Math.floor(Date.now() / 1000);
const due = [
  ...plan.coins.filter((c) => c.checked == null),
  ...plan.coins
    .filter((c) => c.checked != null && nowS - c.checked > STALE_S)
    .sort((a, b) => a.checked - b.checked),
].filter((c) => c.tokens.length);

const found = [];
const none = [];
let lookups = 0;
for (const coin of due) {
  if (lookups + coin.tokens.length > DISCOVERY_CALLS || overDeadline()) break;
  let pools = 0;
  let clean = true;
  for (const [network, token] of coin.tokens) {
    lookups += 1;
    const got = await paced(`pools ${coin.symbol}/${network}`, () => discoverPools(network, token));
    if (got == null) { clean = false; continue; }
    for (const p of got) found.push({ symbol: coin.symbol, network, token, pool: p.pool, dex: p.dex });
    pools += got.length;
  }
  // Only a search that fully answered may conclude there is nothing to read.
  if (!pools && clean) none.push(coin.symbol);
}
console.log(`discovery: ${lookups} lookups, ${found.length} pools found, ${none.length} coins with none`);

/* ── trades: every known pool, plus any just found ───────────────────── */

const seen = new Set();
const unique = [...plan.pools, ...found].filter((p) => {
  const key = `${p.network}|${p.pool}|${p.token}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});
// Start somewhere different each hour, so a run cut off at the deadline does
// not leave the same pools unread every time.
const offset = unique.length ? Math.floor(Date.now() / 3_600_000) * 17 % unique.length : 0;
const pools = [...unique.slice(offset), ...unique.slice(0, offset)];

const trades = [];
let read = 0;
for (const pool of pools) {
  if (overDeadline()) {
    failures.push(`stopped at the deadline with ${pools.length - read} pools unread`);
    break;
  }
  const got = await paced(`trades ${pool.symbol}/${pool.network}`, () => readTrades(pool));
  if (got == null) continue;
  read += 1;
  trades.push(...got);
}
console.log(`trades: ${read}/${pools.length} pools read, ${trades.length} trades over the floor, ${refusals} refusals, final pace ${gap / 1000}s`);

/* ── post it back ────────────────────────────────────────────────────── */

const totals = { pools: 0, trades: 0, written: 0, skipped: 0 };
for (let i = 0; i === 0 || i < trades.length; i += POST_BATCH) {
  const body = {
    found: i === 0 ? found : [],
    none: i === 0 ? none : [],
    // How the run went, recorded by the server for the card's freshness line.
    report: i === 0 ? { read, pools: pools.length, failed: failures.length } : undefined,
    trades: trades.slice(i, i + POST_BATCH),
  };
  let stored;
  try {
    stored = await server('spot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    giveUp(`store ${trades.length} trades (read ${read}/${pools.length} pools)`, err);
  }
  for (const k of Object.keys(totals)) totals[k] += Number(stored[k]) || 0;
}
console.log(`stored: ${JSON.stringify(totals)}`);

/**
 * Surfaced as a warning on the run, in the same words, because annotations are
 * public on this repository and the job log is not.
 */
if (failures.length) {
  const first = failures.slice(0, 3).join(' | ');
  console.log(`::warning::spot: ${failures.length} of ${lookups + pools.length} calls failed (read ${read}/${pools.length} pools, wrote ${totals.written}). First: ${first}`);
}
