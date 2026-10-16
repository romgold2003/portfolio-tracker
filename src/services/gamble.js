/**
 * Large bets on macro events, from Polymarket.
 *
 * Polymarket settles on Polygon, so every trade is on-chain and public: the
 * wallet that placed it, the pseudonym attached to that wallet, what it bought
 * and what it cost. That is the whole of what this panel shows, and none of it
 * is private data — it is a public ledger read back.
 *
 * Fetched straight from the browser rather than through this app's own API,
 * which is unusual here and deliberate. The endpoint sends
 * `access-control-allow-origin: *`, the data needs no key and belongs to nobody,
 * and Vercel's free plan allows twelve serverless functions of which eleven are
 * already spent. The cost is one more host in the content security policy.
 *
 * The other venues were considered and do not work:
 *
 *   - **Robinhood** has no public trade feed at all. Its event contracts are
 *     routed to Kalshi and its API is per-account and authenticated.
 *   - **Kalshi** publishes trades but is a regulated exchange with no wallets
 *     and no public identities, so it cannot answer "which whale".
 *   - **Hyperliquid** does expose wallets, but it lists crypto perpetuals. It
 *     has no market on a Fed cut or on Iran.
 */

const ENDPOINT = 'https://data-api.polymarket.com/trades';

/** Nothing below this is worth a row, and it is the feed's own filter. */
export const FLOOR_USD = 250_000;

/**
 * The feed is asked twice, at two floors.
 *
 * It answers with the most recent N trades above whatever floor it is given, so
 * one request at a low floor is not a superset of one at a high floor — it is a
 * shorter window. Measured on the earlier floors: 500 trades above $100k reached
 * back twenty-five days, the same 500 above $50k only nine, which emptied the
 * large bands rather than filling the small one.
 *
 * So the high floor keeps the reach the $1M+ band needs, the low one fills
 * $250k–500k, and the overlap is dropped.
 */
const FLOORS = [1_000_000, FLOOR_USD];

/**
 * The bands to read the flow in.
 *
 * A single "over 100k" list is dominated by the smallest qualifying bets, so
 * the size that actually signals conviction never rises to the top. Reading it
 * in bands is how the same list answers "who is nibbling" and "who has decided".
 */
export const BANDS = [
  // Romy's ranges, October 2026: three bands and every bet from $100k up.
  // The first band's floor is the floor every topic is asked from.
  { id: 'k100', label: '$100k–250k', min: 100_000, max: 250_000 },
  { id: 'mid', label: '$250k–500k', min: 250_000, max: 500_000 },
  { id: 'large', label: '$500k+', min: 500_000, max: Infinity },
  { id: 'all', label: 'All', min: 100_000, max: Infinity },
];

export const bandDef = (id) => BANDS.find((b) => b.id === id) ?? BANDS[0];

/**
 * What counts as a subject worth showing.
 *
 * Polymarket's volume is mostly sport, which would bury the handful of trades
 * this panel exists for. So this is an allowlist of subjects rather than a
 * blocklist of noise: a market is shown because it is recognisably about rates,
 * geopolitics, policy, the economy, or where a coin's price lands — not because
 * it failed to look like a football match.
 *
 * The coin markets were left out at first, on the grounds that the short-dated
 * ones are numerous enough to swamp a Fed trade. They are here now because they
 * were asked for, and the same floor and the same bands hold them back: a
 * fifteen-minute market has to carry a quarter of a million dollars in one fill
 * to appear at all. Each subject keeps its own tab, so a busy day for Bitcoin
 * never hides the rest.
 *
 * Word boundaries matter here. Bare "war" would take "Warriors" and bare "sec"
 * would take "second", so both are anchored.
 */
