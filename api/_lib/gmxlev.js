/**
 * Whale leveraged trades on GMX, Arbitrum and Avalanche.
 *
 * GMX runs on-chain, and every executed order says outright what it did: the
 * wallet, long or short, whether it increased the position or decreased it,
 * and the size in dollars. So a row here can say "opened a $2M BTC short" or
 * "closed a $5M ETH long" as fact rather than guess.
 *
 * Read from GMX's public indexer (a GraphQL endpoint, no key) by the scheduled
 * collector every ten minutes, from the newest trade already held, and kept a
 * week. Hyperliquid, the other leveraged source, is read live in the browser.
 */
import { query, databaseAvailable } from './db.js';

const CHAINS = [
  {
    id: 'arbitrum',
    graphql: 'https://gmx.squids.live/gmx-synthetics-arbitrum:prod/api/graphql',
    api: 'https://arbitrum-api.gmxinfra.io',
  },
  {
    id: 'avalanche',
    graphql: 'https://gmx.squids.live/gmx-synthetics-avalanche:prod/api/graphql',
    api: 'https://avalanche-api.gmxinfra.io',
  },
];

export const FLOOR_USD = 500_000;
export const RETAIN_MS = 7 * 24 * 60 * 60 * 1000;

/** GMX order types. Swaps (0, 1) are not positions and are never read. */
const INCREASE = new Set([2, 3, 8]);
const DECREASE = new Set([4, 5, 6]);
const LIQUIDATION = 7;

/** GMX dollar amounts carry thirty decimals. */
const usdOf = (raw) => Number(BigInt(raw ?? 0) / 10n ** 24n) / 1e6;

/** Token amounts carry the token's own decimals. */
function tokensOf(raw, decimals) {
  const n = BigInt(raw ?? 0);
  const scale = 10n ** BigInt(Math.max(0, decimals - 6));
  return Number(n / scale) / 10 ** Math.min(6, decimals);
}

/** WETH is ETH, WBTC.b is BTC: the coin behind the wrapper. */
export function coinSymbol(symbol) {
  const s = String(symbol ?? '').toUpperCase().replace(/\.[A-Z]+$/, '').replace(/_DEPRECATED$/, '');
  return { WETH: 'ETH', WBTC: 'BTC', WAVAX: 'AVAX', WSOL: 'SOL' }[s] ?? s;
}

/**
 * What one executed order was, in words a trader uses.
 *
 * An increase opens or adds to a position; a decrease closes all or part of
 * one; a liquidation is a close the trader did not choose. Whether a decrease
 * closed the whole position is read from what was left after it.
 */
export function actionOf({ orderType, isLong, positionSizeInUsd, sizeDeltaUsd }) {
  const side = isLong ? 'long' : 'short';
  if (orderType === LIQUIDATION) return { verb: 'liquidated', side };
  if (INCREASE.has(orderType)) {
    const before = usdOf(positionSizeInUsd) - usdOf(sizeDeltaUsd);
    return { verb: before > 1 ? 'add' : 'open', side };
  }
  if (DECREASE.has(orderType)) {
    return { verb: usdOf(positionSizeInUsd) > 1 ? 'reduce' : 'close', side };
  }
  return null;
}

