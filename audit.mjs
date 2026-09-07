/**
 * Every endpoint the app has, driven the way the browser drives them.
 *
 * Not a smoke test: each answer is checked for shape, for sanity, and for
 * whether the numbers in it could plausibly be real. An endpoint that returns
 * 200 with an empty body has failed as far as this is concerned.
 */
import { deriveAuthSecret } from './src/core/crypto.js';

const BASE = process.argv[2] || 'https://riskbook.vercel.app';
let cookie = null;

async function call(path, { method = 'GET', body, auth = true } = {}) {
  const t0 = Date.now();
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(auth && cookie ? { cookie } : {}),
        origin: BASE,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(90_000),
    });
  } catch (err) {
    return { status: 0, secs: (Date.now() - t0) / 1000, err: err.message, body: null, bytes: 0 };
  }
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return {
    status: res.status,
    secs: (Date.now() - t0) / 1000,
    bytes: text.length,
    body: json,
    cache: res.headers.get('cache-control'),
  };
}

/* ── sign in ──────────────────────────────────────────────────────────── */
const salts = await call('/api/auth/begin', { method: 'POST', body: { email: 'demo@riskbook.app' }, auth: false });
const login = await call('/api/auth/login', {
  method: 'POST',
  body: { email: 'demo@riskbook.app', authSecret: await deriveAuthSecret('12345678', salts.body?.authSalt) },
  auth: false,
});
console.log(`sign in: begin ${salts.status} · login ${login.status}\n`);
if (login.status !== 200) process.exit(1);

const results = [];
const check = (name, r, assertions) => {
  const problems = [];
  for (const [what, ok] of Object.entries(assertions)) {
    if (!ok) problems.push(what);
  }
  results.push({ name, ...r, problems });
  const kb = (r.bytes / 1024).toFixed(0);
  const flag = r.status !== 200 ? 'HTTP' : problems.length ? 'DATA' : 'ok';
  console.log(`${flag.padEnd(5)} ${String(r.status).padEnd(4)} ${String(r.secs.toFixed(1)).padStart(5)}s `
    + `${String(kb).padStart(5)}KB  ${name}`);
  for (const p of problems) console.log(`               ↳ ${p}`);
  if (r.err) console.log(`               ↳ ${r.err}`);
};

/* ── the endpoints ────────────────────────────────────────────────────── */
console.log('STATE  CODE   TIME   SIZE  ENDPOINT');

const cfg = await call('/api/config', { auth: false });
check('/api/config', cfg, {
  'has a cloud flag': cfg.body && typeof cfg.body === 'object',
  'leaks no secret': !JSON.stringify(cfg.body ?? {}).match(/key|secret|password/i),
});

const vault = await call('/api/vault');
check('/api/vault', vault, {
  'returns an encrypted vault': !!vault.body?.vault,
  'vault is ciphertext, not plaintext JSON': typeof vault.body?.vault === 'string'
    && !String(vault.body?.vault).includes('"positions"'),
  'has a version for conflict checks': Number.isFinite(vault.body?.vaultVersion),
});

const quote = await call('/api/quote?symbols=AAPL,MSFT');
check('/api/quote (AAPL,MSFT)', quote, {
  'returns a price for AAPL': Number(quote.body?.quotes?.AAPL?.price ?? quote.body?.AAPL?.price) > 0,
});

const hist = await call('/api/history?symbol=AAPL&range=1mo');
check('/api/history (AAPL 1mo)', hist, {
  'returns candles': Array.isArray(hist.body?.candles ?? hist.body?.points ?? hist.body?.rows),
});

for (const panel of ['fed', 'econ', 'sentiment', 'etf', 'options', 'weekstart']) {
  const r = await call(`/api/${panel}`);
  const b = r.body ?? {};
  const filled = Object.values(b).some((v) => (Array.isArray(v) && v.length)
    || (v && typeof v === 'object' && Object.keys(v).length));
  check(`/api/${panel}`, r, {
    'answers with something, not an empty object': filled,
    'reports no internal error': !b.error,
  });
}

