/**
 * Whale buys and sells of the top-fifty coins, spot and leveraged.
 *
 * Spot rows come from this app's server: trades on decentralised exchanges,
 * which are purchases and sales outright. Leveraged rows come from GMX, via the
 * server, and from Hyperliquid, live, where every trade is public with both
 * wallets on it and each wallet's fill says whether it opened or closed.
 *
 * Everything here is plain data in, plain data out, so it is tested without a
 * browser; the view only draws what these return.
 */

/**
 * The sizes shown. Nothing under $5M appears.
 *
 * The collectors still keep everything from $500k, so the bands can be moved
 * down again without losing history.
 */
export const BANDS = [
  { id: 'all', label: 'All $5M+', min: 5_000_000, max: Infinity },
  { id: 'b1', label: '$5M–10M', min: 5_000_000, max: 10_000_000 },
  { id: 'b2', label: '$10M–25M', min: 10_000_000, max: 25_000_000 },
  { id: 'b3', label: '$25M+', min: 25_000_000, max: Infinity },
];

/**
 * Spot has its own, lower sizes.
 *
 * Single on-chain spot trades are far smaller than leveraged orders: across the
 * eighteen largest pools of ETH, BTC, SOL and BNB, a day held seventeen trades
 * over $500k and none over $1M, while GMX alone sees one or two orders over $5M
 * a week. The same $5M floor would leave Spot empty; $1M gives it about as many
 * rows as Leveraged.
 */
export const SPOT_BANDS = [
  { id: 'all', label: 'All $1M+', min: 1_000_000, max: Infinity },
  { id: 'b1', label: '$1M–2M', min: 1_000_000, max: 2_000_000 },
  { id: 'b2', label: '$2M–5M', min: 2_000_000, max: 5_000_000 },
  { id: 'b3', label: '$5M+', min: 5_000_000, max: Infinity },
];

export const bandOf = (id, bands = BANDS) => bands.find((b) => b.id === id) ?? bands[0];

/** Buying sides and selling sides. */
const BUYING = new Set(['buy']);
export const isBuying = (row) => BUYING.has(row.side);

/**
 * The rows a set of filters leaves, newest first.
 *
 * @param {object} o
 * @param {string} o.coin   a symbol, or '' for every coin
 * @param {string} o.band   a band id
 * @param {string} o.side   'both', 'buy' or 'sell'
 * @param {number} o.since  unix seconds; older rows are left out
 */
export function filterRows(rows, { coin = '', band = 'all', side = 'both', since = 0, bands = SPOT_BANDS } = {}) {
  const { min, max } = bandOf(band, bands);
  return (rows ?? [])
    .filter((r) => r.at >= since && r.usd >= min && r.usd < max)
    .filter((r) => !coin || r.symbol === coin)
    .filter((r) => side === 'both' || (side === 'buy') === isBuying(r))
    .sort((a, b) => b.at - a.at);
}

/** Buys against sells, in dollars and counts. */
export function summarise(rows) {
  const out = { buyUsd: 0, sellUsd: 0, buys: 0, sells: 0 };
  for (const r of rows ?? []) {
    if (isBuying(r)) { out.buyUsd += r.usd; out.buys += 1; } else { out.sellUsd += r.usd; out.sells += 1; }
  }
  out.net = out.buyUsd - out.sellUsd;
  return out;
}

/** How many rows each band holds, for the counts on its button. */
export function countByBand(rows, filters) {
  const bands = filters?.bands ?? SPOT_BANDS;
  return new Map(bands.map((b) => [b.id, filterRows(rows, { ...filters, bands, band: b.id }).length]));
}

/* ── Hyperliquid ─────────────────────────────────────────────────────── */

/**
 * The Hyperliquid market for each coin, and the size multiplier.
 *
 * Most coins trade under their own ticker. Very cheap ones trade per thousand
 * — kPEPE, kSHIB, kBONK — so a size of 1 there is 1,000 coins.
 */
export function hyperliquidMarkets(symbols, universe) {
  const names = new Set((universe ?? []).filter((u) => !u?.isDelisted).map((u) => u?.name));
  const out = new Map();
  for (const symbol of symbols) {
    if (names.has(symbol)) out.set(symbol, { market: symbol, scale: 1 });
    else if (names.has(`k${symbol}`)) out.set(symbol, { market: `k${symbol}`, scale: 1000 });
  }
  return out;
}

/**
 * Hyperliquid fills, grouped into the orders that caused them.
 *
 * One $5M market order fills against dozens of resting orders at once and
 * arrives as dozens of trades. They share the taker's transaction hash, so the
 * fills are summed per hash into one order: the whale, the side they took, the
 * total size and value. The taker is the buyer on a buy-side fill and the
 * seller on a sell-side one.
 */
