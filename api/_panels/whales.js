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
import * as holders from '../_lib/holders.js';
import { loadExchanges, exchangeOf } from '../_lib/exchanges.js';
import * as netflowCard from '../_lib/netflowcard.js';
import { rankHolders, exitEvents } from '../_lib/topholders.js';
import { classifyActivity, linkSwaps } from '../_lib/activity.js';
import { withBudget } from '../_lib/budget.js';
import { CHAINS, priceFor } from '../_lib/chainfeeds.js';

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
 * How long a page load will wait for fresher data before answering without it.
 *
 * Production answered 504 on the first request into a cold function. The feed
 * awaited a full sweep of five chains — about twenty-five seconds warm, longer
 * when the price map and the platform map are both cold — and Vercel cuts the
 * function at sixty. The reader got nothing, from a store that already held
 * thirty-three perfectly good rows.
 *
 * The store is filled by the scheduled collector every ten minutes, so a page
 * load has no business blocking on a sweep at all. It starts one, waits this
 * long in case it is quick, and then answers with what is held. The sweep keeps
 * running and whatever it writes before the function is frozen is kept — every
 * transfer is written on its own, so a sweep cut halfway leaves real rows
 * behind rather than a broken half-write.
 */
const REFRESH_BUDGET_MS = 6_000;

/**
 * Start a top-up, but never let the answer wait longer than the budget.
 *
 * The throttle inside topUp claims the slot before its first await, so a second
 * request arriving during a sweep does not start another one.
 */
async function refresh(now) {
  if (now - lastPollAt < POLL_MS) return lastPoll;
  return withBudget(topUp(now), REFRESH_BUDGET_MS, { ...lastPoll, slow: true });
}

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
/** Length-independent comparison, so timing reveals nothing about the secret. */
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function topUp(now, { force = false } = {}) {
  // The scheduled collector is the point of being called; it does not wait out
  // a throttle that exists to stop many open tabs polling at once.
  if (!force && now - lastPollAt < POLL_MS) return lastPoll;
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

  /**
   * The holder snapshot, on the same poll.
   *
   * One request per token for fifty balances, which is what makes tracking
   * balances affordable at all — and unlike the transfer sweep it cannot miss
   * anything by being in the wrong place at the wrong second. A balance is a
   * balance whenever you ask.
   */
  if (prices) {
    try {
      written += await snapshotHolders({ prices, now });
    } catch (err) {
      failed.push({ chain: 'holders', error: err.message });
    }
  }

  /**
   * Roll the last couple of days into the daily aggregate.
   *
   * Two days rather than one so a poll either side of midnight still closes
   * out the day it just left. The rollup is what makes the six month and one
   * year rows answerable without walking every raw transfer on a refresh.
   */
  try {
    const byAddress = await loadExchanges();
    const recent = await store.read({ minUsd: 0, limit: 50_000 });
    await netflowCard.roll(recent, { byAddress, days: 2, now });
    await netflowCard.prune({ now });
  } catch { /* the card falls back to the raw rows */ }

  try { await store.prune({ now }); } catch { /* pruning is housekeeping */ }
  try { await holders.prune({ now }); } catch { /* pruning is housekeeping */ }

  lastPoll = { failed, written, at: now };
  return lastPoll;
}

/**
 * Read the top holders of every swept token, on the chains that can answer.
 *
 * Only the Blockscout-shaped chains: the holders endpoint is theirs, and Tron,
 * XRPL and Bitcoin have no equivalent that is free. Settled rather than raced,
 * so one token that will not answer costs that token.
 */
async function snapshotHolders({ prices, now }) {
  const contracts = await Promise.race([
    watchContracts().catch(() => ({})),
    new Promise((resolve) => { setTimeout(() => resolve({}), 2000); }),
  ]);

  const hosts = { ethereum: 'eth.blockscout.com', polygon: 'polygon.blockscout.com' };
  const jobs = [];

  for (const chain of CHAINS) {
    const host = hosts[chain.id];
    if (!host) continue;
    for (const token of (contracts[chain.id] ?? []).slice(0, 8)) {
      jobs.push({ host, chain: chain.id, token });
    }
  }

  /**
   * Twelve seconds, and the arithmetic matters.
   *
   * The transfer sweep already spends twenty-two of the sixty a function is
   * allowed. Measured with the holder snapshot added, one poll took forty-one
   * seconds — under the limit and with no room left for a slow afternoon.
   * Whatever this does not finish is asked for again next poll, and a balance
   * missed by ten minutes is still the same balance.
   */
  const clock = AbortSignal.timeout(12_000);
  const answers = await Promise.allSettled(jobs.map(async ({ host, chain, token }) => {
    return holders.fetchHolders({ host, chain, token, signal: clock });
  }));

  const all = [];
  for (const a of answers) if (a.status === 'fulfilled') all.push(...a.value);

  /**
   * Priced through the same function the transfers use, wrappers included.
   *
   * Reading the map directly left every wrapped asset at zero — CBBTC is not in
   * CoinGecko's depth under its own ticker, so a Safe holding millions of
   * dollars of it reported as holding nothing and would never have crossed the
   * threshold to be reported at all.
   */
  const priced = [];
  for (const r of all) {
    const price = priceFor(r.symbol, prices);
    if (!price) continue;
    r.usd = r.units * price;
    priced.push(r);
  }
  return holders.record(priced, { now });
}

