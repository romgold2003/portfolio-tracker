/**
 * Spot whale trades on decentralised exchanges, for the top-fifty coins.
 *
 * A trade on a DEX is on-chain from end to end: the wallet that signed it, the
 * coin that went in and the coin that came out are all in one transaction, so
 * "this wallet bought $2.1M of LINK" is a fact rather than an inference. That
 * is what the Spot panel is for, and the reason it reads DEX trades rather than
 * transfers — a transfer never says buy or sell.
 *
 * Source: GeckoTerminal's public API. No key, about thirty calls a minute. The
 * scheduled collector (every ten minutes) spends a small budget of calls each
 * time: refreshing which pools each coin trades in, a coin or two at a time,
 * and reading the large trades of a slice of those pools, in rotation. The
 * trades endpoint returns the last day, so a pool read once an hour misses
 * nothing.
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

async function get(path, fetcher) {
  const res = await fetcher(`${API}${path}`, { headers: { Accept: 'application/json' } });
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

/* ── the collector's share of each poll ──────────────────────────────── */

/**
 * Spend a few calls: refresh the pool list of the coin whose turn it is, then
 * read the large trades of the next slice of pools. The turn is taken from the
 * clock, so the rotation keeps moving across cold starts.
 */
export async function collectSpot({
  coins, platformsOf, now = Date.now(), fetcher = fetch, calls = 18, budgetMs = 20_000,
}) {
  if (!databaseAvailable() || !coins?.length) return { pools: 0, trades: 0, written: 0 };
  await ensureTables();
  const started = Date.now();
  const inTime = () => Date.now() - started < budgetMs;
  const slot = Math.floor(now / (10 * 60 * 1000));
  let used = 0;

  /**
   * Which coins' pools to look up this time.
   *
   * Coins never looked up come first, so a new coin in the top fifty — or the
   * very first run — is filled in straight away rather than one coin per poll.
   * After that, the coin whose turn it is by the clock, so every coin's pools
   * are refreshed within a few hours. A coin with no pool worth reading is
   * remembered as such (pool '-') and not searched for again until its turn.
   */
  const held = (await query('SELECT symbol, pool FROM spot_pools', [])).rows;
  const looked = new Set(held.map((r) => r.symbol));
  const due = [
    ...coins.filter((c) => !looked.has(c.symbol)),
    coins[slot % coins.length],
  ];
  const discoveryCalls = coins.some((c) => !looked.has(c.symbol)) ? Math.floor(calls * 0.7) : Math.floor(calls / 4);
  const stamp = Math.floor(now / 1000);

  for (const coin of due) {
    if (used >= discoveryCalls || !inTime()) break;
    let found = 0;
    for (const [network, token] of tokensFor(coin, platformsOf(coin))) {
      if (used >= discoveryCalls || !inTime()) break;
      used += 1;
      try {
        for (const p of await discoverPools(network, token, { fetcher })) {
          found += 1;
          const key = [network, p.pool, token];
          const same = await query('SELECT pool FROM spot_pools WHERE network = $1 AND pool = $2 AND token = $3', key);
          if (same.rows.length) {
            await query('UPDATE spot_pools SET checked = $4, symbol = $5, dex = $6 WHERE network = $1 AND pool = $2 AND token = $3',
              [...key, stamp, coin.symbol, p.dex]);
          } else {
            await query('INSERT INTO spot_pools (symbol, network, token, pool, dex, checked) VALUES ($1, $2, $3, $4, $5, $6)',
              [coin.symbol, network, token, p.pool, p.dex, stamp]);
          }
        }
      } catch { /* the next rotation tries again */ }
    }
    if (!found && !looked.has(coin.symbol)) {
      await query('INSERT INTO spot_pools (symbol, network, token, pool, dex, checked) VALUES ($1, $2, $3, $4, $5, $6)',
        [coin.symbol, '-', coin.symbol, '-', null, stamp]);
    }
  }

  // Only pools of coins still in the top fifty are read.
  const wanted = new Set(coins.map((c) => c.symbol));
  const { rows } = await query('SELECT * FROM spot_pools ORDER BY network, pool', []);
  const pools = rows.filter((r) => wanted.has(r.symbol) && r.pool !== '-');
  const left = Math.max(0, calls - used);
  let trades = 0;
  let written = 0;
  for (let i = 0; i < Math.min(left, pools.length) && inTime(); i++) {
    const p = pools[(slot * left + i) % pools.length];
    try {
      const json = await get(
        `/networks/${p.network}/pools/${encodeURIComponent(p.pool)}/trades?trade_volume_in_usd_greater_than=${FLOOR_USD}`,
        fetcher,
      );
      const found = tradesOf(json, { symbol: p.symbol, token: p.token, network: p.network, dex: p.dex });
      trades += found.length;
      written += await record(found);
    } catch { /* rate limited or down: next poll */ }
  }

  await query('DELETE FROM spot_trades WHERE at < $1', [Math.floor((now - RETAIN_MS) / 1000)]);
  return { pools: pools.length, trades, written };
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