/* ── storage ─────────────────────────────────────────────────────────── */

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS lev_trades (
     id       TEXT PRIMARY KEY,
     at       INTEGER NOT NULL,
     venue    TEXT NOT NULL,
     symbol   TEXT NOT NULL,
     verb     TEXT NOT NULL,
     side     TEXT NOT NULL,
     amount   TEXT,
     usd      TEXT NOT NULL,
     pnl      TEXT,
     address  TEXT NOT NULL,
     network  TEXT NOT NULL,
     hash     TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS lev_trades_at ON lev_trades (at)`,
];

let ready = false;
export function resetTableCache() { ready = false; }

async function ensureTables() {
  if (ready) return;
  for (const statement of SCHEMA) await query(statement, []);
  ready = true;
}

/* ── reading GMX ─────────────────────────────────────────────────────── */

/** Market address → index token symbol and decimals, per chain, kept for a day. */
const marketCache = new Map();

async function marketsOf(chain, fetcher) {
  const held = marketCache.get(chain.id);
  if (held && Date.now() - held.at < 24 * 60 * 60 * 1000) return held.map;
  const [markets, tokens] = await Promise.all([
    fetcher(`${chain.api}/markets`).then((r) => r.json()),
    fetcher(`${chain.api}/tokens`).then((r) => r.json()),
  ]);
  const byAddress = new Map((tokens?.tokens ?? []).map((t) => [String(t.address).toLowerCase(), t]));
  const map = new Map();
  for (const m of markets?.markets ?? []) {
    const index = byAddress.get(String(m.indexToken).toLowerCase());
    if (!index) continue; // swap-only markets have no index token
    map.set(String(m.marketToken).toLowerCase(), { symbol: coinSymbol(index.symbol), decimals: Number(index.decimals) || 18 });
  }
  marketCache.set(chain.id, { at: Date.now(), map });
  return map;
}

/** Turn GMX's trade actions into rows, keeping positions of $500k and more. */
export function rowsOf(actions, markets, network) {
  const out = [];
  for (const a of actions ?? []) {
    const orderType = Number(a.orderType);
    const action = actionOf({ ...a, orderType });
    const market = markets.get(String(a.marketAddress).toLowerCase());
    if (!action || !market) continue;
    const usd = usdOf(a.sizeDeltaUsd);
    if (!(usd >= FLOOR_USD)) continue;
    out.push({
      id: `gmx:${a.transactionHash}:${a.account}:${a.marketAddress}:${orderType}`,
      at: Number(a.timestamp),
      venue: 'GMX',
      symbol: market.symbol,
      verb: action.verb,
      side: action.side,
      amount: tokensOf(a.sizeDeltaInTokens, market.decimals),
      usd,
      // Profit or loss is only realised when a position shrinks.
      pnl: a.pnlUsd != null && (action.verb === 'close' || action.verb === 'reduce' || action.verb === 'liquidated') ? usdOf(a.pnlUsd) : null,
      address: String(a.account),
      network,
      hash: String(a.transactionHash),
    });
  }
  return out;
}

const QUERY = `query($since: Int!, $floor: BigInt!) {
  tradeActions(limit: 500, orderBy: timestamp_DESC, where: {
    eventName_eq: "OrderExecuted", timestamp_gt: $since, sizeDeltaUsd_gte: $floor
  }) {
    account marketAddress isLong orderType sizeDeltaUsd sizeDeltaInTokens positionSizeInUsd pnlUsd timestamp transactionHash
  }
}`;

/** The collector's share: every GMX order of $500k and more since the last one held. */
export async function collectGmx({ now = Date.now(), fetcher = fetch } = {}) {
  if (!databaseAvailable()) return { written: 0 };
  await ensureTables();
  const newest = (await query("SELECT MAX(at) AS at FROM lev_trades WHERE venue = 'GMX'", [])).rows[0]?.at;
  const since = Math.max(Number(newest) || 0, Math.floor((now - RETAIN_MS) / 1000)) - 600;
  const floor = (BigInt(FLOOR_USD) * 10n ** 30n).toString();

  let written = 0;
  const failed = [];
  for (const chain of CHAINS) {
    try {
      const markets = await marketsOf(chain, fetcher);
      const res = await fetcher(chain.graphql, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: QUERY, variables: { since, floor } }),
      });
      const json = await res.json();
      if (json?.errors?.length) throw new Error(json.errors[0].message);
      written += await record(rowsOf(json?.data?.tradeActions, markets, chain.id));
    } catch (err) {
      failed.push(`${chain.id}: ${err.message}`);
    }
  }
  await query('DELETE FROM lev_trades WHERE at < $1', [Math.floor((now - RETAIN_MS) / 1000)]);
  return { written, failed };
}

export async function record(rows) {
  if (!databaseAvailable() || !rows?.length) return 0;
  await ensureTables();
  let written = 0;
  for (const r of rows) {
    const held = await query('SELECT id FROM lev_trades WHERE id = $1', [r.id]);
    if (held.rows.length) continue;
    await query(
      `INSERT INTO lev_trades (id, at, venue, symbol, verb, side, amount, usd, pnl, address, network, hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [r.id, r.at, r.venue, r.symbol, r.verb, r.side, r.amount == null ? null : String(r.amount),
        String(r.usd), r.pnl == null ? null : String(r.pnl), r.address, r.network, r.hash],
    );
    written += 1;
  }
  return written;
}

export async function readLeveraged({ since = 0 } = {}) {
  if (!databaseAvailable()) return [];
  await ensureTables();
  const { rows } = await query('SELECT * FROM lev_trades WHERE at >= $1 ORDER BY at DESC', [since]);
  return rows.map((r) => ({
    id: r.id,
    at: Number(r.at),
    venue: r.venue,
    symbol: r.symbol,
    verb: r.verb,
    side: r.side,
    amount: r.amount == null ? null : Number(r.amount),
    usd: Number(r.usd),
    pnl: r.pnl == null ? null : Number(r.pnl),
    address: r.address,
    network: r.network,
    hash: r.hash,
    source: 'gmx',
  }));
}
