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

/** A price carries thirty decimals less the token's own. */
const priceOf = (raw, decimals) => (raw == null ? null : Number(BigInt(raw) / 10n ** BigInt(Math.max(0, 30 - decimals - 6))) / 1e6);

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
     hash     TEXT NOT NULL,
     leverage TEXT,
     entry    TEXT,
     market   TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS lev_trades_at ON lev_trades (at)`,
];

/** Columns added after the table first shipped; a live database keeps its rows. */
const ADDED = ['leverage', 'entry', 'market'];

let ready = false;
export function resetTableCache() { ready = false; }

async function ensureTables() {
  if (ready) return;
  for (const statement of SCHEMA) await query(statement, []);
  for (const column of ADDED) {
    // Already there on a new table, and on an old one this is the migration.
    try { await query(`ALTER TABLE lev_trades ADD COLUMN ${column} TEXT`, []); } catch { /* present */ }
  }
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

/**
 * The leverage a trade itself implies: the size it moved over the collateral
 * that moved with it.
 *
 * The position's own leverage is better and is used when the position is still
 * open, but a position that has been closed or liquidated no longer has one —
 * and those are exactly the rows worth reading. Collateral is an amount in its
 * own token with a price beside it, both carrying thirty decimals between them.
 */
export function leverageOf(a) {
  const collateral = Number(BigInt(a?.initialCollateralDeltaAmount ?? 0) * BigInt(a?.collateralTokenPriceMin ?? 0) / 10n ** 30n);
  if (!(collateral > 0)) return null;
  const lev = usdOf(a.sizeDeltaUsd) / collateral;
  return lev > 0.05 && lev < 1000 ? lev : null;
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
      market: String(a.marketAddress),
      leverage: leverageOf(a),
    });
  }
  return out;
}

/**
 * The positions those wallets hold right now: how much leverage they took and
 * where they got in. A row can then read "opened a 12× long at $81,420"
 * rather than only naming a size, and the panel can follow the position
 * afterwards.
 *
 * Snapshots are excluded: the indexer keeps a copy of a position per change,
 * and only the live row describes the position as it stands.
 */
const POSITIONS_QUERY = `query($accounts: [String!]!) {
  positions(limit: 500, where: { account_in: $accounts, isSnapshot_eq: false }) {
    account market isLong leverage entryPrice sizeInUsd unrealizedPnl
  }
}`;

/** GMX prices carry thirty decimals less the token's own; leverage is per ten thousand. */
export function positionsOf(list) {
  const out = new Map();
  for (const p of list ?? []) {
    const lev = Number(p?.leverage) / 10_000;
    out.set(`${String(p.account).toLowerCase()}|${String(p.market).toLowerCase()}|${p.isLong ? 'long' : 'short'}`, {
      leverage: lev > 0.05 && lev < 1000 ? lev : null,
      entry: p.entryPrice ?? null,
      sizeUsd: usdOf(p.sizeInUsd),
      pnl: usdOf(p.unrealizedPnl),
    });
  }
  return out;
}

const QUERY = `query($since: Int!, $floor: BigInt!) {
  tradeActions(limit: 500, orderBy: timestamp_DESC, where: {
    eventName_eq: "OrderExecuted", timestamp_gt: $since, sizeDeltaUsd_gte: $floor
  }) {
    account marketAddress isLong orderType sizeDeltaUsd sizeDeltaInTokens positionSizeInUsd pnlUsd timestamp transactionHash
    initialCollateralDeltaAmount collateralTokenPriceMin
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
      const rows = rowsOf(json?.data?.tradeActions, markets, chain.id);

      // The leverage and entry of the positions those trades belong to.
      const accounts = [...new Set(rows.map((r) => r.address))];
      if (accounts.length) {
        try {
          const held = await fetcher(chain.graphql, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: POSITIONS_QUERY, variables: { accounts } }),
          }).then((r) => r.json());
          const positions = positionsOf(held?.data?.positions);
          for (const r of rows) {
            const p = positions.get(`${r.address.toLowerCase()}|${String(r.market).toLowerCase()}|${r.side}`);
            if (!p) continue;
            // The open position's own leverage, where there still is one.
            if (p.leverage) r.leverage = p.leverage;
            // Prices are scaled by the token's decimals; stored as plain dollars.
            r.entry = p.entry == null ? null : priceOf(p.entry, markets.get(String(r.market).toLowerCase())?.decimals ?? 18);
          }
        } catch { /* sizes and sides still stand without it */ }
      }
      written += await record(rows);
    } catch (err) {
      failed.push(`${chain.id}: ${err.message}`);
    }
  }
  const filled = await backfill({ now, fetcher });
  await query('DELETE FROM lev_trades WHERE at < $1', [Math.floor((now - RETAIN_MS) / 1000)]);
  return { written, filled, failed };
}

/**
 * Rows kept before the leverage was recorded, filled in from the same trades.
 *
 * Only while any are left: once the week has turned over, every row held was
 * written with its leverage and this costs nothing.
 */
async function backfill({ now, fetcher }) {
  const missing = (await query('SELECT id FROM lev_trades WHERE leverage IS NULL AND at >= $1', [Math.floor((now - RETAIN_MS) / 1000)])).rows;
  if (!missing.length) return 0;
  const wanted = new Set(missing.map((r) => r.id));
  const since = Math.floor((now - RETAIN_MS) / 1000);
  const floor = (BigInt(FLOOR_USD) * 10n ** 30n).toString();
  let filled = 0;
  for (const chain of CHAINS) {
    try {
      const markets = await marketsOf(chain, fetcher);
      const json = await fetcher(chain.graphql, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: QUERY, variables: { since, floor } }),
      }).then((r) => r.json());
      for (const r of rowsOf(json?.data?.tradeActions, markets, chain.id)) {
        if (!wanted.has(r.id) || r.leverage == null) continue;
        await query('UPDATE lev_trades SET leverage = $2, market = $3 WHERE id = $1', [r.id, String(r.leverage), r.market]);
        filled += 1;
      }
    } catch { /* the next poll tries again */ }
  }
  return filled;
}

export async function record(rows) {
  if (!databaseAvailable() || !rows?.length) return 0;
  await ensureTables();
  let written = 0;
  for (const r of rows) {
    const held = await query('SELECT id FROM lev_trades WHERE id = $1', [r.id]);
    if (held.rows.length) continue;
    await query(
      `INSERT INTO lev_trades (id, at, venue, symbol, verb, side, amount, usd, pnl, address, network, hash, leverage, entry, market)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [r.id, r.at, r.venue, r.symbol, r.verb, r.side, r.amount == null ? null : String(r.amount),
        String(r.usd), r.pnl == null ? null : String(r.pnl), r.address, r.network, r.hash,
        r.leverage == null ? null : String(r.leverage), r.entry == null ? null : String(r.entry),
        r.market == null ? null : String(r.market)],
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
    leverage: r.leverage == null ? null : Number(r.leverage),
    /** The index price the position was opened at, in GMX's own scale. */
    entry: r.entry ?? null,
    market: r.market ?? null,
    source: 'gmx',
  }));
}
