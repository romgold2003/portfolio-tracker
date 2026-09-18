/**
 * Whale buys and sells of the top-fifty coins, spot and leveraged.
 *
 * Spot rows come from this app's server: trades on decentralised exchanges,
 * which are purchases and sales outright, and exchange withdrawals and
 * deposits, which are how buying and selling on Binance or Coinbase shows up
 * on-chain. Leveraged rows come straight from Hyperliquid, live, where every
 * trade is public with both wallets on it.
 *
 * Everything here is plain data in, plain data out, so it is tested without a
 * browser; the view only draws what these return.
 */

export const BANDS = [
  { id: 'all', label: 'All $500k+', min: 500_000, max: Infinity },
  { id: 'b1', label: '$500k–1M', min: 500_000, max: 1_000_000 },
  { id: 'b2', label: '$1M–5M', min: 1_000_000, max: 5_000_000 },
  { id: 'b3', label: '$5M–25M', min: 5_000_000, max: 25_000_000 },
  { id: 'b4', label: '$25M+', min: 25_000_000, max: Infinity },
];

export const bandOf = (id) => BANDS.find((b) => b.id === id) ?? BANDS[0];

/** Buying sides and selling sides. A withdrawal is kept coins, a deposit coins made ready to sell. */
const BUYING = new Set(['buy', 'withdraw']);
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
export function filterRows(rows, { coin = '', band = 'all', side = 'both', since = 0 } = {}) {
  const { min, max } = bandOf(band);
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
  return new Map(BANDS.map((b) => [b.id, filterRows(rows, { ...filters, band: b.id }).length]));
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
      source: 'hyperliquid',
    };
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
