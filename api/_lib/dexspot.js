/**
 * Spot whale trades on decentralised exchanges, for the top-fifty coins.
 *
 * A trade on a DEX is on-chain from end to end: the wallet that signed it, the
 * coin that went in and the coin that came out are all in one transaction, so
 * "this wallet bought $2.1M of LINK" is a fact rather than an inference. That
 * is what the Spot panel is for, and the reason it reads DEX trades rather than
 * transfers — a transfer never says buy or sell.
 *
 * Source: GeckoTerminal's public API. No key, about thirty calls a minute per
 * address. The GitHub runner (scripts/collect-spot.mjs) does the reading: it
 * refreshes which pools each coin trades in, a few stale coins at a time, and
 * reads the large trades of every known pool, then posts them to the server.
 * The trades endpoint returns about the last day, so a pool read every few
 * hours misses little.
 *
 * Coins that trade almost only on centralised exchanges (XRP, ADA, DOGE…) have
 * no meaningful pool, and the panel says so rather than showing them empty.
 */
import { query, databaseAvailable } from './db.js';

const API = 'https://api.geckoterminal.com/api/v2';

/** The smallest trade kept: the lowest band the panel shows. */
export const FLOOR_USD = 500_000;

/** Pools thinner than this are not where whales trade, and their prices are noise. */
const MIN_POOL_USD = 2_000_000;

/** How many pools per coin and network are read. */
const POOLS_PER_TOKEN = 2;

export const RETAIN_MS = 30 * 24 * 60 * 60 * 1000;

/** CoinGecko's platform names to GeckoTerminal's network ids. */
export const NETWORKS = {
  ethereum: 'eth',
  'binance-smart-chain': 'bsc',
  solana: 'solana',
  base: 'base',
  'arbitrum-one': 'arbitrum',
  'polygon-pos': 'polygon_pos',
  avalanche: 'avax',
  'optimistic-ethereum': 'optimism',
  'sui': 'sui-network',
};

/**
 * Native coins have no contract; on-chain they trade as their wrapped token.
 * WBTC and cbBTC are how bitcoin is bought on Ethereum and Base, WETH how ether
 * is, and so on. Buying one is buying the coin.
 */
export const NATIVE = {
  BTC: [
    ['eth', '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599'],
    ['base', '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf'],
  ],
  ETH: [
    ['eth', '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'],
    ['base', '0x4200000000000000000000000000000000000006'],
    ['arbitrum', '0x82af49447d8a07e3bd95bd0d56f35241523fbab1'],
  ],
  BNB: [['bsc', '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c']],
  SOL: [['solana', 'So11111111111111111111111111111111111111112']],
  AVAX: [['avax', '0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7']],
  SUI: [['sui-network', '0x2::sui::SUI']],
};

/** The tokens to look for a coin's pools under: native wrappers, then its contracts. */
export function tokensFor(coin, platforms = {}) {
  const out = [...(NATIVE[coin.symbol] ?? [])];
  for (const [platform, address] of Object.entries(platforms ?? {})) {
    const network = NETWORKS[platform];
    if (!network || !address) continue;
    if (out.some(([n, a]) => n === network && a.toLowerCase() === String(address).toLowerCase())) continue;
    out.push([network, String(address)]);
  }
  return out;
}