export const TOPICS = [
  {
    id: 'fed',
    label: 'Fed & rates',
    match: /\b(fed|fomc|rate cut|rate hike|interest rates?|powell|basis points|hawkish|dovish)\b/i,
  },
  {
    id: 'geo',
    label: 'Geopolitics',
    /**
     * Countries and the words made from them. The whole-word match took "Iran"
     * and missed "Iranian", so "Will the Iranian regime fall before 2027?" —
     * a $254,105 bet — never reached the panel.
     */
    match: /\b(iran(ian)?|israel(i)?|gaza|russian?|ukrain(e|ian)|china|chinese|taiwan(ese)?|venezuelan?|north korean?|nato|invasion|invade|airstrikes?|ceasefire|nuclear|sanctions?)\b/i,
  },
  {
    id: 'policy',
    label: 'Crypto policy',
    match: /\b(clarity act|genius act|stablecoins?|strategic (bitcoin|crypto) reserve|sec\b.*(crypto|bitcoin|etf)|cftc|crypto regulation)\b/i,
  },
  {
    id: 'econ',
    label: 'Economy',
    match: /\b(recession|inflation|cpi|shutdown|tariffs?|gdp|unemployment|debt ceiling|jobs report|bailout)\b/i,
  },
  {
    id: 'polit',
    label: 'Politics',
    match: /\b(election|president|congress|senate|supreme court|impeach|cabinet|nominee|resign)\b/i,
  },
  /**
   * Where a coin's price lands, which is a different question from crypto
   * policy above and sits below it deliberately: "strategic bitcoin reserve"
   * is about what a government does, not about what Bitcoin is worth, and the
   * first topic to match a title wins.
   *
   * Both halves are required — a coin, and something about where its price
   * goes. Bitcoin alone would take every ETF approval and every regulatory
   * market; a price word alone would take equities and gold. Together they
   * take "Bitcoin Up or Down — 3PM ET", "Will Bitcoin be above $113,000 on
   * September 30?" and "Ethereum all-time high before July?", which is what
   * was asked for.
   */
  {
    id: 'coin',
    label: 'Crypto prices',
    match: (text) => COIN.test(text) && MOVE.test(text),
  },
];

/** The coins worth a row. Tickers only where the word is unambiguous. */
const COIN = /\b(bitcoin|btc|ethereum|ether|eth|solana|sol|xrp|ripple|dogecoin|doge|bnb|cardano|avalanche|avax|litecoin|crypto)\b/i;

/**
 * Something about where a price goes, rather than about what a coin is.
 *
 * `$` followed by a figure catches the strike markets, which often name no
 * direction at all — "Bitcoin above $150,000?" carries it in the dollar sign.
 */
const MOVE = /\b(up or down|higher|lower|above|below|hits?|reach(es)?|touch(es)?|dips?|closes?|price|market cap|all[- ]time high)\b|\$\s?[\d,]/i;

/** The subject a market is about, or null when it is not one of ours. */
export function topicOf(title) {
  const text = String(title ?? '');
  const hit = TOPICS.find((t) => (typeof t.match === 'function' ? t.match(text) : t.match.test(text)));
  return hit ?? null;
}

/** The subject buttons, with everything first because most bands are thin. */
export const TOPIC_TABS = [{ id: 'all', label: 'All macro' }, ...TOPICS.map(
  ({ id, label }) => ({ id, label }),
)];

/**
 * How many trades each subject and band holds right now.
 *
 * The buttons carry their own counts because most of this grid is empty most of
 * the time — half a million dollars does not land on an Iran market every day —
 * and a button that leads to "nothing here" is worse than one that says so
 * before it is pressed.
 */
export function countByTopic(rows, band) {
  const counts = new Map(TOPIC_TABS.map((t) => [t.id, 0]));
  for (const t of selectTrades(rows, { band, topic: 'all', limit: Infinity })) {
    counts.set('all', counts.get('all') + 1);
    counts.set(t.topic, (counts.get(t.topic) ?? 0) + 1);
  }
  return counts;
}

/**
 * A trade's cash value.
 *
 * `size` is shares and `price` is the probability the market is paying, between
 * zero and one — so half a million shares at ninety cents is the same
 * $450,000 of conviction as any other way of spending it.
 */
export const cashOf = (t) => (Number(t?.size) || 0) * (Number(t?.price) || 0);

