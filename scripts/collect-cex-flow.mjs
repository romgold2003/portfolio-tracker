/**
 * Fetch the exchange balance history and post it to the deployment.
 *
 * Run from GitHub Actions, once a day, because the work does not fit anywhere
 * else. Each exchange's published history is about forty megabytes — every
 * token, every day, since 2022 — and a Vercel function has sixty seconds and a
 * few hundred megabytes. A runner has neither limit and costs nothing on a
 * public repository.
 *
 * What it sends back is tiny: one row per exchange per day, holding what
 * arrived and what left, with the price effect already removed.
 *
 *   node scripts/collect-cex-flow.mjs https://riskbook.vercel.app <key>
 */
import {
  listExchanges, fetchSeries, dailyFlows,
} from '../api/_lib/cexflow.js';

const BASE = (process.argv[2] || '').replace(/\/$/, '');
const KEY = process.argv[3] || process.env.CRON_SECRET || '';
/**
 * Everything the source has, which is back to November 2022.
 *
 * It was four hundred days, which covered the longest period the card could
 * then be asked for. The card is a graph now with an "All" frame, and an All
 * that quietly means "the last thirteen months" would be the sort of lie that
 * is impossible to spot from the outside. Asking for more days than exist
 * simply returns what exists.
 */
const DAYS = Number(process.env.CEX_DAYS) || 4000;

/**
 * Days per POST.
 *
 * The endpoint refuses more than a thousand rows in one request, and four
 * years is fourteen hundred. Five hundred keeps each body comfortably inside
 * both that cap and the body-size limit.
 */
const CHUNK = 500;

if (!BASE || !KEY) {
  console.error('usage: node scripts/collect-cex-flow.mjs <base-url> <cron-secret>');
  process.exit(1);
}

async function post(venue, days) {
  const res = await fetch(`${BASE}/api/whales?resource=cexflow&key=${encodeURIComponent(KEY)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ venue, days }),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

const { exchanges, missing } = await listExchanges({ limit: 16 });
console.log(`${exchanges.length} exchanges publish their wallets`);
if (missing.length) console.log(`not covered (no published wallet set): ${missing.join(', ')}`);

let sent = 0;
let failed = 0;

for (const ex of exchanges) {
  try {
    const series = await fetchSeries(ex.slug);
    const days = dailyFlows(series, { days: DAYS });
    if (!days.length) {
      console.log(`  ${ex.name.padEnd(16)} no usable series`);
      continue;
    }

    /**
     * Oldest chunk first, so a run that dies halfway leaves a prefix of
     * history rather than a hole in the middle of it.
     */
    let written = 0;
    let broke = false;
    for (let i = 0; i < days.length; i += CHUNK) {
      const answer = await post(ex.name, days.slice(i, i + CHUNK));
      if (answer.status !== 200) {
        failed += 1;
        broke = true;
        console.log(`  ${ex.name.padEnd(16)} POST ${answer.status} ${JSON.stringify(answer.body)}`);
        break;
      }
      written += answer.body?.written ?? 0;
    }
    if (broke) continue;

    sent += written;
    const net = days.reduce((n, d) => n + d.netUsd, 0);
    console.log(`  ${ex.name.padEnd(16)} ${String(days.length).padStart(4)} days · `
      + `net ${net < 0 ? '-' : '+'}$${(Math.abs(net) / 1e9).toFixed(2)}B over the window`);
  } catch (err) {
    failed += 1;
    console.log(`  ${ex.name.padEnd(16)} ${err.message}`);
  }
}

console.log(`\n${sent} day-rows stored, ${failed} exchange(s) failed`);
// A provider having a bad afternoon is not worth failing the workflow over;
// every exchange failing is.
process.exit(failed && !sent ? 1 : 0);