/* ── storage ─────────────────────────────────────────────────────────── */

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS spot_pools (
     symbol    TEXT NOT NULL,
     network   TEXT NOT NULL,
     token     TEXT NOT NULL,
     pool      TEXT NOT NULL,
     dex       TEXT,
     checked   INTEGER NOT NULL,
     PRIMARY KEY (network, pool, token)
   )`,
  `CREATE TABLE IF NOT EXISTS spot_trades (
     id       TEXT PRIMARY KEY,
     at       INTEGER NOT NULL,
     symbol   TEXT NOT NULL,
     side     TEXT NOT NULL,
     amount   TEXT NOT NULL,
     usd      TEXT NOT NULL,
     address  TEXT NOT NULL,
     network  TEXT NOT NULL,
     dex      TEXT,
     hash     TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS spot_trades_at ON spot_trades (at)`,
];

let ready = false;
export function resetTableCache() { ready = false; }

async function ensureTables() {
  if (ready) return;
  for (const statement of SCHEMA) await query(statement, []);
  ready = true;
}

/* ── reading GeckoTerminal ───────────────────────────────────────────── */

/**
 * Ten seconds a call. The collector's budget is only checked between calls, so
 * without this a single request that never answered held the whole poll until
 * the platform cut it at sixty — and a cut function reports nothing at all.
 */
const CALL_TIMEOUT_MS = 10_000;

async function get(path, fetcher) {
  const res = await fetcher(`${API}${path}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`GeckoTerminal answered ${res.status}`);
  return res.json();
}

/** A token's deepest pools on one network. */
export async function discoverPools(network, token, { fetcher = fetch } = {}) {
  const json = await get(`/networks/${network}/tokens/${encodeURIComponent(token)}/pools?page=1`, fetcher);
  const dexOf = (p) => p?.relationships?.dex?.data?.id ?? null;
  return (json?.data ?? [])
    .map((p) => ({
      pool: String(p?.attributes?.address ?? ''),
      reserve: Number(p?.attributes?.reserve_in_usd) || 0,
      dex: dexOf(p),
    }))
    .filter((p) => p.pool && p.reserve >= MIN_POOL_USD)
    .sort((a, b) => b.reserve - a.reserve)
    .slice(0, POOLS_PER_TOKEN);
}

/**
 * One pool's large trades, as buys and sells of the coin.
 *
 * GeckoTerminal's own buy/sell is relative to whichever token the pool lists
 * first, so it is not used. The coin's side is read from the token addresses:
 * the coin going out of the wallet is a sale of it, coming in is a purchase.
 */
export function tradesOf(json, { symbol, token, network, dex }) {
  const coin = String(token).toLowerCase();
  const out = [];
  for (const item of json?.data ?? []) {
    const t = item?.attributes ?? {};
    const usd = Number(t.volume_in_usd);
    if (!(usd >= FLOOR_USD)) continue;
    const from = String(t.from_token_address ?? '').toLowerCase();
    const to = String(t.to_token_address ?? '').toLowerCase();
    let side = null;
    let amount = null;
    if (to === coin) { side = 'buy'; amount = Number(t.to_token_amount); }
    else if (from === coin) { side = 'sell'; amount = Number(t.from_token_amount); }
    if (!side || !(amount > 0) || !t.tx_hash || !t.tx_from_address) continue;
    const at = Math.floor(Date.parse(t.block_timestamp) / 1000);
    if (!Number.isFinite(at)) continue;
    out.push({
      id: `${network}:${t.tx_hash}:${side}:${symbol}`,
      at,
      symbol,
      side,
      amount,
      usd,
      address: String(t.tx_from_address),
      network,
      dex,
      hash: String(t.tx_hash),
    });
  }
  return out;
}

/* ── collecting: the runner fetches, the server plans and stores ────── */

/**
 * Why this is split in two.
 *
 * It used to run inside the server's scheduled poll, and GeckoTerminal refused
 * it: 13 of 17 calls in one run came back 429. Its limit is counted per IP, and
 * a serverless function shares its outgoing addresses with every other site on
 * the platform, so the allowance was largely spent before this app asked. The
 * poll also had sixty seconds for everything, which bought about fourteen of
 * eighty-odd pools a run — fine every ten minutes, hopeless when the scheduler
 * actually ran every four hours.
 *
 * So the fetching moved to the GitHub runner (scripts/collect-spot.mjs), which
 * has an address of its own, no sixty-second ceiling, and can pace itself and
 * read every pool every run. The server keeps the two things only it can do:
 * say which pools exist, and write what comes back — after checking it.
 */

