/**
 * The top fifty by market cap, joined to the chains that can actually be read.
 *
 * Fetched rather than listed, because the ranking is the one part of this that
 * is guaranteed to be wrong within a month. A hardcoded fifty would still have
 * LUNA in it — and on the day this was written the live list held FIGR_HELOC,
 * WLFI and RAIN, none of which existed as tickers a year ago.
 *
 * The coin-to-chain mapping is fetched too, and that matters more. CoinGecko
 * publishes each asset's contract address per network, so "USDT is on nine
 * networks" is read from the source rather than asserted here; the app only
 * has to say which of those networks it has a reader for. Native coins carry
 * no contract and are matched by the chain they are the gas asset of.
 *
 * Server-side for two reasons that both hold: CoinGecko rate limits per IP and
 * one cached answer shared by the deployment costs a fraction of every tab
 * asking for itself, and the join has to happen once somewhere.
 *
 * The distinction the caller must not blur: CoinGecko decides which fifty
 * assets are offered, and the readers decide which of those fifty can be
 * watched. Different questions, different answers, and the picker shows both.
 */
import { CHAINS, COVERAGE_NOTE } from './chainfeeds.js';
import { fetchCoverage, feedConfigured } from './whalealert.js';

const MARKETS_URL = 'https://api.coingecko.com/api/v3/coins/markets';
const LIST_URL = 'https://api.coingecko.com/api/v3/coins/list?include_platform=true';

const TTL_MS = 10 * 60 * 1000;
/** The platform map is nineteen thousand rows and changes by the week. */
const PLATFORM_TTL_MS = 6 * 60 * 60 * 1000;

let cache = { at: 0, value: null };
let platformCache = { at: 0, value: null };

export function resetTopCoinsCache() {
  cache = { at: 0, value: null };
  platformCache = { at: 0, value: null };
}

async function platformsById({ fetcher, now }) {
  if (platformCache.value && now - platformCache.at < PLATFORM_TTL_MS) return platformCache.value;
  const res = await fetcher(LIST_URL, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`CoinGecko answered ${res.status}`);
  const rows = await res.json();
  if (!Array.isArray(rows)) throw new Error('CoinGecko sent something else');
  const map = new Map();
  for (const c of rows) {
    if (c?.id) map.set(String(c.id), c.platforms && typeof c.platforms === 'object' ? c.platforms : {});
  }
  platformCache = { at: now, value: map };
  return map;
}

/**
 * Which readers can see this asset, and at what address.
 *
 * A chain qualifies two ways and they are not the same claim: the asset is the
 * chain's own coin, or the asset has a contract deployed on it and that chain's
 * reader follows tokens. XRPL and Bitcoin read only their native coin, so an
 * asset issued on them is correctly not claimed.
 */
function readersFor({ symbol, platforms }) {
  const out = [];
  for (const chain of CHAINS) {
    if (chain.native === symbol) {
      out.push({ chain: chain.id, label: chain.label, contract: null, native: true });
      continue;
    }
    if (!chain.tokens) continue;
    const contract = platforms?.[chain.platform];
    if (typeof contract === 'string' && contract) {
      out.push({ chain: chain.id, label: chain.label, contract, native: false });
    }
  }
  return out;
}

/**
 * @returns {Promise<{coins: object[], chains: object[], watchable: number}>}
 */
export async function topCoins({ limit = 50, fetcher = fetch, now = Date.now() } = {}) {
  if (cache.value && now - cache.at < TTL_MS) return cache.value;

  const url = new URL(MARKETS_URL);
  url.searchParams.set('vs_currency', 'usd');
  url.searchParams.set('order', 'market_cap_desc');
  url.searchParams.set('per_page', String(limit));
  url.searchParams.set('page', '1');
  url.searchParams.set('sparkline', 'false');

  const res = await fetcher(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`CoinGecko answered ${res.status}`);
  const rows = await res.json();
  if (!Array.isArray(rows)) throw new Error('CoinGecko sent something else');

  /**
   * Both maps are allowed to fail on their own.
   *
   * Without the platform map nothing but native coins can be matched, which is
   * a thinner answer and not a wrong one. Without Whale Alert — which is
   * optional anyway — the keyless readers still stand on their own.
   */
  let platforms = null;
  try { platforms = await platformsById({ fetcher, now }); } catch { /* native only */ }

  let waCoverage = null;
  if (feedConfigured()) {
    try { waCoverage = (await fetchCoverage({ fetcher, now })).bySymbol; } catch { /* optional */ }
  }

  const coins = rows.map((c, i) => {
    const symbol = String(c?.symbol ?? '').trim().toUpperCase();
    const id = String(c?.id ?? '');
    const readers = readersFor({ symbol, platforms: platforms?.get(id) });

    /**
     * Whale Alert, when a key is set, can see chains this app has no reader
     * for. Those are reported as watchable-through-the-provider rather than
     * merged into the reader list, so the panel never implies it is reading a
     * chain itself when it is not.
     */
    const viaProvider = (waCoverage?.get(symbol) ?? [])
      .filter((chain) => !readers.some((r) => r.chain === chain));

    return {
      id,
      symbol,
      name: String(c?.name ?? ''),
      logo: String(c?.image ?? ''),
      rank: Number(c?.market_cap_rank) || i + 1,
      marketCap: Number(c?.market_cap) || null,
      price: Number(c?.current_price) || null,
      readers,
      viaProvider,
      chains: [...readers.map((r) => r.chain), ...viaProvider],
      /**
       * Four states, not two. "partial" is the honest word for an asset whose
       * only reader samples rather than sweeps, and "unknown" is what a
       * missing platform map gets — which must never be reported as a
       * confident no.
       */
      support: (() => {
        const all = readers.length + viaProvider.length;
        if (!all) return platforms ? 'none' : 'unknown';
        if (all > 1) return 'multi';
        return readers.some((r) => COVERAGE_NOTE[r.chain]) ? 'partial' : 'single';
      })(),
    };
  }).filter((c) => c.symbol);

  const value = {
    coins,
    chains: CHAINS.map((c) => ({
      id: c.id, label: c.label, tokens: c.tokens, complete: c.complete,
      note: COVERAGE_NOTE[c.id] ?? null,
    })),
    watchable: coins.filter((c) => c.chains.length > 0).length,
  };
  cache = { at: now, value };
  return value;
}

