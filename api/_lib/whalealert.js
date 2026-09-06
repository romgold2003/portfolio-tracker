/**
 * Whale Alert, normalised.
 *
 * Two endpoints, and they are not the same kind of thing at all:
 *
 *   leviathan.whale-alert.io/status   public, no key — which chains and which
 *                                     symbols the provider can actually see
 *   api.whale-alert.io/v1/transactions  keyed — the transfers themselves
 *
 * The first is what makes the coin picker honest. Rather than shipping a table
 * of "SOL is on Solana" that rots the moment a chain is added or dropped, the
 * app asks the provider what it covers and says *unsupported* for everything
 * else. On the day this was written that answer was fourteen chains and 138
 * symbols, and it already disagreed with the obvious guess in both directions:
 * USDT is tracked across nine networks, while AVAX, SUI, TON, DOT and ATOM —
 * all comfortably top fifty — are not tracked at all.
 *
 * Why this provider and not another. Arkham sits behind a Cloudflare challenge,
 * which is not something to work around. Blockchair answers per chain with no
 * USD value and no entity labels, so every row would be a hash and a number.
 * ClankApp, the free mirror everyone used to point at, no longer resolves.
 * Whale Alert is the only source left that gives the four things a row here
 * needs at once: the USD value, the chain, the transfer type, and who the
 * counterparties are when it knows.
 *
 * The key is read from the environment and never leaves the server. Without one
 * the coverage half still works and the feed half says so, which is the whole
 * reason they are separate calls.
 */

const STATUS_URL = 'https://leviathan.whale-alert.io/status';
const FEED_URL = 'https://api.whale-alert.io/v1/transactions';

export const apiKey = () => process.env.WHALE_ALERT_KEY || '';
export const feedConfigured = () => !!apiKey();

/**
 * The chains a symbol lives on, from the provider's own coverage list.
 *
 * Cached for an hour in module scope. A warm serverless instance answers the
 * picker without a round trip, and a cold one pays for it once; the list
 * changes when a chain is integrated, which is a matter of months.
 */
const COVERAGE_TTL_MS = 60 * 60 * 1000;
let coverageCache = { at: 0, value: null };

export function resetCoverageCache() {
  coverageCache = { at: 0, value: null };
}

export async function fetchCoverage({ now = Date.now(), fetcher = fetch } = {}) {
  if (coverageCache.value && now - coverageCache.at < COVERAGE_TTL_MS) return coverageCache.value;

  const res = await fetcher(STATUS_URL, {
    headers: { Accept: 'application/json', 'User-Agent': 'riskbook' },
  });
  if (!res.ok) throw new Error(`Whale Alert status answered ${res.status}`);
  const chains = await res.json();
  if (!Array.isArray(chains)) throw new Error('Whale Alert status sent something else');

  /** symbol -> the chains it can be watched on, upper-cased for lookup. */
  const bySymbol = new Map();
  for (const chain of chains) {
    const name = String(chain?.name ?? '').trim();
    if (!name || !Array.isArray(chain?.symbols)) continue;
    for (const raw of chain.symbols) {
      const symbol = String(raw ?? '').trim().toUpperCase();
      if (!symbol) continue;
      if (!bySymbol.has(symbol)) bySymbol.set(symbol, []);
      bySymbol.get(symbol).push(name);
    }
  }

  const value = {
    chains: chains.map((c) => String(c?.name ?? '')).filter(Boolean).sort(),
    bySymbol,
  };
  coverageCache = { at: now, value };
  return value;
}

/* ── the transfers ─────────────────────────────────────────────────────── */

/**
 * What a row is, once it has stopped being three providers' worth of spelling.
 *
 * `kind` is the thing that separates a whale moving money from a protocol
 * printing it. A hundred million dollars of USDT minted at Tether's treasury is
 * not a transfer and reading it as one has been the single most common way this
 * kind of panel misleads — so mint, burn, lock and unlock are carried through
 * and shown as themselves.
 */