const shortWallet = (w) => (typeof w === 'string' && w.length > 12
  ? `${w.slice(0, 6)}…${w.slice(-4)}`
  : w ?? '');

/**
 * Keep the macro trades inside one band, newest first.
 *
 * A row missing a wallet or a title is dropped rather than shown blank: the
 * point of the panel is who placed the bet, and a row that cannot say is not a
 * smaller answer but a different one.
 */
export function selectTrades(rows, { band = 'mid', topic: wanted = 'all', limit = 40 } = {}) {
  if (!Array.isArray(rows)) return [];
  const { min, max } = bandDef(band);
  const out = [];

  for (const t of rows) {
    const title = String(t?.title ?? '').trim();
    const wallet = String(t?.proxyWallet ?? '').trim();
    if (!title || !wallet) continue;

    // Rows fetched for a topic's own events carry it; the all-market fallback
    // is sorted by its title, as before.
    const topic = (t._topic && TOPICS.find((x) => x.id === t._topic)) || topicOf(title);
    if (!topic) continue;
    if (wanted !== 'all' && topic.id !== wanted) continue;

    const usd = cashOf(t);
    if (!(usd >= min) || usd >= max) continue;

    out.push({
      wallet,
      shortWallet: shortWallet(wallet),
      trader: String(t.pseudonym || t.name || '').trim() || shortWallet(wallet),
      side: t.side === 'SELL' ? 'SELL' : 'BUY',
      outcome: String(t.outcome ?? '').trim(),
      title,
      topic: topic.id,
      topicLabel: topic.label,
      usd: Math.round(usd),
      price: Number(t.price) || 0,
      at: Number(t.timestamp) || 0,
      slug: String(t.eventSlug ?? '').trim(),
    });
  }

  out.sort((a, b) => b.at - a.at);
  return out.slice(0, limit);
}

/**
 * One fill, identified well enough to recognise it in the other answer.
 *
 * A single transaction can carry several fills, so the hash alone is not it —
 * the size and the moment are what separate them.
 */
const fillKey = (t) =>
  `${t?.transactionHash ?? ''}|${t?.proxyWallet ?? ''}|${t?.size ?? ''}|${t?.timestamp ?? ''}`;

/* ── each topic's open markets ─────────────────────────────────────────── */

/**
 * Where each topic's markets are found: Polymarket's own tags.
 *
 * The panel used to read the 500 latest trades over $250k on the whole of
 * Polymarket and keep the macro ones. Over six weeks to October 2026 that was
 * 152 trades, nearly all football, and two on the Fed — both on a meeting
 * already decided. So the topics now ask for their open events first, then for
 * the bets in those: "Fed Decision in October?" alone traded $2.3m in a day.
 *
 * Polymarket has no crypto-policy tag; stablecoins is the nearest, and crypto
 * events whose titles name a policy (an act, the SEC, a reserve) join it.
 */
const TOPIC_TAGS = {
  fed: ['fed-rates'],
  geo: ['geopolitics'],
  policy: ['stablecoins', 'crypto'],
  econ: ['economy', 'inflation', 'tariffs'],
  polit: ['politics'],
  coin: ['crypto'],
};
const EVENTS = 'https://gamma-api.polymarket.com/events';
/** The busiest open events per topic, by the last day's volume. */
const EVENTS_PER_TOPIC = 12;
/** Open events change slowly; the bets in them are asked for every refresh. */
const EVENTS_TTL_MS = 10 * 60_000;
let eventsCache = { at: 0, topics: null };

/** Test seam. */
export function resetOpenEvents() { eventsCache = { at: 0, topics: null }; brokenEvents.clear(); }

const POLICY = /\b(act|sec|cftc|regulat\w*|reserve|stablecoins?|ban|law|bill|etf)\b/i;

/**
 * topic id → { ids, markets }: its open events' ids, and every market in them
 * by condition id. An event is claimed by the first topic that asks for it, in
 * the order the tabs are shown, so the October Fed decision is a Fed bet and
 * not also an economy one.
 */
