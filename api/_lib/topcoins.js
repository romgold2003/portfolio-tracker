/**
 * The top fifty by market cap, from CoinGecko, joined to what can be watched.
 *
 * Fetched rather than listed, because the ranking is the one part of this that
 * is guaranteed to be wrong within a month. A hardcoded fifty would still have
 * LUNA in it.
 *
 * Server-side rather than from the browser, for two reasons that both matter:
 * CoinGecko's free tier is rate limited per IP, and one deployment sharing a
 * cached answer costs a fraction of what every open tab asking for itself does;
 * and the join against Whale Alert's coverage has to happen somewhere, so it
 * happens once here instead of in each browser.
 *
 * The distinction the caller must not blur: CoinGecko decides which fifty
 * assets are offered, and the on-chain provider decides which of those fifty
 * can actually be monitored. They are different questions with different
 * answers — twenty-odd of the top fifty are on chains nobody indexes for whale
 * flow — and the picker says which is which rather than quietly dropping them.
 */
import { fetchCoverage } from './whalealert.js';

const MARKETS_URL = 'https://api.coingecko.com/api/v3/coins/markets';

const TTL_MS = 10 * 60 * 1000;
let cache = { at: 0, value: null };

export function resetTopCoinsCache() {
  cache = { at: 0, value: null };
}

/**
 * Symbols that are the chain's own coin rather than a token on it.
 *
 * Only used to label a row "native" versus "token", which is worth showing
 * because it changes what a large transfer means: moving the gas asset is a
 * treasury decision, moving a stablecoin is usually a trade being funded.
 * Derived from the provider's coverage, not asserted — a symbol is native when
 * a chain it appears on is named after it.
 */
const CHAIN_ALIASES = {
  BTC: ['bitcoin'],
  ETH: ['ethereum'],
  SOL: ['solana'],
  XRP: ['ripple'],
  ADA: ['cardano'],
  DOGE: ['dogecoin'],
  LTC: ['litecoin'],
  BCH: ['bitcoin_cash'],
  TRX: ['tron'],
  ALGO: ['algorand'],
  MATIC: ['polygon'],
  POL: ['polygon'],
  HYPE: ['hyperliquid'],
};

function nativeOn(symbol, chains) {
  const names = CHAIN_ALIASES[symbol] ?? [];
  return chains.filter((c) => names.includes(c));
}

/**
 * @returns {Promise<{coins: object[], chains: string[], watchable: number}>}
 */
export async function topCoins({ limit = 50, fetcher = fetch, now = Date.now() } = {}) {
  if (cache.value && now - cache.at < TTL_MS) return cache.value;

  const url = new URL(MARKETS_URL);
  url.searchParams.set('vs_currency', 'usd');
  url.searchParams.set('order', 'market_cap_desc');
  url.searchParams.set('per_page', String(limit));
  url.searchParams.set('page', '1');
  url.searchParams.set('sparkline', 'false');

  const res = await fetcher(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'riskbook' },
  });
  if (!res.ok) throw new Error(`CoinGecko answered ${res.status}`);
  const rows = await res.json();
  if (!Array.isArray(rows)) throw new Error('CoinGecko sent something else');

  /**
   * Coverage is allowed to fail on its own.
   *
   * When it does, every coin is reported as coverage-unknown rather than as
   * unsupported. Saying "we cannot watch this" because a second service was
   * briefly down would be a confident claim built on a missing answer.
   */
  let bySymbol = null;
  let chains = [];
  try {
    const coverage = await fetchCoverage({ fetcher, now });
    bySymbol = coverage.bySymbol;
    chains = coverage.chains;
  } catch { /* reported as unknown below */ }

  const coins = rows.map((c, i) => {
    const symbol = String(c?.symbol ?? '').trim().toUpperCase();
    const on = bySymbol ? (bySymbol.get(symbol) ?? []) : [];
    const native = nativeOn(symbol, on);
    return {
      id: String(c?.id ?? ''),
      symbol,
      name: String(c?.name ?? ''),
      logo: String(c?.image ?? ''),
      rank: Number(c?.market_cap_rank) || i + 1,
      marketCap: Number(c?.market_cap) || null,
      price: Number(c?.current_price) || null,
      chains: on,
      native,
      // Three states, not two. "unknown" is what an unreachable coverage list
      // gets, and it must not be confused with a definite no.
      support: bySymbol === null ? 'unknown'
        : on.length === 0 ? 'none'
          : on.length > 1 ? 'multi' : 'single',
    };
  }).filter((c) => c.symbol);

  const value = {
    coins,
    chains,
    watchable: coins.filter((c) => c.chains.length > 0).length,
  };
  cache = { at: now, value };
  return value;
}