/**
 * Symbol to USD, for the chains whose feed does not carry a price.
 *
 * Two hundred and fifty deep rather than fifty, because a transfer is priced by
 * whatever token moved and that is regularly something outside the top fifty.
 * A symbol absent here is dropped by the adapters rather than valued at zero.
 */
const PRICE_TTL_MS = 5 * 60 * 1000;
let priceCache = { at: 0, value: null };

export function resetPriceCache() {
  priceCache = { at: 0, value: null };
}

export async function priceMap({ fetcher = fetch, now = Date.now() } = {}) {
  if (priceCache.value && now - priceCache.at < PRICE_TTL_MS) return priceCache.value;

  const url = new URL(MARKETS_URL);
  url.searchParams.set('vs_currency', 'usd');
  url.searchParams.set('order', 'market_cap_desc');
  url.searchParams.set('per_page', '250');
  url.searchParams.set('page', '1');
  url.searchParams.set('sparkline', 'false');

  const res = await fetcher(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`CoinGecko answered ${res.status}`);
  const rows = await res.json();
  if (!Array.isArray(rows)) throw new Error('CoinGecko sent something else');

  const map = new Map();
  for (const c of rows) {
    const symbol = String(c?.symbol ?? '').trim().toUpperCase();
    const price = Number(c?.current_price);
    // Highest market cap wins a duplicated ticker, which is the order the rows
    // already arrive in, so the first one seen is the right one.
    if (symbol && price > 0 && !map.has(symbol)) map.set(symbol, price);
  }
  priceCache = { at: now, value: map };
  return map;
}

/**
 * The contracts worth sweeping individually, per chain.
 *
 * Taken from the top fifty's own platform entries, so it follows the ranking
 * rather than a list typed here — and it is the reason the per-token sweep in
 * chainfeeds.js knows where to look without anybody hardcoding an address.
 */
/**
 * Value-dense assets that rank below the top fifty and matter anyway.
 *
 * Measured, not assumed. Fifty consecutive WBTC transfers covered three minutes
 * and held five above twenty million dollars; fifty USDT transfers covered
 * twelve seconds and held none. Wrapped Bitcoin does not rank in the top fifty
 * by market cap and is one of the richest sources of genuinely large transfers
 * on Ethereum, so sweeping only the top fifty missed it entirely — which is
 * exactly what the first live yield test showed, three polls returning nothing.
 *
 * These are CoinGecko ids, not addresses: the contracts still come from the
 * platform map, so nothing here is a hardcoded chain address.
 */
const DENSE_IDS = ['wrapped-bitcoin', 'weth', 'wrapped-steth', 'coinbase-wrapped-btc'];

export async function watchContracts(options = {}) {
  const { coins } = await topCoins(options);
  const byChain = {};
  const add = (chain, contract) => {
    if (!contract) return;
    const list = (byChain[chain] ??= []);
    if (!list.includes(contract)) list.push(contract);
  };

  for (const coin of coins) {
    for (const reader of coin.readers) add(reader.chain, reader.contract);
  }

  try {
    const platforms = await platformsById({
      fetcher: options.fetcher ?? fetch,
      now: options.now ?? Date.now(),
    });
    for (const id of DENSE_IDS) {
      const entry = platforms.get(id);
      if (!entry) continue;
      for (const chain of CHAINS) {
        if (!chain.tokens) continue;
        add(chain.id, entry[chain.platform]);
      }
    }
  } catch { /* the top fifty on their own are still worth sweeping */ }

  return byChain;
}
