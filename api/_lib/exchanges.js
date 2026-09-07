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