export function normaliseTransfer(raw) {
  const usd = Number(raw?.amount_usd ?? raw?.value_usd);
  const amount = Number(raw?.amount);
  const hash = String(raw?.hash ?? '').trim();
  const blockchain = String(raw?.blockchain ?? '').trim().toLowerCase();
  const symbol = String(raw?.symbol ?? '').trim().toUpperCase();
  const at = Number(raw?.timestamp);

  if (!hash || !blockchain || !symbol) return null;
  if (!Number.isFinite(usd) || usd <= 0) return null;
  if (!Number.isFinite(at) || at <= 0) return null;

  const side = (v) => {
    const address = String(v?.address ?? '').trim();
    const owner = String(v?.owner ?? '').trim();
    const ownerType = String(v?.owner_type ?? '').trim().toLowerCase();
    return {
      address: address || null,
      // An empty owner means the provider does not know, and that is reported
      // as not knowing. Guessing here would be inventing attribution.
      owner: owner || null,
      ownerType: ownerType && ownerType !== 'unknown' ? ownerType : null,
    };
  };

  return {
    /**
     * One transfer, identified across polls and across pages.
     *
     * The hash alone is not enough: a single transaction can carry several
     * transfers, and on the UTXO chains it routinely does. Whale Alert gives
     * each an id, so that is preferred and the rest is the fallback.
     */
    id: `${blockchain}:${hash}:${raw?.id ?? `${symbol}:${amount}`}`,
    at,
    blockchain,
    symbol,
    kind: String(raw?.transaction_type ?? 'transfer').trim().toLowerCase() || 'transfer',
    amount: Number.isFinite(amount) && amount > 0 ? amount : null,
    usd,
    hash,
    from: side(raw?.from),
    to: side(raw?.to),
    // Several inputs or outputs collapsed into one reported movement, which is
    // worth knowing: it is one exchange sweeping, not one whale deciding.
    parts: Number(raw?.transaction_count) || 1,
  };
}

/**
 * Ask for everything above `minValue` between two moments.
 *
 * Paged with the provider's cursor rather than by widening the window, because
 * the window is what the plan limits and the cursor is not. A page that comes
 * back malformed ends the walk instead of throwing: half a window of real
 * transfers is worth more than none, and the next poll asks again from where
 * the store actually reached.
 */
export async function fetchTransfers({
  start,
  end,
  minValue = 500_000,
  maxPages = 5,
  fetcher = fetch,
  key = apiKey(),
} = {}) {
  if (!key) throw new Error('WHALE_ALERT_KEY is not set on this deployment.');

  const out = [];
  let cursor = null;

  for (let page = 0; page < maxPages; page++) {
    const url = new URL(FEED_URL);
    url.searchParams.set('api_key', key);
    url.searchParams.set('min_value', String(Math.round(minValue)));
    url.searchParams.set('start', String(Math.floor(start)));
    if (Number.isFinite(end)) url.searchParams.set('end', String(Math.floor(end)));
    url.searchParams.set('limit', '100');
    if (cursor) url.searchParams.set('cursor', cursor);

    const res = await fetcher(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'riskbook' },
    });

    if (res.status === 401 || res.status === 403) {
      throw new Error('Whale Alert rejected the key.');
    }
    if (res.status === 429) {
      // Rate limited. Whatever has been collected is still good.
      break;
    }
    if (!res.ok) throw new Error(`Whale Alert answered ${res.status}`);

    let body;
    try { body = await res.json(); } catch { break; }
    // The free plan reports a refused window as a JSON error rather than a 4xx.
    if (body?.result === 'error') throw new Error(String(body.message || 'Whale Alert refused.'));

    const rows = Array.isArray(body?.transactions) ? body.transactions : [];
    for (const row of rows) {
      const clean = normaliseTransfer(row);
      if (clean) out.push(clean);
    }

    cursor = typeof body?.cursor === 'string' && body.cursor ? body.cursor : null;
    if (!cursor || rows.length === 0) break;
  }

  return out;
}