/* ── the whale resources ─────────────────────────────────────────────── */
const coins = await call('/api/whales?resource=coins');
check('whales?resource=coins', coins, {
  'returns fifty coins': (coins.body?.coins ?? []).length === 50,
  'each has a rank and a symbol': (coins.body?.coins ?? []).every((c) => c.rank && c.symbol),
  'some are watchable': (coins.body?.watchable ?? 0) > 0,
});

const feed = await call('/api/whales?resource=feed&min=25000000&hours=168');
const rows = feed.body?.rows ?? [];
check('whales?resource=feed', feed, {
  'every row is classified': rows.every((r) => r.activity?.action),
  'every row is above the floor': rows.every((r) => r.usd >= 25e6),
  'every row is inside the window': !feed.body?.window?.since
    || rows.every((r) => r.at >= feed.body.window.since),
  'no buy or sell without both legs': !rows.some((r) => /Buy|Sell/.test(r.activity?.action ?? '')
    && !r.activity?.confirmed),
  'newest first': rows.every((r, i) => i === 0 || rows[i - 1].at >= r.at),
});

const nf = await call('/api/whales?resource=netflow');
const nb = nf.body?.balances?.periods ?? [];
check('whales?resource=netflow', nf, {
  'has periods': (nf.body?.periods?.length ?? 0) + nb.length > 0,
  'sign convention holds (negative = bullish)': [...(nf.body?.periods ?? []), ...nb]
    .every((p) => p.netUsd == null || p.signal == null
      || (p.signal === 'Bullish' ? p.netUsd < 0 : p.signal === 'Bearish' ? p.netUsd > 0 : true)),
  'stablecoin dominance present': Number.isFinite(nf.body?.stables?.dominance),
  'dominance is a plausible percentage': !nf.body?.stables
    || (nf.body.stables.dominance > 1 && nf.body.stables.dominance < 40),
  'full dominance window not leaked': nf.body?.stables?.values === undefined,
});

const th = await call('/api/whales?resource=topholders&symbol=LINK');
const hs = th.body?.holders ?? [];
check('whales?resource=topholders (LINK)', th, {
  'returns holders': hs.length > 0,
  'at most twenty-five': hs.length <= 25,
  'ranked biggest first': hs.every((h, i) => i === 0 || (hs[i - 1].usd ?? 0) >= (h.usd ?? 0)),
  'ranks are consecutive': hs.every((h, i) => h.rank === i + 1),
  'no exchange or contract in the ranking': hs.every((h) => h.kind === 'whale'),
  'supply shares are possible': hs.every((h) => h.pctSupply == null
    || (h.pctSupply >= 0 && h.pctSupply <= 100)),
});

const gone = await call('/api/whales?resource=verdict');
check('whales?resource=verdict (removed)', gone, {
  'refused with 400': gone.status === 400,
});

/* ── auth boundary ───────────────────────────────────────────────────── */
const saved = cookie;
cookie = null;
const anon = await call('/api/whales?resource=feed', { auth: false });
check('whales without a session', anon, { 'refused with 401': anon.status === 401 });
const anonVault = await call('/api/vault', { auth: false });
check('vault without a session', anonVault, { 'refused with 401': anonVault.status === 401 });
cookie = saved;

/* ── summary ─────────────────────────────────────────────────────────── */
const bad = results.filter((r) => r.status >= 400 || r.status === 0 || r.problems.length);
console.log(`\n${results.length - bad.length}/${results.length} endpoints clean`);
if (bad.length) {
  console.log('\nPROBLEMS:');
  for (const r of bad) {
    console.log(`  ${r.name} (${r.status}) ${r.problems.join('; ')}${r.err ? ` — ${r.err}` : ''}`);
  }
}
const slow = results.filter((r) => r.secs > 3).sort((a, b) => b.secs - a.secs);
if (slow.length) {
  console.log('\nSLOW (>3s):');
  for (const r of slow) console.log(`  ${r.secs.toFixed(1)}s  ${r.name}`);
}
const big = results.filter((r) => r.bytes > 200_000).sort((a, b) => b.bytes - a.bytes);
if (big.length) {
  console.log('\nLARGE PAYLOADS (>200KB):');
  for (const r of big) console.log(`  ${(r.bytes / 1024).toFixed(0)}KB  ${r.name}`);
}
