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
import { isDollar } from './stablecoins.js';

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
 * Which coins are dollars rather than bets, from CoinGecko's own category.
 *
 * Twelve of the top fifty were stablecoins — USDT, USDC, USDS, DAI, USDE,
 * USD1, USDG, PYUSD, BUIDL, USYC, RLUSD, USDY — which is a quarter of the
 * picker spent on things whose price is one dollar by construction. Watching
 * whales trade them is watching people move cash between accounts.
 *
 * The list is fetched rather than hardcoded because new ones keep arriving:
 * a hardcoded set caught the twelve above and then let USDGO (#61) and BFUSD
 * (#63) straight back in as their replacements.
 *
 * It is the union of two sources, because neither is complete on its own.
 * CoinGecko's category knows the new arrivals; it does not include the
 * tokenised treasury funds — BUIDL, USYC, USDY — which are dollar instruments
 * wearing a fund's name. The local list knows those.
 *
 * Gold is deliberately not in either. PAXG and XAUT track an ounce, not a
 * dollar, and holding them is a position rather than sitting in cash.
 */
const STABLE_CATEGORY = `${MARKETS_URL}?vs_currency=usd&category=stablecoins`
  + '&order=market_cap_desc&per_page=250&page=1&sparkline=false';

/** They change slowly; asking once every six hours is plenty. */
const STABLE_TTL_MS = 6 * 60 * 60 * 1000;
let stableCache = { at: 0, ids: null };

export function resetStableCache() { stableCache = { at: 0, ids: null }; }

async function stableIds({ fetcher = fetch, now = Date.now() } = {}) {
  if (stableCache.ids && now - stableCache.at < STABLE_TTL_MS) return stableCache.ids;
  try {
    const res = await fetcher(STABLE_CATEGORY, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(String(res.status));
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error('not a list');
    const ids = new Set(rows.map((c) => String(c?.id ?? '')).filter(Boolean));
    stableCache = { at: now, ids };
    return ids;
  } catch {
    /**
     * The local list still applies, so a failure here costs the newest
     * stablecoins their filtering and nothing else. Better a picker with one
     * unexpected dollar token in it than no picker at all.
     */
    return stableCache.ids ?? new Set();
  }
}

/**
 * Tokenised cash funds, which are neither in the category nor dollar-pegged.
 *
 * EURSAFO reached the picker at rank sixty-six: "Spiko Amundi Overnight Swap
 * Fund (EUR)", trading at 1.18 dollars because a euro costs 1.18 dollars.
 * CoinGecko does not file it under stablecoins — it is a fund share — and it
 * is not pegged to a dollar, so neither existing test caught it. It is still
 * somebody parking cash, which is the thing being filtered out.
 *
 * Deliberately narrow. It matches how these instruments are named and nothing
 * else: a fund whose whole purpose is to hold cash overnight says so on the
 * tin. Bitcoin ETFs and staking derivatives are positions and must not match.
 */
const CASH_FUND = /overnight|money market|liquidity fund|treasury fund|yield fund/i;

/** A coin that is cash rather than a position, from any of the three. */
const isStablecoin = (coin, ids) => ids.has(coin.id)
  || isDollar(coin.symbol)
  || CASH_FUND.test(coin.name ?? '');

/**
 * @returns {Promise<{coins: object[], chains: object[], watchable: number}>}
 */
export async function topCoins({ limit = 50, fetcher = fetch, now = Date.now() } = {}) {
  if (cache.value && now - cache.at < TTL_MS) return cache.value;

  const url = new URL(MARKETS_URL);
  url.searchParams.set('vs_currency', 'usd');
  url.searchParams.set('order', 'market_cap_desc');
  /**
   * Twice what is shown, because the stablecoins are dropped afterwards and
   * their places have to be filled from further down the ranking. Twelve of
   * the top fifty were dollars, so fifty fetched would have returned
   * thirty-eight.
   */
  url.searchParams.set('per_page', String(Math.min(250, limit * 2)));
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

  const stables = await stableIds({ fetcher, now });

  const built = rows.map((c, i) => {
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

  /**
   * Two lists, and the difference matters.
   *
   * `coins` is what a person is offered: the largest fifty that are actually
   * bets on something. `all` is everything fetched, stablecoins included, and
   * the jobs that need them still get them — the dominance reading is the sum
   * of their market caps, and the transfer sweep watches USDT and USDC because
   * they carry more large movements than anything else on the chains.
   *
   * Dropping them from the sweep as well as the picker would have quietly
   * emptied half the whale tape.
   */
  const coins = built.filter((c) => !isStablecoin(c, stables)).slice(0, limit);

  const value = {
    coins,
    all: built,
    /** What was dropped, so the picker can say so rather than just being short. */
    excludedStables: built.filter((c) => isStablecoin(c, stables))
      .slice(0, limit)
      .map((c) => c.symbol),
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
  // Everything, not the shown fifty: USDT and USDC carry more large transfers
  // than anything else on these chains, and they are not in the picker.
  const { all, coins } = await topCoins(options);
  const sweepable = all ?? coins;
  const byChain = {};
  const add = (chain, contract) => {
    if (!contract) return;
    const list = (byChain[chain] ??= []);
    if (!list.includes(contract)) list.push(contract);
  };

  /**
   * The dense contracts go FIRST, and that ordering is load-bearing.
   *
   * The sweep can only afford ten contracts per chain per poll. These were
   * appended after the top fifty, which put them at positions twenty-something
   * and meant the cap cut off the exact assets they were added for — WBTC and
   * WETH, the two richest sources of large transfers on Ethereum, were never
   * swept once. Adding them and then never reading them is the worst of both.
   */
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

  for (const coin of sweepable) {
    for (const reader of coin.readers) add(reader.chain, reader.contract);
  }

  return byChain;
}