export function groupFills(fills, { scaleOf = () => 1, symbolOf = (m) => m } = {}) {
  const orders = new Map();
  for (const f of fills ?? []) {
    const px = Number(f?.px);
    const sz = Number(f?.sz);
    if (!(px > 0) || !(sz > 0) || !Array.isArray(f.users)) continue;
    const buying = f.side === 'B';
    const taker = buying ? f.users[0] : f.users[1];
    const zeroHash = !f.hash || /^0x0+$/.test(f.hash);
    const key = zeroHash ? `${f.coin}|${taker}|${f.time}` : `${f.coin}|${f.hash}`;
    const scale = scaleOf(f.coin);
    const order = orders.get(key) ?? {
      id: key,
      at: Math.floor(Number(f.time) / 1000),
      symbol: symbolOf(f.coin),
      side: buying ? 'buy' : 'sell',
      amount: 0,
      usd: 0,
      address: taker,
      hash: zeroHash ? null : f.hash,
      // Trade ids too: a fill with no transaction hash can only be found by its id.
      tids: [],
      source: 'hyperliquid',
    };
    if (f.tid != null) order.tids.push(f.tid);
    order.amount += sz * scale;
    order.usd += px * sz;
    orders.set(key, order);
  }
  return [...orders.values()];
}

/* ── wallets ─────────────────────────────────────────────────────────── */

const EXPLORERS = {
  eth: 'https://etherscan.io/address/',
  ethereum: 'https://etherscan.io/address/',
  base: 'https://basescan.org/address/',
  arbitrum: 'https://arbiscan.io/address/',
  bsc: 'https://bscscan.com/address/',
  polygon_pos: 'https://polygonscan.com/address/',
  optimism: 'https://optimistic.etherscan.io/address/',
  avax: 'https://snowtrace.io/address/',
  solana: 'https://solscan.io/account/',
  'sui-network': 'https://suiscan.xyz/mainnet/account/',
  bitcoin: 'https://mempool.space/address/',
  tron: 'https://tronscan.org/#/address/',
  ripple: 'https://xrpscan.com/account/',
  dogecoin: 'https://blockchair.com/dogecoin/address/',
  litecoin: 'https://blockchair.com/litecoin/address/',
  hyperliquid: 'https://hypurrscan.io/address/',
};

/** Where to look a wallet up, or null. */
export function walletLink(row) {
  if (!row?.address) return null;
  const network = row.source === 'hyperliquid' ? 'hyperliquid' : String(row.network ?? '').toLowerCase();
  const base = EXPLORERS[network];
  return base ? base + encodeURIComponent(row.address) : null;
}

export const shortAddress = (a) => (typeof a === 'string' && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a ?? '');

/* ── leveraged actions ───────────────────────────────────────────────── */

/**
 * What a Hyperliquid order did, from the wallet's own fill.
 *
 * The public trade only says who bought and who sold. The wallet's fill says
 * "Open Long", "Close Short", "Long > Short" and so on, and its starting
 * position tells a first entry from adding more, and a full exit from a part
 * one.
 */
export function hyperliquidAction(fill, size) {
  const dir = String(fill?.dir ?? '');
  const start = Math.abs(Number(fill?.startPosition) || 0);
  const side = /short/i.test(dir.split('>').pop()) ? 'short' : 'long';
  if (/>/.test(dir)) return { verb: 'flip', side };
  if (/liquidat/i.test(dir)) return { verb: 'liquidated', side: /short/i.test(dir) ? 'short' : 'long' };
  if (/^open/i.test(dir)) return { verb: start > 1e-9 ? 'add' : 'open', side };
  if (/^close/i.test(dir)) return { verb: size && start - size > 1e-9 * Math.max(1, start) ? 'reduce' : 'close', side };
  return null;
}

/** The label on the pill, and whether it is a bet on the price rising. */
export function leveragedLabel(row) {
  const side = row.side === 'short' ? 'SHORT' : 'LONG';
  const words = {
    open: `OPEN ${side}`, add: `ADD ${side}`, close: `CLOSE ${side}`, reduce: `REDUCE ${side}`,
    liquidated: `${side} LIQUIDATED`, flip: `FLIP → ${side}`,
  };
  // Opening a long or closing a short both need the price up; the reverse needs it down.
  // Open or close unknown: the trade still shows, as the side it bought or sold.
  if (row.verb === 'unknown') return { text: row.side === 'short' ? 'SELL' : 'BUY', bullish: row.side !== 'short', opening: true };
  const opening = row.verb === 'open' || row.verb === 'add' || row.verb === 'flip';
  const bullish = opening ? row.side === 'long' : row.side === 'short';
  return { text: words[row.verb] ?? side, bullish, opening };
}

/** Leveraged rows filtered by position side instead of buy/sell. */
export function filterLeveraged(rows, { coin = '', band = 'all', side = 'both', since = 0 } = {}) {
  const { min, max } = bandOf(band);
  return (rows ?? [])
    .filter((r) => r.at >= since && r.usd >= min && r.usd < max)
    .filter((r) => !coin || r.symbol === coin)
    .filter((r) => side === 'both' || r.side === side)
    .sort((a, b) => b.at - a.at);
}

/** Money opened long, opened short, and closed, for the summary line. */
export function summariseLeveraged(rows) {
  const out = { longUsd: 0, shortUsd: 0, closedUsd: 0, longs: 0, shorts: 0, closes: 0 };
  for (const r of rows ?? []) {
    const { opening } = leveragedLabel(r);
    if (!opening) { out.closedUsd += r.usd; out.closes += 1; } else if (r.side === 'long') { out.longUsd += r.usd; out.longs += 1; } else { out.shortUsd += r.usd; out.shorts += 1; }
  }
  return out;
}
