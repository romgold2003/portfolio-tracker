/**
 * The crypto whale tracker's server half.
 *
 * Reached at /api/whales, served by api/news/[panel].js, which is one function
 * for all seven News panels. This lived as its own file once and that is what
 * pushed the deployment to thirteen functions against a limit of twelve — a
 * limit Vercel enforces by quietly not deploying rather than by failing. Two
 * resources behind one `?resource=` for the same reason: what can be one
 * function should be.
 *
 *   ?resource=coins  the top fifty, joined to what can actually be watched
 *   ?resource=feed   the transfers, read from the store and topped up
 *
 * Signed-in only. The data is public but the key behind it is not, and an open
 * proxy on someone else's rate limit is not a thing to leave lying around.
 */
import { fail, methodIs, readCookies, send } from '../_lib/http.js';
import { userForToken } from '../_lib/accounts.js';
import { topCoins, priceMap, watchContracts } from '../_lib/topcoins.js';
import { fetchTransfers, feedConfigured } from '../_lib/whalealert.js';
import { collect, FLOOR_USD as CHAIN_FLOOR } from '../_lib/chainfeeds.js';
import * as store from '../_lib/whalestore.js';
import {
  WINDOWS, windowDef, accumulation, performance, consensus, stealth,
} from '../_lib/whaleflow.js';


const SESSION_COOKIE = 'pt_session';

/**
 * Two floors, and the difference between them is the point.
 *
 * CHAIN_FLOOR is what gets recorded — a million — because a position built in
 * ten three-million-dollar pieces cannot be added up from rows that were never
 * kept. DISPLAY_FLOOR is what the transfer list shows, which stays at twenty
 * million so that view means what it always meant.
 */
const FLOOR_USD = 20_000_000;

/**
 * How often the provider is actually asked, regardless of how often the panel
 * refreshes. The free plan allows ten calls a minute across the whole
 * deployment, and every open tab shares it.
 */
const POLL_MS = 60_000;

/**
 * How far back a top-up reaches.
 *
 * From the newest row held, minus a deliberate overlap: a poll that asked from
 * exactly where the last one finished would lose anything the provider indexed
 * a moment late. Duplicates are free — the store's primary key drops them — and
 * a missed transfer is gone until someone notices it never appeared.
 */
const OVERLAP_S = 120;
const MAX_LOOKBACK_S = 60 * 60;

let lastPollAt = 0;
let lastPoll = { failed: [], written: 0, at: 0 };

/**
 * Top the store up, at most once a minute, and never at the cost of the answer.
 *
 * The keyless chain readers always run. Whale Alert is asked *as well* when a
 * key is set — it sees chains this app has no reader for and labels addresses
 * better than any of them — but it is an upgrade rather than a dependency.
 * The first version had it as the only source, which meant a deployment with
 * no key showed an empty panel forever. That is not a tracker.
 *
 * Everything is settled rather than raced: a source that is down costs its own
 * chain and nothing else, and what is already stored stays perfectly readable.
 * The failures are returned so the panel can name them.
 */
async function topUp(now) {
  if (now - lastPollAt < POLL_MS) return lastPoll;
  lastPollAt = now;

  const failed = [];
  let written = 0;

  let prices = null;
  try {
    prices = await priceMap();
  } catch (err) {
    failed.push({ chain: 'prices', error: err.message });
  }

  if (prices) {
    try {
      /**
       * The addresses to sweep come from CoinGecko's platform map, so the
       * sweep follows the top fifty as it changes — but that map is nineteen
       * thousand rows and the first fetch of it is slow enough to blow the
       * whole request's budget on its own.
       *
       * So it is raced rather than awaited. A poll that arrives before the map
       * is warm sweeps the chain-wide feeds only, which is thinner and not
       * wrong, and the fetch it started keeps running and fills the cache for
       * the next one. Nothing waits a minute to be slightly more thorough.
       */
      const contracts = await Promise.race([
        watchContracts().catch(() => ({})),
        new Promise((resolve) => { setTimeout(() => resolve({}), 2500); }),
      ]);
      const { rows, failed: chainFailures } = await collect({ prices, contracts });
      failed.push(...chainFailures);
      written += await store.record(rows);
    } catch (err) {
      failed.push({ chain: 'chains', error: err.message });
    }
  }

  if (feedConfigured()) {
    try {
      const newest = await store.latestAt();
      const floor = Math.floor(now / 1000) - MAX_LOOKBACK_S;
      const start = Math.max(floor, (newest ?? floor) - OVERLAP_S);
      written += await store.record(await fetchTransfers({ start, minValue: FLOOR_USD }));
    } catch (err) {
      failed.push({ chain: 'whale-alert', error: err.message });
    }
  }

  try { await store.prune({ now }); } catch { /* pruning is housekeeping */ }

  lastPoll = { failed, written, at: now };
  return lastPoll;
}

/** Only for the tests, which drive the poll clock themselves. */
export function resetPollClock() {
  lastPollAt = 0;
  lastPoll = { failed: [], written: 0, at: 0 };
}