async function openEvents({ signal, now = Date.now() } = {}) {
  if (eventsCache.topics && now - eventsCache.at < EVENTS_TTL_MS) return eventsCache.topics;
  const tags = [...new Set(Object.values(TOPIC_TAGS).flat())];
  const byTag = new Map(await Promise.all(tags.map(async (tag) => {
    try {
      const res = await fetch(`${EVENTS}?tag_slug=${tag}&active=true&closed=false&limit=50&order=volume24hr&ascending=false`, { signal });
      const list = res.ok ? await res.json() : [];
      return [tag, Array.isArray(list) ? list.filter((e) => e?.id && Array.isArray(e.markets)) : []];
    } catch {
      return [tag, []];
    }
  })));

  const claimed = new Set();
  const topics = new Map();
  for (const { id } of TOPICS) {
    const events = [];
    for (const tag of TOPIC_TAGS[id] ?? []) {
      for (const e of byTag.get(tag) ?? []) {
        if (claimed.has(e.id)) continue;
        if (id === 'policy' && tag === 'crypto' && !POLICY.test(e.title ?? '')) continue;
        claimed.add(e.id);
        events.push(e);
      }
    }
    events.sort((x, y) => (Number(y.volume24hr) || 0) - (Number(x.volume24hr) || 0));
    const top = events.slice(0, EVENTS_PER_TOPIC);
    if (!top.length) continue;
    const markets = new Map();
    for (const e of top) for (const m of e.markets) if (m?.conditionId) markets.set(m.conditionId, m);
    topics.set(id, { ids: top.map((e) => e.id), markets });
  }
  if (!topics.size) return null;
  eventsCache = { at: now, topics };
  return topics;
}

/** Still running: not closed, not archived, not past its end. */
function running(m, now = Date.now()) {
  if (!m || m.closed === true || m.archived === true) return false;
  const ends = Date.parse(m.endDate ?? m.endDateIso ?? '');
  return !(Number.isFinite(ends) && ends < now);
}

async function tradesFor(query, { signal } = {}) {
  const res = await fetch(`${ENDPOINT}?${query}`, { signal });
  if (!res.ok) throw new Error(`Polymarket answered ${res.status}`);
  const rows = await res.json();
  if (!Array.isArray(rows)) throw new Error('Polymarket sent something else');
  return rows;
}

/**
 * Events the trades feed cannot answer for, for this session.
 *
 * It returns 500 for some of the largest — the 2028 Republican and Democratic
 * nominee markets, 128 outcomes each — and one of them in a topic's request
 * takes the whole topic down: Politics read zero bets in October 2026. A
 * failed request is retried event by event, the ones that fail alone are left
 * out from then on, and the rest of the topic comes back.
 */
const brokenEvents = new Set();

async function topicTrades(ids, floor, { signal } = {}) {
  const query = (list) => `eventId=${list.join(',')}&limit=500&filterType=CASH&filterAmount=${floor}`;
  try {
    return await tradesFor(query(ids), { signal });
  } catch (err) {
    if (ids.length < 2) { brokenEvents.add(ids[0]); throw err; }
    const each = await Promise.allSettled(ids.map((id) => tradesFor(query([id]), { signal })));
    each.forEach((r, i) => { if (r.status === 'rejected') brokenEvents.add(ids[i]); });
    if (each.every((r) => r.status === 'rejected')) throw err;
    return each.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  }
}

/**
 * The recent big bets on each topic's open markets, each row marked with its
 * topic: one ask per topic at the lowest band's floor, and one at $250k across
 * every topic's events together, so the largest bets reach further back than a
 * busy week of small ones would let them.
 *
 * A bet on a market that has closed or passed its end leaves the table on the
 * next refresh, every thirty seconds while the tab is open.
 */
