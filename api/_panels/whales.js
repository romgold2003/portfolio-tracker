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
import { positionsFor } from '../_lib/leverage.js';
import { loadExchanges, netflow, exchangeOf, VENUES } from '../_lib/exchanges.js';
import { verdictFor, isStable } from '../_lib/verdict.js';
import * as netflowCard from '../_lib/netflowcard.js';
import { rankHolders, exitEvents } from '../_lib/topholders.js';
import { classifyActivity } from '../_lib/activity.js';
import { CHAINS, priceFor } from '../_lib/chainfeeds.js';
import {
  WINDOWS, windowDef, accumulation, performance, consensus, stealth,
  PARTICIPANT_FLOOR_USD, ranked, WHALE_FLOOR_USD, linkSwaps,
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
   * Everything the accumulation, consensus and stealth layers do is arithmetic
   * over a history — and until this existed the app only collected while
   * somebody had the panel open. A tab open for five minutes a day gives five
   * minutes of tape a day, which is why the store held twelve transfers and
   * every consensus reading came back Neutral: not because the whales were
   * balanced, but because almost nothing had been watched.
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
    const win = windowDef(url.searchParams.get('window') || '1m');
    // The size band is the filter on a whale's position, so it comes from the
    // request rather than being fixed.
    const bandMin = Math.max(WHALE_FLOOR_USD, Number(url.searchParams.get('min')) || 0);
    const rawMax = Number(url.searchParams.get('max'));
    const bandMax = Number.isFinite(rawMax) && rawMax > bandMin ? rawMax : Infinity;

    try {
      // Every transfer in the longest window; the layers slice it themselves.
      const rows = await store.read({ symbol: symbol || null, minUsd: 0, limit: 50_000 });
      /**
       * Two transfers minimum, so a wallet seen once does not arrive paired
       * with its own mirror image. See the note on accumulation().
       */
      const wallets = accumulation(rows, {
        hours: win.hours, symbol: symbol || null, minTransfers: 2,
      });

      let prices = null;
      try { prices = await priceMap(); } catch { /* performance goes unscored */ }

      /**
       * A wallet has to have ended the window somewhere other than where it
       * started, and by enough to matter.
       *
       * Six of eight rows in the first real list read "$0.0M" — and they were
       * not rounding artefacts, they were exactly zero: $7,175,638 in and
       * $7,175,638 straight back out. Bitcoin change addresses, hot-wallet
       * relays, DEX routers. Money passing through is not money taking a side,
       * which is what conviction 0.000 was already saying and nothing was
       * acting on.
       *
       * The floor is the one consensus already uses, so the list and the
       * summary above it now agree about who counts. Before this the list was
       * full of wallets the consensus was correctly ignoring.
       */
      const scored = wallets
        .filter((w) => Math.abs(w.netUsd) >= PARTICIPANT_FLOOR_USD)
        .map((w) => ({ ...w, performance: prices ? performance(w, prices) : null }))
        .sort((a, b) => Math.abs(b.netUsd) - Math.abs(a.netUsd));

      res.setHeader('Cache-Control', 'no-store');
      return send(res, 200, {
        window: win.id,
        band: { min: bandMin, max: Number.isFinite(bandMax) ? bandMax : null },
        windows: WINDOWS.map((w) => ({ id: w.id, label: w.label })),
        symbol: symbol || null,
        wallets: scored.slice(0, 40),
        // One row per whale per coin, biggest position first, fifty deep.
        ranked: ranked(wallets, { min: bandMin, max: bandMax, prices }),
        whaleFloor: WHALE_FLOOR_USD,
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

  /** Holders whose balance has fallen — the direct answer to "is the team selling". */
  if (resource === 'holders') {
    await topUp(Date.now());
    const symbol = (url.searchParams.get('symbol') || '').trim().toUpperCase();
    if (symbol && !/^[A-Z0-9]{1,12}$/.test(symbol)) return fail(res, 400, 'That is not a symbol.');
    const win = windowDef(url.searchParams.get('window') || '1m');
    const days = Number.isFinite(win.hours) ? Math.ceil(win.hours / 24) : holders.RETAIN_DAYS;

    try {
      const moves = await holders.changes({ days, symbol: symbol || null });
      res.setHeader('Cache-Control', 'no-store');
      return send(res, 200, { moves, days, at: Date.now() });
    } catch (err) {
      return fail(res, 500, `Could not read the holder record (${err.message}).`);
    }
  }

  /**
   * One wallet's leveraged positions, asked for on demand.
   *
   * Per address rather than swept: a position matters when you are already
   * asking about a particular wallet, and fifty lookups a poll to fill a column
   * that is usually empty would be a poor trade.
   */
  if (resource === 'leverage') {
    const address = (url.searchParams.get('address') || '').trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
      return send(res, 200, { supported: false, positions: [], accountValue: null });
    }
    try {
      res.setHeader('Cache-Control', 'private, max-age=60');
      return send(res, 200, await positionsFor(address));
    } catch (err) {
      return fail(res, 502, `Could not reach Hyperliquid (${err.message}).`);
    }
  }

  /**
   * The whole reading for one asset, in one request.
   *
   * Exchange flow, holder changes, whale positions and the verdict that weighs
   * them are four views of one book. Asking separately would re-read the same
   * rows four times and, worse, could answer from four different moments.
   */
  if (resource === 'verdict') {
    const symbol = (url.searchParams.get('symbol') || '').trim().toUpperCase();
    if (symbol && !/^[A-Z0-9]{1,12}$/.test(symbol)) return fail(res, 400, 'That is not a symbol.');
    const win = windowDef(url.searchParams.get('window') || '1m');
    await topUp(Date.now());

    try {
      const rows = await store.read({ minUsd: 0, limit: 50_000 });

      /**
       * The label set is allowed to fail on its own. Without it the exchange
       * and stablecoin signals abstain, which is a thinner verdict and not a
       * wrong one — as opposed to guessing that an unlabelled address is an
       * exchange, which would be.
       */
      let byAddress = null;
      try { byAddress = await loadExchanges(); } catch { /* those signals abstain */ }

      const days = Number.isFinite(win.hours) ? Math.ceil(win.hours / 24) : holders.RETAIN_DAYS;
      const [holderMoves, prices] = await Promise.all([
        holders.changes({ days, symbol: symbol || null }).catch(() => []),
        priceMap().catch(() => null),
      ]);

      const flows = byAddress
        ? netflow(rows, { byAddress, hours: win.hours, symbol: symbol || null })
        : [];

      /** Stablecoins are read together: it is buying power, not a position. */
      const stableRows = byAddress
        ? netflow(rows, { byAddress, hours: win.hours }).filter((f) => isStable(f.symbol))
        : [];
      const stables = stableRows.length
        ? stableRows.reduce((a, f) => ({
          symbol: 'stablecoins',
          inUsd: a.inUsd + f.inUsd,
          outUsd: a.outUsd + f.outUsd,
          netUsd: a.netUsd + f.netUsd,
          grossUsd: a.grossUsd + f.grossUsd,
          transfers: a.transfers + f.transfers,
        }), { inUsd: 0, outUsd: 0, netUsd: 0, grossUsd: 0, transfers: 0 })
        : null;

      const wallets = accumulation(rows, {
        hours: win.hours, symbol: symbol || null, minTransfers: 2,
      });

      const verdict = verdictFor({
        symbol: symbol || null,
        flow: flows.find((f) => !symbol || f.symbol === symbol) ?? null,
        stables,
        holders: holderMoves,
        wallets,
      });

      res.setHeader('Cache-Control', 'no-store');
      return send(res, 200, {
        window: win.id,
        windows: WINDOWS.map((w) => ({ id: w.id, label: w.label })),
        symbol: symbol || null,
        verdict,
        flows: flows.slice(0, 12),
        stables,
        holders: holderMoves.slice(0, 25),
        ranked: ranked(wallets, {
          min: Math.max(WHALE_FLOOR_USD, Number(url.searchParams.get('min')) || 0),
          max: (() => {
            const m = Number(url.searchParams.get('max'));
            return Number.isFinite(m) && m > 0 ? m : Infinity;
          })(),
          prices,
        }),
        stealth: stealth(wallets, { displayFloor: FLOOR_USD }),
        labels: byAddress ? byAddress.size : 0,
        venues: Object.values(VENUES),
        observed: {
          transfers: rows.length,
          since: rows.length ? Math.min(...rows.map((r) => r.at)) : null,
        },
        at: Date.now(),
      });
    } catch (err) {
      return fail(res, 500, `Could not build the reading (${err.message}).`);
    }
  }

  /** Exchange netflow on its own, for every window at once. */
  if (resource === 'flows') {
    const symbol = (url.searchParams.get('symbol') || '').trim().toUpperCase();
    if (symbol && !/^[A-Z0-9]{1,12}$/.test(symbol)) return fail(res, 400, 'That is not a symbol.');
    await topUp(Date.now());

    try {
      const rows = await store.read({ minUsd: 0, limit: 50_000 });
      const byAddress = await loadExchanges();
      const out = {};
      for (const w of WINDOWS) {
        out[w.id] = netflow(rows, { byAddress, hours: w.hours, symbol: symbol || null });
      }
      res.setHeader('Cache-Control', 'no-store');
      return send(res, 200, {
        windows: WINDOWS.map((w) => ({ id: w.id, label: w.label, hours: w.hours })),
        flows: out,
        /**
         * How far back the record actually goes.
         *
         * Without it five identical rows read as a broken control. They are
         * not: a window longer than the record returns exactly what the
         * shorter one did, and the only honest thing is to say so.
         */
        since: rows.length ? Math.min(...rows.map((r) => r.at)) : null,
      });
    } catch (err) {
      return fail(res, 502, `Could not read the exchange labels (${err.message}).`);
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
    await topUp(Date.now());
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
  const poll = await topUp(now);

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
        stored: rows.length,
      },
    });
  } catch (err) {
    return fail(res, 500, `Could not read the whale store (${err.message}).`);
  }
}
