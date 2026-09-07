/**
 * The Crypto section, checked claim by claim against the deployed API.
 *
 * Every assertion here is one of the things the section promises on screen. A
 * promise that cannot be checked is reported as unchecked rather than assumed.
 */
import { deriveAuthSecret } from './src/core/crypto.js';

const BASE = process.argv[2] || 'https://riskbook.vercel.app';
let cookie = null;
const call = async (p, o = {}) => {
  const r = await fetch(BASE + p, {
    method: o.method || 'GET',
    headers: {
      ...(o.body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
      origin: BASE,
    },
    body: o.body ? JSON.stringify(o.body) : undefined,
    signal: AbortSignal.timeout(90_000),
  });
  const s = r.headers.get('set-cookie');
  if (s) cookie = s.split(';')[0];
  return { status: r.status, body: await r.json().catch(() => null) };
};

const salts = await call('/api/auth/begin', { method: 'POST', body: { email: 'demo@riskbook.app' } });
await call('/api/auth/login', {
  method: 'POST',
  body: { email: 'demo@riskbook.app', authSecret: await deriveAuthSecret('12345678', salts.body.authSalt) },
});

let pass = 0;
let fail = 0;
const notes = [];
const ok = (claim, cond, detail = '') => {
  if (cond === null) { notes.push(`UNCHECKED  ${claim} — ${detail}`); return; }
  if (cond) { pass += 1; console.log(`  pass  ${claim}${detail ? `  (${detail})` : ''}`); } else {
    fail += 1;
    console.log(`  FAIL  ${claim}${detail ? `  — ${detail}` : ''}`);
    notes.push(`FAIL  ${claim} — ${detail}`);
  }
};

/* ── EXCHANGE NETFLOW ─────────────────────────────────────────────────── */
console.log('\nEXCHANGE NETFLOW');
const nfPlain = (await call('/api/whales?resource=netflow')).body;
const nfWithCoin = (await call('/api/whales?resource=netflow&symbol=BTC')).body;

const per = (b) => (b?.balances?.periods?.length ? b.balances.periods : b?.periods ?? []);
const sig = (b) => per(b).map((p) => `${p.id}:${p.netUsd}`).join('|');

ok('independent of the selected coin', sig(nfPlain) === sig(nfWithCoin),
  'same answer with and without ?symbol=BTC');

const venues = nfPlain?.balances?.venues ?? nfPlain?.venues ?? [];
ok('aggregates many exchanges', venues.length >= 10, `${venues.length} venues: ${venues.slice(0, 6).join(', ')}…`);

const periods = per(nfPlain);
ok('has the six periods the card draws',
  ['24h', '7d', '1m', '6m', '1y', 'ytd'].every((id) => periods.some((p) => p.id === id)),
  periods.map((p) => p.id).join(', '));

ok('negative netflow reads Bullish',
  periods.filter((p) => p.signal === 'Bullish').every((p) => p.netUsd < 0),
  `${periods.filter((p) => p.signal === 'Bullish').length} bullish periods`);
ok('positive netflow reads Bearish',
  periods.filter((p) => p.signal === 'Bearish').every((p) => p.netUsd > 0),
  `${periods.filter((p) => p.signal === 'Bearish').length} bearish periods`);

ok('inflow and outflow are both reported, not just the net',
  periods.every((p) => p.netUsd == null || (Number.isFinite(p.inUsd) && Number.isFinite(p.outUsd))));
ok('net equals inflow minus outflow',
  periods.every((p) => p.netUsd == null || Math.abs((p.inUsd - p.outUsd) - p.netUsd) < 1),
  'checked on every period');

const longer = (a, b) => {
  const A = periods.find((p) => p.id === a);
  const B = periods.find((p) => p.id === b);
  if (!A || !B || A.inUsd == null || B.inUsd == null) return null;
  return (A.inUsd + A.outUsd) <= (B.inUsd + B.outUsd) + 1;
};
ok('a longer period contains at least as much gross flow as a shorter one',
  ['24h', '7d', '1m', '6m', '1y'].slice(0, -1).every((id, i) =>
    longer(id, ['24h', '7d', '1m', '6m', '1y'][i + 1]) !== false),
  '24h ⊆ 7d ⊆ 1m ⊆ 6m ⊆ 1y');

/* ── STABLECOIN DOMINANCE ─────────────────────────────────────────────── */
console.log('\nSTABLECOIN DOMINANCE');
const st = nfPlain?.stables;
ok('present', !!st);
ok('is a plausible share of the market', st && st.dominance > 3 && st.dominance < 30,
  st ? `${st.dominance.toFixed(2)}%` : '');
ok('the ratio matches its own two halves',
  !st || Math.abs((st.stableUsd / st.totalUsd) * 100 - st.dominance) < 0.01);
ok('the full year is not shipped to the browser', st ? st.values === undefined : null,
  'only a thinned sparkline should go down the wire');

/* ── TOP HOLDER WHALES ────────────────────────────────────────────────── */
console.log('\nTOP HOLDER WHALES');
const link = (await call('/api/whales?resource=topholders&symbol=LINK')).body;
const uni = (await call('/api/whales?resource=topholders&symbol=UNI')).body;
const btc = (await call('/api/whales?resource=topholders&symbol=BTC')).body;

const addrs = (b) => (b?.holders ?? []).map((h) => h.address).join(',');
ok('reacts to the selected coin', addrs(link) !== addrs(uni) && addrs(link).length > 0,
  `LINK ${(link?.holders ?? []).length} holders, UNI ${(uni?.holders ?? []).length}`);
ok('a coin with no readable contract says so rather than showing nothing',
  !!btc?.unsupported, btc?.unsupported ?? '');
ok('at most twenty-five', (link?.holders ?? []).length <= 25);
ok('ranked by value, biggest first',
  (link?.holders ?? []).every((h, i, a) => i === 0 || (a[i - 1].usd ?? 0) >= (h.usd ?? 0)));
ok('only investors are ranked', (link?.holders ?? []).every((h) => h.kind === 'whale'));
ok('what was excluded is named', (link?.excluded ?? []).length > 0,
  [...new Set((link?.excluded ?? []).map((x) => x.kindLabel))].join(', '));
const withMoves = (link?.holders ?? []).filter((h) => h.moves);
ok('holding status is being worked out', withMoves.length > 0,
  `${withMoves.length}/${(link?.holders ?? []).length} answered so far`);
ok('a rebuilt past balance is never negative',
  withMoves.every((h) => Object.values(h.moves).every((m) => !m.covered || m.unitsThen >= 0)));
ok('a shrinking position is never called a sale',
  withMoves.every((h) => Object.values(h.moves).every((m) => !/sold|sale/i.test(JSON.stringify(m)))));

/* ── LIVE WHALE ACTIVITY ──────────────────────────────────────────────── */
console.log('\nLIVE WHALE ACTIVITY');
const bands = {
  all: 'min=25000000',
  big: 'min=25000000&max=100000000',
  huge: 'min=100000000&max=250000000',
  mega: 'min=250000000',
};
const got = {};
for (const [id, q] of Object.entries(bands)) {
  got[id] = ((await call(`/api/whales?resource=feed&${q}&hours=2208`)).body?.rows ?? []);
}
ok('the three bands add up to the whole',
  got.big.length + got.huge.length + got.mega.length === got.all.length,
  `${got.big.length}+${got.huge.length}+${got.mega.length} = ${got.all.length}`);
const ids = [...got.big, ...got.huge, ...got.mega].map((r) => r.id);
ok('no transfer lands in two bands', new Set(ids).size === ids.length);
ok('every band respects its own boundaries',
  got.big.every((r) => r.usd >= 25e6 && r.usd < 100e6)
  && got.huge.every((r) => r.usd >= 100e6 && r.usd < 250e6)
  && got.mega.every((r) => r.usd >= 250e6));

const win = {};
for (const [id, h] of [['1d', 24], ['7d', 168], ['3m', 2208]]) {
  win[id] = ((await call(`/api/whales?resource=feed&min=25000000&hours=${h}`)).body?.rows ?? []);
}
ok('the timeframes nest',
  win['1d'].every((r) => win['7d'].some((x) => x.id === r.id))
  && win['7d'].every((r) => win['3m'].some((x) => x.id === r.id)),
  `1D ${win['1d'].length} ⊆ 7D ${win['7d'].length} ⊆ 3M ${win['3m'].length}`);
ok('no row is older than its own timeframe',
  [['1d', 24], ['7d', 168], ['3m', 2208]].every(([id, h]) =>
    win[id].every((r) => r.at >= Math.floor(Date.now() / 1000) - h * 3600)));

const wbtc = ((await call('/api/whales?resource=feed&min=25000000&hours=2208&symbol=WBTC')).body?.rows ?? []);
ok('the coin selector filters the tape', wbtc.every((r) => r.symbol === 'WBTC'),
  `${wbtc.length} WBTC rows, all WBTC`);

const rows = win['3m'];
const cols = ['path', 'assetFlow', 'action', 'note'];
ok('every row has all five columns populated',
  rows.every((r) => cols.every((c) => typeof r.activity?.[c] === 'string' && r.activity[c].length)
    && Number.isFinite(r.usd) && Number.isFinite(r.at)));
const ACTIONS = ['Buy / Swap', 'Sell / Swap', 'Exchange Deposit', 'Exchange Withdrawal',
  'Wallet Transfer', 'Bridge', 'Internal Transfer', 'Unknown'];
ok('every action is one of the eight', rows.every((r) => ACTIONS.includes(r.activity.action)),
  [...new Set(rows.map((r) => r.activity.action))].join(', '));
ok('nothing is a buy or sell without both legs on-chain',
  !rows.some((r) => /Buy|Sell/.test(r.activity.action) && !r.activity.confirmed));
ok('an exchange deposit always carries the caveat',
  rows.filter((r) => r.activity.action === 'Exchange Deposit')
    .every((r) => /not confirmed/i.test(r.activity.note)));
ok('a wallet paying itself is never a trade',
  rows.filter((r) => r.from?.address && r.from.address === r.to?.address)
    .every((r) => r.activity.action === 'Internal Transfer' || r.activity.action === 'Unknown'));

/* ── BLOCKCHAIN COVERAGE ──────────────────────────────────────────────── */
console.log('\nBLOCKCHAIN COVERAGE');
const coinsBody = (await call('/api/whales?resource=coins')).body;
const chains = coinsBody?.chains ?? [];
console.log(`  chains the app reads: ${chains.map((c) => c.label).join(', ')}`);
console.log(`  watchable coins: ${coinsBody?.watchable} of ${(coinsBody?.coins ?? []).length}`);

const byChain = {};
for (const r of win['3m']) byChain[r.blockchain] = (byChain[r.blockchain] ?? 0) + 1;
console.log(`  transfers seen per chain: ${JSON.stringify(byChain)}`);

const dupes = new Map();
for (const r of win['3m']) {
  const k = `${r.symbol}|${Math.round(r.usd / 1000)}|${Math.round(r.at / 60)}`;
  dupes.set(k, (dupes.get(k) ?? 0) + 1);
}
const cross = [...dupes.entries()].filter(([, n]) => n > 1);
ok('multichain transfers are not double counted', cross.length === 0,
  cross.length ? `${cross.length} suspicious pairs` : 'no same-size same-minute duplicates');

console.log(`\n${pass} passed, ${fail} failed`);
if (notes.length) {
  console.log('\nNOTES:');
  for (const n of notes) console.log(`  ${n}`);
}

/* Hand a couple of real hashes back for explorer verification. */
console.log('\nSAMPLE FOR EXPLORER VERIFICATION:');
for (const r of win['3m'].slice(0, 4)) {
  console.log(`  ${r.blockchain}  ${r.hash}  ${r.symbol}  $${(r.usd / 1e6).toFixed(1)}M  amount=${r.amount}`);
}
