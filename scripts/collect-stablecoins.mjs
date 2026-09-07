/**
 * Build the stablecoin dominance history and post it to the deployment.
 *
 * Runs beside collect-cex-flow.mjs in the same daily Action, and for the same
 * reason: the work does not fit in a serverless function. The numerator is one
 * large download; the denominator is one paced request per coin, and pacing is
 * the point — CoinGecko's free tier is generous but not unlimited, and a job
 * with twenty-five minutes has all the time it needs to be polite.
 *
 *   node scripts/collect-stablecoins.mjs https://riskbook.vercel.app <key>
 */
import {
  fetchStableHistory, fetchTotalHistory, fetchTrueTotal, combine,
} from '../api/_lib/stablecoins.js';

const BASE = (process.argv[2] || '').replace(/\/$/, '');
const KEY = process.argv[3] || process.env.CRON_SECRET || '';
const COINS = Number(process.env.STABLE_COINS) || 30;

if (!BASE || !KEY) {
  console.error('usage: node scripts/collect-stablecoins.mjs <base-url> <cron-secret>');
  process.exit(1);
}

console.log('stablecoin market cap, daily, from the published series');
const stable = await fetchStableHistory();
console.log(`  ${stable.length} days, ${stable[0]?.day} to ${stable[stable.length - 1]?.day}`);

console.log(`\ntotal market cap, rebuilt from the top ${COINS}`);
const { series: total, used } = await fetchTotalHistory({ coins: COINS, log: () => {} });
console.log(`  ${used}/${COINS} coins answered · ${total.length} days`);

const trueTotal = await fetchTrueTotal().catch(() => null);
console.log(`  true total today: ${trueTotal ? `$${(trueTotal / 1e12).toFixed(3)}T` : 'unavailable'}`);

const { rows, scale } = combine({ stable, total, trueTotalNow: trueTotal });
console.log(`  rebuilt total is ${(100 / scale).toFixed(1)}% of the true one, and is scaled to it`);
console.log(`\n${rows.length} days where both halves are known`);

if (!rows.length) {
  console.error('nothing to send');
  process.exit(1);
}

/** Only what the card reads back: a bit over a year. */
const recent = rows.slice(-400);
const latest = recent[recent.length - 1];
console.log(`  today: ${latest.day} · $${(latest.stableUsd / 1e9).toFixed(1)}B of `
  + `$${(latest.totalUsd / 1e12).toFixed(3)}T = ${(latest.stableUsd / latest.totalUsd * 100).toFixed(2)}%`);

const CHUNK = 200;
let written = 0;
for (let i = 0; i < recent.length; i += CHUNK) {
  const res = await fetch(`${BASE}/api/whales?resource=stablecoins&key=${encodeURIComponent(KEY)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ days: recent.slice(i, i + CHUNK) }),
  });
  const body = await res.json().catch(() => null);
  if (res.status !== 200) {
    console.error(`POST ${res.status} ${JSON.stringify(body)}`);
    process.exit(1);
  }
  written += body?.written ?? 0;
}

console.log(`\n${written} day-rows stored`);