/** A pool's large trades, read live. No database; the runner calls this. */
export async function readTrades(pool, { fetcher = fetch } = {}) {
  const json = await get(
    `/networks/${pool.network}/pools/${encodeURIComponent(pool.pool)}/trades?trade_volume_in_usd_greater_than=${FLOOR_USD}`,
    fetcher,
  );
  return tradesOf(json, { symbol: pool.symbol, token: pool.token, network: pool.network, dex: pool.dex });
}

/**
 * What the runner should do this time: each top coin with the tokens its pools
 * are found under and when they were last looked for, and the pools known now.
 */
export async function spotPlan({ coins, platformsOf }) {
  await ensureTables();
  const held = (await query('SELECT symbol, network, token, pool, dex, checked FROM spot_pools', [])).rows;
  const wanted = new Set(coins.map((c) => c.symbol));
  const checkedOf = new Map();
  for (const r of held) checkedOf.set(r.symbol, Math.max(checkedOf.get(r.symbol) ?? 0, Number(r.checked) || 0));
  return {
    coins: coins.map((c) => ({
      symbol: c.symbol,
      tokens: tokensFor(c, platformsOf(c)),
      checked: checkedOf.get(c.symbol) ?? null,
    })),
    pools: held
      .filter((r) => wanted.has(r.symbol) && r.pool !== '-')
      .map(({ symbol, network, token, pool, dex }) => ({ symbol, network, token, pool, dex })),
  };
}

/** Every network a pool or trade may legitimately be on. */
const NETWORK_IDS = new Set([
  ...Object.values(NETWORKS),
  ...Object.values(NATIVE).flat().map(([network]) => network),
]);
const text = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;

/** A posted pool, rebuilt field by field, or null. */
export function cleanPool(p, listed) {
  if (!p || !listed.has(p.symbol) || !NETWORK_IDS.has(p.network)) return null;
  if (!text(p.token, 120) || !text(p.pool, 120) || p.pool === '-') return null;
  if (p.dex != null && !text(p.dex, 80)) return null;
  return { symbol: p.symbol, network: p.network, token: p.token, pool: p.pool, dex: p.dex ?? null };
}

/**
 * A posted trade, rebuilt field by field, or null.
 *
 * The id is rebuilt here rather than taken from the body, so a trade cannot be
 * filed under someone else's id; and a time outside the kept window, or in the
 * future, is not a trade this panel could have been sent honestly.
 */
export function cleanTrade(t, listed, now = Date.now()) {
  if (!t || !listed.has(t.symbol) || (t.side !== 'buy' && t.side !== 'sell')) return null;
  if (!NETWORK_IDS.has(t.network) || !text(t.hash, 120) || !text(t.address, 120)) return null;
  if (t.dex != null && !text(t.dex, 80)) return null;
  const usd = Number(t.usd);
  const amount = Number(t.amount);
  const at = Number(t.at);
  if (!Number.isFinite(usd) || !(usd >= FLOOR_USD) || !Number.isFinite(amount) || !(amount > 0)) return null;
  const nowS = Math.floor(now / 1000);
  if (!Number.isInteger(at) || at > nowS + 300 || at < nowS - RETAIN_MS / 1000) return null;
  return {
    id: `${t.network}:${t.hash}:${t.side}:${t.symbol}`,
    at,
    symbol: t.symbol,
    side: t.side,
    amount,
    usd,
    address: t.address,
    network: t.network,
    dex: t.dex ?? null,
    hash: t.hash,
  };
}

/**
 * Store what the runner found: pools it discovered, coins it searched and found
 * no pool for, and trades. Everything is checked against the top fifty first.
 */