export async function whaleTrades({ signal } = {}) {
  const topics = await openEvents({ signal }).catch(() => null);
  if (!topics) return allMarketTrades({ signal });

  const usable = (t) => t.ids.filter((id) => !brokenEvents.has(id));
  const asks = [...topics.values()].map((t) => usable(t)).filter((ids) => ids.length)
    .map((ids) => topicTrades(ids, BANDS[0].min, { signal }));
  const everyId = [...topics.values()].flatMap(usable);
  asks.push(topicTrades(everyId, FLOOR_USD, { signal }));

  const answers = await Promise.allSettled(asks);
  if (answers.every((x) => x.status === 'rejected')) return null;
  const merged = new Map();
  for (const answer of answers) {
    if (answer.status !== 'fulfilled') continue;
    for (const t of answer.value) merged.set(fillKey(t), t);
  }

  const now = Date.now();
  const out = [];
  for (const t of merged.values()) {
    const owner = [...topics].find(([, x]) => x.markets.has(t?.conditionId));
    if (!owner || !running(owner[1].markets.get(t.conditionId), now)) continue;
    out.push({ ...t, _topic: owner[0] });
  }
  return out;
}

/**
 * The way it was read before: the latest large trades on all of Polymarket,
 * sorted into topics by title. Kept for when the events list cannot be had.
 */
async function allMarketTrades({ signal } = {}) {
  const answers = await Promise.allSettled(FLOORS.map((floor) =>
    tradesFor(`limit=500&filterType=CASH&filterAmount=${floor}`, { signal })));

  const merged = new Map();
  for (const answer of answers) {
    if (answer.status !== 'fulfilled') continue;
    for (const t of answer.value) merged.set(fillKey(t), t);
  }
  if (!merged.size) return null;

  const rows = [...merged.values()];
  return dropSettled(rows, { signal });
}

/* ── markets that have already been decided ───────────────────────────── */

const MARKETS = 'https://gamma-api.polymarket.com/markets';

/**
 * A trade row says nothing about whether its market is still running, so a bet
 * on "Will Bitcoin be above $84,000 on September 23?" sat in the panel on the
 * 24th, when the answer was already known and nobody could act on it.
 *
 * The market list is asked, in batches, and anything already decided is
 * dropped.
 *
 * Only the settled verdict is remembered, because only it can never change: a
 * market that has paid out stays paid out, while one that is running now may
 * settle in an hour. Remembering that it was running would leave it on screen
 * for the rest of the session, which is the very thing this is here to fix — so
 * the running ones are simply asked about again.
 */
const settled = new Set();

/** Markets are asked for in batches, because the ids go in the query string. */
const BATCH = 40;

async function dropSettled(rows, { signal } = {}) {
  const unknown = [...new Set(rows.map((t) => t?.conditionId).filter(Boolean))]
    .filter((id) => !settled.has(id));

  for (let i = 0; i < unknown.length; i += BATCH) {
    const ids = unknown.slice(i, i + BATCH);
    try {
      const query = ids.map((id) => `condition_ids=${encodeURIComponent(id)}`).join('&');
      const res = await fetch(`${MARKETS}?${query}&limit=${BATCH}`, { signal });
      if (!res.ok) continue;
      const markets = await res.json();
      if (!Array.isArray(markets)) continue;
      for (const m of markets) {
        if (m?.conditionId && isOver(m)) settled.add(m.conditionId);
      }
    } catch {
      /**
       * Deliberately silent, and deliberately not fatal. This is a second
       * opinion about rows that are already in hand: a lookup that fails must
       * leave the trades on screen, never blank the panel. An id that stayed
       * unknown is treated as still running, which is the safer of the two.
       */
    }
  }

  // An id nothing could be learned about is treated as still running, which is
  // the safer of the two: a lookup that failed must not hide a real trade.
  return rows.filter((t) => !settled.has(t?.conditionId));
}

/**
 * Whether a market is done with.
 *
 * `closed` is the broker's own word for it and is trusted first. An end date
 * already past counts too, because a market is sometimes still open for a
 * short while after the event it describes — which is exactly the window this
 * exists to hide.
 */
function isOver(m) {
  if (m?.closed === true || m?.archived === true) return true;
  const ends = Date.parse(m?.endDate ?? m?.endDateIso ?? '');
  return Number.isFinite(ends) && ends < Date.now();
}

/** Forget what is known about which markets have settled. For the tests. */
export function resetSettledMarkets() {
  settled.clear();
}