/** Only for the tests, which drive the poll clock themselves. */
export function resetPollClock() {
  lastPollAt = 0;
  lastPoll = { failed: [], written: 0, at: 0 };
}

export default async function handler(req, res) {
  if (!methodIs(req, res, 'GET')) return;

  const url = new URL(req.url, 'http://localhost');
  const resource = url.searchParams.get('resource') || 'feed';

  /**
   * The scheduled collector, and the reason the record is worth anything.
   *
   * Every card on the page is arithmetic over a history — and until this
   * existed the app only collected while somebody had the panel open. A tab
   * open for five minutes a day gives five minutes of tape a day, which is why
   * the store held twelve transfers and the netflow card had nothing to say:
   * not because nothing was moving, but because almost nothing was watched.
   *
   * So this one path polls without a session, guarded by a shared secret rather
   * than a login, and something outside calls it on a schedule. It writes to the
   * store and returns a count; it never reads anybody's data out.
   *
   * Compared in constant time, because a secret checked with === leaks its
   * length and its prefix to anyone willing to time the answers.
   */
  if (resource === 'poll') {
    const expected = process.env.CRON_SECRET || '';
    const given = url.searchParams.get('key') || '';
    if (!expected) return fail(res, 503, 'No collector secret is configured.');
    if (!timingSafeEqual(given, expected)) return fail(res, 401, 'Wrong key.');

    const poll = await topUp(Date.now(), { force: true });
    res.setHeader('Cache-Control', 'no-store');
    return send(res, 200, { written: poll.written, failed: poll.failed, at: poll.at });
  }

  const user = await userForToken(readCookies(req)[SESSION_COOKIE]);
  if (!user) return fail(res, 401, 'Not signed in.');

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
   * Market-wide exchange netflow. **Takes no symbol on purpose.**
   *
   * The coin picker elsewhere answers "what is happening to BTC". This answers
   * "what is happening to the market", and accepting a symbol here would let
   * the two be confused — the same card quietly answering a different question
   * depending on what was clicked somewhere else on the page.
   */
  if (resource === 'netflow') {
    await refresh(Date.now());
    try {
      const now = Date.now();
      const byAddress = await loadExchanges();
      const rows = await store.read({ minUsd: 0, limit: 50_000 });
      const periods = await netflowCard.build({ rows, byAddress, now });

      res.setHeader('Cache-Control', 'no-store');
      return send(res, 200, {
        periods,
        venues: [...new Set([...byAddress.values()].map((v) => v.venue))].sort(),
        labels: byAddress.size,
        /** So the card can say how much of a long period it can really answer for. */
        since: rows.length ? Math.min(...rows.map((r) => r.at)) : null,
        at: now,
      });
    } catch (err) {
      return fail(res, 502, `Could not read the exchange flow (${err.message}).`);
    }
  }

  /**
   * The top holders of one coin, and what happened when one of them left.
   *
   * **This one does follow the coin picker** — the opposite of the netflow
   * card, and deliberately so: "who holds the most ETH" is a question about
   * ETH, and answering it for the market would be meaningless.
   */
  if (resource === 'topholders') {
    const symbol = (url.searchParams.get('symbol') || '').trim().toUpperCase();
    if (!symbol) return send(res, 200, { holders: [], events: [], symbol: null, needsCoin: true });
    if (!/^[A-Z0-9_]{1,12}$/.test(symbol)) return fail(res, 400, 'That is not a symbol.');

    try {
      const now = Date.now();
      let byAddress = null;
      try { byAddress = await loadExchanges(); } catch { /* venues go unnamed */ }

      const { coins } = await topCoins();
      const coin = coins.find((c) => c.symbol === symbol);
      const reader = (coin?.readers ?? []).find((r) => r.contract);
      const hosts = { ethereum: 'eth.blockscout.com', polygon: 'polygon.blockscout.com' };
      const host = reader ? hosts[reader.chain] : null;

      if (!host || !reader?.contract) {
        return send(res, 200, {
          symbol,
          holders: [],
          events: [],
          /** Said plainly rather than returned as an empty list. */
          unsupported: `${symbol} has no token contract on a chain this app can read holders for.`,
        });
      }

      const [info, rows, prices] = await Promise.all([
        holders.fetchTokenInfo({ host, token: reader.contract }),
        holders.fetchHolders({ host, chain: reader.chain, token: reader.contract }),
        priceMap().catch(() => null),
      ]);

      const price = prices ? priceFor(symbol, prices) : null;
      const ranked25 = rankHolders(rows, {
        price,
        totalSupply: info?.totalSupply ?? null,
        byAddress,
        creator: info?.creator ?? null,
        limit: 25,
      });

      /**
       * The lower table. Balance falls come from the holder record and the
       * route comes from the transfer record; the join is the address.
       */
      const [changes, transfers] = await Promise.all([
        holders.changes({ days: 30, symbol, minUsd: 250_000, minPct: 1 }).catch(() => []),
        store.read({ symbol, minUsd: 0, limit: 10_000 }).catch(() => []),
      ]);
      const events = exitEvents({
        changes,
        transfers: linkSwaps(transfers),
        byAddress,
        symbol,
        limit: 20,
      });

      res.setHeader('Cache-Control', 'no-store');
      return send(res, 200, {
        symbol,
        chain: reader.chain,
        contract: reader.contract,
        price,
        totalSupply: info?.totalSupply ?? null,
        holders: ranked25,
        /** Everything, so the card can say what it filtered out of the ranking. */
        excluded: rankHolders(rows, {
          price, totalSupply: info?.totalSupply ?? null, byAddress,
          creator: info?.creator ?? null, limit: 50, investorsOnly: false,
        }).filter((h) => h.kind !== 'whale').slice(0, 8),
        events,
        at: now,
      });
    } catch (err) {
      return fail(res, 502, `Could not read the holders (${err.message}).`);
    }
  }

  if (resource !== 'feed') return fail(res, 400, 'No such resource.');

  const now = Date.now();
  const poll = await refresh(now);

  const symbol = (url.searchParams.get('symbol') || '').trim().toUpperCase();
  if (symbol && !/^[A-Z0-9]{1,12}$/.test(symbol)) return fail(res, 400, 'That is not a symbol.');

  const minUsd = Math.max(FLOOR_USD, Number(url.searchParams.get('min')) || 0);
  const rawMax = Number(url.searchParams.get('max'));
  const maxUsd = Number.isFinite(rawMax) && rawMax > minUsd ? rawMax : Infinity;

  /**
   * How far back the tape reaches, from the Live Whale Activity timeframe.
   *
   * Capped at the retention window rather than trusted: the parameter arrives
   * from the browser, and a request for ten years would quietly become a
   * request for everything the store holds anyway.
   */
  const rawHours = Number(url.searchParams.get('hours'));
  const hours = Number.isFinite(rawHours) && rawHours > 0 ? Math.min(rawHours, 24 * 397) : null;
  const since = hours ? Math.floor(now / 1000) - hours * 3600 : null;

  try {
    /**
     * Read the whole recent book, then filter.
     *
     * The size filter has to come after the swap link, not before: the other
     * half of a trade is frequently a different size and would be filtered out,
     * leaving a leg that knows it was a swap and cannot say what for.
     */
    const all = linkSwaps(await store.read({ symbol: symbol || null, minUsd: 0, limit: 4_000 }));

    /**
     * Name the exchanges on the way out.
     *
     * Applied at read time rather than when the row was written, so it
     * reaches every transfer already in the store rather than only the ones
     * recorded after the label set existed.
     */
    let byAddress = null;
    try {
      byAddress = await loadExchanges();
      for (const r of all) {
        const to = exchangeOf(r.to?.address, byAddress);
        const from = exchangeOf(r.from?.address, byAddress);
        if (to) { r.to.owner = to.name; r.to.ownerType = 'exchange'; }
        if (from) { r.from.owner = from.name; r.from.ownerType = 'exchange'; }
      }
    } catch { /* unlabelled is the honest fallback */ }

    /**
     * Size, then time, then the classifier.
     *
     * The bands are half-open on purpose — at least the floor, below the
     * ceiling — so a transfer of exactly a hundred million appears in
     * $100M–250M and nowhere else. A row landing in two bands would be counted
     * twice by anybody adding the columns up.
     */
    const rows = all
      .filter((r) => r.usd >= minUsd && r.usd < maxUsd)
      .filter((r) => since == null || r.at >= since)
      .slice(0, 200)
      .map((r) => ({ ...r, activity: classifyActivity(r, { byAddress, subject: symbol || null }) }));
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
      /** What the tape was asked for, so the panel can label what it shows. */
      window: { hours, since },
      /** The oldest transfer held at all — "1 year" is a request, not a promise. */
      recordSince: all.length ? all[all.length - 1].at : null,
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
        /** True when the answer did not wait for the sweep it started. */
        refreshing: poll.slow === true,
        stored: rows.length,
      },
    });
  } catch (err) {
    return fail(res, 500, `Could not read the whale store (${err.message}).`);
  }
}
