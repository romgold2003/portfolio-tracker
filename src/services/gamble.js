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
export const FLOOR_USD = 50_000;

/**
 * The feed is asked twice, at two floors.
 *
 * It answers with the most recent N trades above whatever floor it is given, so
 * one request at $50k is not a superset of one at $100k — it is a shorter
 * window. Measured: 500 trades above $100k reach back twenty-five days and hold
 * fifteen, three and three in the upper bands; the same 500 above $50k reach
 * back nine and hold one, two and none. Lowering the single floor would have
 * emptied the bands this panel was built for.
 *
 * So the high floor keeps the reach the large bands need, the low one fills the
 * new small band, and the overlap is dropped.
 */
const FLOORS = [100_000, FLOOR_USD];

/**
 * The bands to read the flow in.
 *
 * A single "over 100k" list is dominated by the smallest qualifying bets, so
 * the size that actually signals conviction never rises to the top. Reading it
 * in bands is how the same list answers "who is nibbling" and "who has decided".
 */
export const BANDS = [
  { id: 'entry', label: '$50k–100k', min: 50_000, max: 100_000 },
  { id: 'small', label: '$100k–250k', min: 100_000, max: 250_000 },
  { id: 'mid', label: '$250k–500k', min: 250_000, max: 500_000 },
  { id: 'large', label: '$500k+', min: 500_000, max: Infinity },
];

export const bandDef = (id) => BANDS.find((b) => b.id === id) ?? BANDS[0];

/**
 * What counts as macro.
 *
 * Polymarket's volume is mostly sport and five-minute price markets, which
 * would bury the handful of trades this panel exists for. So this is an
 * allowlist of subjects rather than a blocklist of noise: a market is shown
 * because it is recognisably about rates, geopolitics, policy or the economy,
 * not because it failed to look like a football match.
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
    match: /\b(iran|israel|gaza|russia|ukraine|china|taiwan|venezuela|north korea|nato|invasion|invade|airstrike|ceasefire|nuclear|sanctions?)\b/i,
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
];

/** The subject a market is about, or null when it is not one of ours. */
export function topicOf(title) {
  const text = String(title ?? '');
  return TOPICS.find((t) => t.match.test(text)) ?? null;
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
export function selectTrades(rows, { band = 'small', topic: wanted = 'all', limit = 40 } = {}) {
  if (!Array.isArray(rows)) return [];
  const { min, max } = bandDef(band);
  const out = [];

  for (const t of rows) {
    const title = String(t?.title ?? '').trim();
    const wallet = String(t?.proxyWallet ?? '').trim();
    if (!title || !wallet) continue;

    const topic = topicOf(title);
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
    });
  }

  out.sort((a, b) => b.at - a.at);
  return out.slice(0, limit);
}

/**
 * The recent large trades, straight from Polymarket.
 *
 * Asks the feed for everything above the floor and narrows here, because the
 * bands and the macro filter both need more rows than any one band will keep —
 * most of what comes back above $100k is sport.
 */
/**
 * One fill, identified well enough to recognise it in the other answer.
 *
 * A single transaction can carry several fills, so the hash alone is not it —
 * the size and the moment are what separate them.
 */
const fillKey = (t) =>
  `${t?.transactionHash ?? ''}|${t?.proxyWallet ?? ''}|${t?.size ?? ''}|${t?.timestamp ?? ''}`;

/**
 * The recent large trades, straight from Polymarket.
 *
 * Both floors are asked at once and merged, because everything above $100k
 * appears in both answers. Either request failing costs only the bands it
 * feeds, so a panel with one dead floor is thinner rather than empty.
 */
export async function whaleTrades({ signal } = {}) {
  const answers = await Promise.allSettled(FLOORS.map(async (floor) => {
    const res = await fetch(
      `${ENDPOINT}?limit=500&filterType=CASH&filterAmount=${floor}`, { signal },
    );
    if (!res.ok) throw new Error(`Polymarket answered ${res.status}`);
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error('Polymarket sent something else');
    return rows;
  }));

  const merged = new Map();
  for (const answer of answers) {
    if (answer.status !== 'fulfilled') continue;
    for (const t of answer.value) merged.set(fillKey(t), t);
  }
  return merged.size ? [...merged.values()] : null;
}