export async function storeSpot({ found = [], none = [], trades = [], listed, now = Date.now() }) {
  await ensureTables();
  const stamp = Math.floor(now / 1000);

  let pools = 0;
  for (const raw of found) {
    const p = cleanPool(raw, listed);
    if (!p) continue;
    const key = [p.network, p.pool, p.token];
    const same = await query('SELECT pool FROM spot_pools WHERE network = $1 AND pool = $2 AND token = $3', key);
    if (same.rows.length) {
      await query('UPDATE spot_pools SET checked = $4, symbol = $5, dex = $6 WHERE network = $1 AND pool = $2 AND token = $3',
        [...key, stamp, p.symbol, p.dex]);
    } else {
      await query('INSERT INTO spot_pools (symbol, network, token, pool, dex, checked) VALUES ($1, $2, $3, $4, $5, $6)',
        [p.symbol, p.network, p.token, p.pool, p.dex, stamp]);
    }
    pools += 1;
  }

  // A coin with no pool worth reading is remembered as such (pool '-'), so it
  // is not searched for again until it goes stale.
  for (const symbol of new Set(none)) {
    if (!listed.has(symbol)) continue;
    const held = await query('SELECT pool FROM spot_pools WHERE symbol = $1', [symbol]);
    if (!held.rows.length) {
      await query('INSERT INTO spot_pools (symbol, network, token, pool, dex, checked) VALUES ($1, $2, $3, $4, $5, $6)',
        [symbol, '-', symbol, '-', null, stamp]);
    } else {
      await query("UPDATE spot_pools SET checked = $2 WHERE symbol = $1 AND pool = '-'", [symbol, stamp]);
    }
  }

  const clean = trades.map((t) => cleanTrade(t, listed, now)).filter(Boolean);
  const written = await record(clean);
  await query('DELETE FROM spot_trades WHERE at < $1', [Math.floor((now - RETAIN_MS) / 1000)]);
  return { pools, trades: clean.length, written, skipped: trades.length - clean.length };
}

export async function record(trades) {
  if (!databaseAvailable() || !trades?.length) return 0;
  await ensureTables();
  let written = 0;
  for (const t of trades) {
    const held = await query('SELECT id FROM spot_trades WHERE id = $1', [t.id]);
    if (held.rows.length) continue;
    await query(
      `INSERT INTO spot_trades (id, at, symbol, side, amount, usd, address, network, dex, hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [t.id, t.at, t.symbol, t.side, String(t.amount), String(t.usd), t.address, t.network, t.dex ?? null, t.hash],
    );
    written += 1;
  }
  return written;
}

/** Stored trades since a moment, newest first. */
export async function readSpot({ since = 0 } = {}) {
  if (!databaseAvailable()) return [];
  await ensureTables();
  const { rows } = await query('SELECT * FROM spot_trades WHERE at >= $1 ORDER BY at DESC', [since]);
  return rows.map((r) => ({
    id: r.id,
    at: Number(r.at),
    symbol: r.symbol,
    side: r.side,
    amount: Number(r.amount),
    usd: Number(r.usd),
    address: r.address,
    network: r.network,
    dex: r.dex,
    hash: r.hash,
    source: 'dex',
  }));
}

/**
 * Take out the bots.
 *
 * Arbitrage and MEV bots trade seven-figure sizes in and out within minutes and
 * would fill the list with "whales" that hold nothing. A wallet that both
 * bought and sold the same coin within ten minutes is dropped, both legs.
 */
export function withoutBots(rows, windowS = 600) {
  const byKey = new Map();
  for (const r of rows) {
    const key = `${String(r.address).toLowerCase()}|${r.symbol}`;
    (byKey.get(key) ?? byKey.set(key, []).get(key)).push(r);
  }
  const bots = new Set();
  for (const list of byKey.values()) {
    for (const a of list) {
      if (list.some((b) => b.side !== a.side && Math.abs(b.at - a.at) <= windowS)) bots.add(a.id);
    }
  }
  return rows.filter((r) => !bots.has(r.id));
}