export default async function handler(req, res) {
  if (!methodIs(req, res, 'GET')) return;

  const user = await userForToken(readCookies(req)[SESSION_COOKIE]);
  if (!user) return fail(res, 401, 'Not signed in.');

  const url = new URL(req.url, 'http://localhost');
  const resource = url.searchParams.get('resource') || 'feed';

  if (resource === 'coins') {
    try {
      const { coins, chains, watchable } = await topCoins();
      // The ranking moves slowly and the coverage list barely at all.
      res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600');
      return send(res, 200, { coins, chains, watchable, feed: feedConfigured() });
    } catch (err) {
      return fail(res, 502, `Could not build the coin list (${err.message}).`);
    }
  }

  /**
   * The per-wallet view: who has been accumulating, not what moved once.
   *
   * Polled the same way the feed is, because it reads the same store — the
   * aggregation is over rows already there, so this costs a query and no
   * upstream call at all.
   */
  if (resource === 'wallets') {
    await topUp(Date.now());
    const symbol = (url.searchParams.get('symbol') || '').trim().toUpperCase();
    if (symbol && !/^[A-Z0-9]{1,12}$/.test(symbol)) return fail(res, 400, 'That is not a symbol.');
    const days = Math.min(Math.max(Number(url.searchParams.get('days')) || 30, 1), 30);
    const minNet = Math.max(0, Number(url.searchParams.get('minNet')) || CHAIN_FLOOR);

    try {
      const wallets = await store.byAddress({
        symbol: symbol || null,
        sinceDays: days,
        minNetUsd: minNet,
        // Mints, burns and contract legs are not a wallet taking a position.
        kinds: ['transfer'],
        limit: 40,
      });
      res.setHeader('Cache-Control', 'no-store');
      return send(res, 200, { wallets, days, minNet, at: Date.now() });
    } catch (err) {
      return fail(res, 500, `Could not aggregate the store (${err.message}).`);
    }
  }

  /**
   * The intelligence layers, all of them over the same recorded transfers.
   *
   * One request rather than four, because they are four readings of one book
   * and asking separately would re-aggregate the same rows each time.
   */
  if (resource === 'flow') {
    await topUp(Date.now());
    const symbol = (url.searchParams.get('symbol') || '').trim().toUpperCase();
    if (symbol && !/^[A-Z0-9]{1,12}$/.test(symbol)) return fail(res, 400, 'That is not a symbol.');
    const win = windowDef(url.searchParams.get('window') || '7d');

    try {
      // Every transfer in the longest window; the layers slice it themselves.
      const rows = await store.read({ symbol: symbol || null, minUsd: 0, limit: 20_000 });
      const wallets = accumulation(rows, { hours: win.hours, symbol: symbol || null });

      let prices = null;
      try { prices = await priceMap(); } catch { /* performance goes unscored */ }

      const scored = wallets
        .map((w) => ({ ...w, performance: prices ? performance(w, prices) : null }))
        .sort((a, b) => Math.abs(b.netUsd) - Math.abs(a.netUsd));

      res.setHeader('Cache-Control', 'no-store');
      return send(res, 200, {
        window: win.id,
        windows: WINDOWS.map((w) => ({ id: w.id, label: w.label })),
        symbol: symbol || null,
        wallets: scored.slice(0, 40),
        consensus: consensus(wallets),
        stealth: stealth(wallets, { displayFloor: FLOOR_USD }),
        observed: {
          transfers: rows.length,
          /** How much history there is to reason over, said plainly. */
          since: rows.length ? Math.min(...rows.map((r) => r.at)) : null,
        },
        at: Date.now(),
      });
    } catch (err) {
      return fail(res, 500, `Could not read the flow (${err.message}).`);
    }
  }

  if (resource !== 'feed') return fail(res, 400, 'No such resource.');

  const now = Date.now();
  const poll = await topUp(now);

  const symbol = (url.searchParams.get('symbol') || '').trim().toUpperCase();
  if (symbol && !/^[A-Z0-9]{1,12}$/.test(symbol)) return fail(res, 400, 'That is not a symbol.');

  const minUsd = Math.max(FLOOR_USD, Number(url.searchParams.get('min')) || 0);
  const rawMax = Number(url.searchParams.get('max'));
  const maxUsd = Number.isFinite(rawMax) && rawMax > minUsd ? rawMax : Infinity;

  try {
    const rows = await store.read({ symbol: symbol || null, minUsd, maxUsd, limit: 200 });
    const counts = await store.countsBySymbol({ minUsd: FLOOR_USD });

    /**
     * Never cached at the edge.
     *
     * The rows depend on the query and the answer changes every minute; a
     * shared cache here would hand one viewer's filter to the next.
     */
    res.setHeader('Cache-Control', 'no-store');
    return send(res, 200, {
      rows,
      counts: Object.fromEntries(counts),
      floor: FLOOR_USD,
      at: now,
      /**
       * What is wrong, when something is — said plainly rather than as an
       * empty list. "Nothing this big has moved" and "the provider is not
       * configured" look identical on screen otherwise, and only one of them
       * is something the reader can act on.
       */
      provider: {
        // The keyless readers are always there, so the panel is never in the
        // "nothing is configured" state the first version could reach.
        configured: true,
        whaleAlert: feedConfigured(),
        failed: poll.failed,
        error: poll.failed.length
          ? poll.failed.map((f) => `${f.chain}: ${f.error}`).join('; ')
          : null,
        polledAt: poll.at,
        stored: rows.length,
      },
    });
  } catch (err) {
    return fail(res, 500, `Could not read the whale store (${err.message}).`);
  }
}
