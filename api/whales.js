/**
 * The crypto whale tracker's server half — and the twelfth function.
 *
 * A Hobby deployment is allowed twelve serverless functions and eleven were
 * already spent, so this is the last one there will be. It is written as a
 * router for that reason: `?resource=` rather than two files, the same trick
 * api/auth/[action].js plays for ten endpoints, so anything on-chain that comes
 * later lands here instead of failing the build. Vercel does not warn when the
 * limit is passed. It simply stops deploying.
 *
 *   ?resource=coins  the top fifty, joined to what can actually be watched
 *   ?resource=feed   the transfers, read from the store and topped up
 *
 * Signed-in only. The data is public but the key behind it is not, and an open
 * proxy on someone else's rate limit is not a thing to leave lying around.
 */
import { fail, methodIs, readCookies, send } from './_lib/http.js';
import { userForToken } from './_lib/accounts.js';
import { topCoins } from './_lib/topcoins.js';
import { fetchTransfers, feedConfigured } from './_lib/whalealert.js';
import * as store from './_lib/whalestore.js';

const SESSION_COOKIE = 'pt_session';

/** The floor the tracker cares about. Well above the provider's own $500k. */
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
let lastPollError = null;

/**
 * Top the store up, at most once a minute, and never at the cost of the answer.
 *
 * A provider that is down, rate limited or unconfigured leaves whatever is
 * already stored perfectly readable, so the failure is reported alongside the
 * rows rather than instead of them.
 */
async function topUp(now) {
  if (!feedConfigured()) return { polled: false, error: 'no-key' };
  if (now - lastPollAt < POLL_MS) return { polled: false, error: lastPollError };
  lastPollAt = now;

  try {
    const newest = await store.latestAt();
    const floor = Math.floor(now / 1000) - MAX_LOOKBACK_S;
    const start = Math.max(floor, (newest ?? floor) - OVERLAP_S);

    const transfers = await fetchTransfers({ start, minValue: FLOOR_USD });
    await store.record(transfers);
    await store.prune({ now });

    lastPollError = null;
    return { polled: true, found: transfers.length, error: null };
  } catch (err) {
    lastPollError = err.message;
    return { polled: true, error: err.message };
  }
}

/** Only for the tests, which drive the poll clock themselves. */
export function resetPollClock() {
  lastPollAt = 0;
  lastPollError = null;
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
        configured: feedConfigured(),
        error: poll.error ?? null,
        stored: rows.length,
      },
    });
  } catch (err) {
    return fail(res, 500, `Could not read the whale store (${err.message}).`);
  }
}
