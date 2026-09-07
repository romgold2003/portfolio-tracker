/**
 * Which addresses belong to an exchange.
 *
 * This is the label set the whole tracker was missing. Without it the panel
 * could see that money moved and never that it moved *onto an exchange*, which
 * is the difference between a fact and a signal: coins leaving an exchange are
 * somebody taking them off the market, and coins arriving are somebody getting
 * ready to sell. Every serious framework puts exchange netflow at or near the
 * top, and we could not compute it.
 *
 * I said this needed a paid provider. That was wrong. Etherscan's public labels
 * are mirrored as a plain JSON file on GitHub — thirty thousand addresses, no
 * key, no rate limit — and the wallets that matter are in it: Binance 14,
 * Coinbase 1 and Kraken's main address all resolve.
 *
 * **Ethereum only, and that is a real limit.** The mirror covers one chain, so
 * a Tron or Bitcoin address is unlabelled and stays unlabelled rather than
 * being guessed at. Most of what this app reads is Ethereum, which is why it is
 * worth having anyway, but a Tron flow will read as unattributed and should.
 */

const SOURCE = 'https://raw.githubusercontent.com/brianleect/etherscan-labels'
  + '/main/data/etherscan/combined/combinedAllLabels.json';

/**
 * The venues worth naming.
 *
 * Chosen by where large flow actually goes rather than by how many addresses
 * the label set happens to hold for each. Eleven rather than five because they
 * cost nothing — the file is fetched whole either way — and because a whale
 * depositing to Bitfinex is exactly as much a signal as one depositing to
 * Binance, while leaving it unlabelled would quietly read as a private wallet.
 */
export const VENUES = {
  binance: 'Binance',
  coinbase: 'Coinbase',
  kraken: 'Kraken',
  okx: 'OKX',
  bybit: 'Bybit',
  bitfinex: 'Bitfinex',
  huobi: 'Huobi',
  kucoin: 'KuCoin',
  'crypto-com': 'Crypto.com',
  gemini: 'Gemini',
  bitstamp: 'Bitstamp',
  gate: 'Gate.io',
  mexc: 'MEXC',
  bitget: 'Bitget',
  upbit: 'Upbit',
};

/** A day. The set changes when an exchange rotates a wallet, which is rare. */
const TTL_MS = 24 * 60 * 60 * 1000;
let cache = { at: 0, byAddress: null };

export function resetExchangeCache() {
  cache = { at: 0, byAddress: null };
}

/**
 * Load the label set, keyed by lower-case address.
 *
 * Only the exchange rows are kept. The file holds thirty thousand addresses and
 * most of them are Sushiswap pools and airdrop hunters; carrying those in
 * memory on every serverless instance would be paying for noise.
 */
export async function loadExchanges({ now = Date.now(), fetcher = fetch, signal } = {}) {
  if (cache.byAddress && now - cache.at < TTL_MS) return cache.byAddress;

  const res = await fetcher(SOURCE, {
    signal,
    headers: { Accept: 'application/json', 'User-Agent': 'riskbook' },
  });
  if (!res.ok) throw new Error(`Label set answered ${res.status}`);
  const raw = await res.json();

  const byAddress = new Map();
  for (const [address, entry] of Object.entries(raw ?? {})) {
    const venue = (entry?.labels ?? []).find((l) => VENUES[l]);
    if (!venue) continue;
    byAddress.set(address.toLowerCase(), {
      venue: VENUES[venue],
      // "Binance 14" rather than just "Binance": which wallet it was can matter,
      // and the label set already knows.
      name: entry?.name || VENUES[venue],
    });
  }

  cache = { at: now, byAddress };
  return byAddress;
}

/** The exchange an address belongs to, or null. Case-insensitive. */
export function exchangeOf(address, byAddress) {
  if (!address || !byAddress) return null;
  return byAddress.get(String(address).toLowerCase()) ?? null;
}

/* ── netflow ───────────────────────────────────────────────────────────── */

/**
 * What went onto exchanges and what came off, per asset, over a window.
 *
 * The sign convention is the one everybody uses and it is worth being explicit
 * about because it inverts the obvious reading: **netflow is inflow minus
 * outflow**, so a *positive* number means coins moved onto exchanges, which is
 * bearish, and a *negative* number means they left, which is bullish. Reading
 * it the other way round would turn the most actionable metric in the tracker
 * into an exactly wrong one.
 *
 * A transfer between two exchange addresses is ignored. Exchanges move their
 * own float between hot and cold wallets constantly and it is not flow into or
 * out of the market — counting it would make the busiest housekeeping look like
 * the strongest signal.
 */
export function netflow(rows, { byAddress, hours = 24 * 7, now = Date.now(), symbol = null } = {}) {
  const cutoff = Number.isFinite(hours) ? Math.floor(now / 1000) - hours * 3600 : -Infinity;
  const bySymbol = new Map();

  for (const r of rows ?? []) {
    if (Number(r.at) < cutoff) continue;
    if (r.kind !== 'transfer') continue;
    if (symbol && r.symbol !== symbol) continue;

    const usd = Number(r.usd);
    if (!(usd > 0)) continue;

    const to = exchangeOf(r.to?.address ?? r.to_addr, byAddress);
    const from = exchangeOf(r.from?.address ?? r.from_addr, byAddress);

    // Exchange to exchange is housekeeping, not flow.
    if (to && from) continue;
    if (!to && !from) continue;

    let e = bySymbol.get(r.symbol);
    if (!e) {
      e = { symbol: r.symbol, inUsd: 0, outUsd: 0, transfers: 0, venues: new Map() };
      bySymbol.set(r.symbol, e);
    }

    const venue = (to ?? from).venue;
    e.venues.set(venue, (e.venues.get(venue) ?? 0) + (to ? usd : -usd));
    if (to) e.inUsd += usd; else e.outUsd += usd;
    e.transfers += 1;
  }

  return [...bySymbol.values()].map((e) => {
    const netUsd = e.inUsd - e.outUsd;
    const grossUsd = e.inUsd + e.outUsd;
    return {
      symbol: e.symbol,
      inUsd: e.inUsd,
      outUsd: e.outUsd,
      netUsd,
      grossUsd,
      /** Net as a share of everything that moved: −100% is a pure exodus. */
      netPct: grossUsd > 0 ? Math.round((netUsd / grossUsd) * 1000) / 10 : 0,
      transfers: e.transfers,
      venues: [...e.venues.entries()]
        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
        .map(([venue, usd]) => ({ venue, netUsd: usd })),
      /**
       * The reading, stated rather than left to the sign. Coins leaving an
       * exchange are being taken off the market; coins arriving are being made
       * available to sell.
       */
      reading: netUsd < 0 ? 'accumulation' : netUsd > 0 ? 'distribution' : 'flat',
    };
  }).sort((a, b) => b.grossUsd - a.grossUsd);
}
