/**
 * Exchange flow going back years, from what the exchanges themselves publish.
 *
 * The netflow card's own record starts the day the app started collecting, so
 * "6M" and "1Y" had nothing to say and said Neutral. This fills them, and adds
 * the one everybody actually asks for: **since the first of January.**
 *
 * ── Where it comes from ──────────────────────────────────────────────────
 *
 * Most exchanges publish the addresses of their wallets, and DefiLlama tracks
 * the balance of every one of them, every day, back to 2022. It is free, needs
 * no key, and is a census rather than a sample: every asset, every size, not
 * only the transfers big enough for this app to have noticed.
 *
 * ── The trap, and why the arithmetic is not a subtraction ────────────────
 *
 * An exchange's balance in dollars moves for two reasons, and only one of them
 * is a flow:
 *
 *   coins arrived or left               — a flow, which is the question
 *   the coins already there repriced    — not a flow, and usually much larger
 *
 * Binance's published holdings went from $181.5B on 1 January to $170.3B in
 * September. Subtracting gives −$11.2B and reads as eleven billion dollars
 * leaving. It is not: priced at one constant date, the *quantities* held rose,
 * and the fall is the market marking the same coins down. The naive
 * subtraction had the sign backwards.
 *
 * So every token's **change in quantity** is valued at a single day's price —
 * the most recent one — for the whole series. Price movement then cancels
 * exactly, and what is left is coins in and coins out.
 *
 * ── What this does not cover ─────────────────────────────────────────────
 *
 * Exchanges that publish no wallet set are absent, and Coinbase is the notable
 * one. An absent exchange is named rather than quietly folded into the total,
 * because a market-wide figure that silently omits a major venue is worse than
 * one that says what it is missing.
 */
import { query, databaseAvailable } from './db.js';
// The same neutral band and the same sign convention as the observed-transfer
// card. Two measurements may differ; the rule for reading them must not.
import { signalOf } from './netflowcard.js';

/** Where the list of exchanges and their published wallets comes from. */
const CEX_LIST = 'https://api.llama.fi/cexs';
const CEX_SERIES = 'https://api.llama.fi/protocol/';

/**
 * The periods this answers for.
 *
 * `ytd` is not a fixed length, which is the point of it — it is the one people
 * actually mean when they ask how the year has gone.
 */
export const HISTORY_PERIODS = [
  { id: '24h', label: '24H', days: 1 },
  { id: '7d', label: '7D', days: 7 },
  { id: '1m', label: '1M', days: 30 },
  { id: '6m', label: '6M', days: 183 },
  { id: '1y', label: '1Y', days: 365 },
  { id: 'ytd', label: 'YTD', days: null },
];

/** A day as the store keeps it: YYYY-MM-DD, in UTC, never a locale's idea. */
export const dayOf = (seconds) => new Date(seconds * 1000).toISOString().slice(0, 10);

/**
 * The first of January of whatever year `now` falls in.
 *
 * Written out rather than inferred from a period length because "year to date"
 * is a date, not a duration, and on the second of January it must mean one day
 * rather than three hundred and sixty five.
 */
export const startOfYear = (now = Date.now()) =>
  `${new Date(now).getUTCFullYear()}-01-01`;

/**
 * Today's price for every token an exchange holds.
 *
 * Two series divided: what is held, and what it is worth. A token with no
 * quantity or no value has no price and is skipped rather than guessed at —
 * pricing a holding at zero would silently delete it from the flow.
 */
export function pricesFrom({ tokens = [], tokensInUsd = [] } = {}) {
  const qty = tokens[tokens.length - 1]?.tokens ?? {};
  const usd = tokensInUsd[tokensInUsd.length - 1]?.tokens ?? {};
  const price = {};
  for (const [symbol, held] of Object.entries(qty)) {
    const value = usd[symbol];
    if (held > 0 && Number.isFinite(value) && value > 0) price[symbol] = value / held;
  }
  return price;
}

/**
 * The flow between two daily snapshots, with the price effect removed.
 *
 * Positive is coins arriving on the exchange, which is the bearish direction —
 * the same convention the rest of the card uses, stated again here because it
 * is the easiest thing in the file to get backwards.
 *
 * Returns the two sides as well as the net, because "two billion in and two
 * billion out" and "nothing moved" are the same net and completely different
 * facts about a week.
 */
export function flowBetween(before, after, price) {
  let inUsd = 0;
  let outUsd = 0;

  const symbols = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  for (const s of symbols) {
    const p = price[s];
    if (!p) continue;
    const delta = ((after?.[s] ?? 0) - (before?.[s] ?? 0)) * p;
    if (!Number.isFinite(delta) || delta === 0) continue;
    if (delta > 0) inUsd += delta; else outUsd += -delta;
  }

  return { inUsd, outUsd, netUsd: inUsd - outUsd };
}

/**
 * One exchange's whole published history, reduced to a daily net flow.
 *
 * The raw series is forty megabytes per exchange — every token, every day,
 * since 2022 — which is why this runs in the scheduled collector rather than
 * in a request. What it produces is one small row per day.
 */
export function dailyFlows({ tokens = [], tokensInUsd = [] } = {}, { days = 400 } = {}) {
  if (tokens.length < 2) return [];
  const price = pricesFrom({ tokens, tokensInUsd });
  if (!Object.keys(price).length) return [];

  /**
   * One snapshot per day before anything is differenced.
   *
   * Three exchanges publish twice on some days, which produced two rows for one
   * date and a unique-constraint failure on the way into the table. Dropping
   * the duplicate would have fixed the error and left the arithmetic wrong: the
   * day's flow is from where it started to where it ended, so the last snapshot
   * of a day is the day, and an intermediate one is a moment inside it.
   */
  const byDay = new Map();
  for (const point of tokens) {
    if (!point?.date) continue;
    byDay.set(dayOf(point.date), point.tokens ?? {});
  }

  const ordered = [...byDay.keys()].sort();
  if (ordered.length < 2) return [];

  const from = Math.max(1, ordered.length - days);
  const out = [];
  for (let i = from; i < ordered.length; i += 1) {
    const flow = flowBetween(byDay.get(ordered[i - 1]), byDay.get(ordered[i]), price);
    out.push({ day: ordered[i], ...flow });
  }
  return out;
}

/* ── the table ──────────────────────────────────────────────────────────── */

let ready = false;

/**
 * One row per exchange per day. TEXT and INTEGER only, so the SQLite the tests
 * run on and the Postgres production runs on cannot disagree.
 */
async function ensureTable() {
  if (ready || !databaseAvailable()) return;
  await query(`CREATE TABLE IF NOT EXISTS cex_flow_daily (
    day TEXT NOT NULL,
    venue TEXT NOT NULL,
    in_usd TEXT NOT NULL,
    out_usd TEXT NOT NULL,
    at INTEGER NOT NULL,
    PRIMARY KEY (day, venue)
  )`, []);
  ready = true;
}

export function resetTableCache() { ready = false; }

/**
 * Write a venue's days, replacing rather than adding.
 *
 * A day is rewritten wholesale because the published balance for a day can be
 * revised — a wallet added to an exchange's disclosed set changes history, and
 * the corrected number is the one to keep. Adding would compound the error.
 */
export async function store(venue, rows, { now = Date.now() } = {}) {
  if (!databaseAvailable() || !rows?.length) return 0;
  await ensureTable();

  const clean = rows.filter((r) => r?.day);
  if (!clean.length) return 0;

  /**
   * One delete for the whole span, then batched inserts.
   *
   * Four hundred days across sixteen exchanges is six and a half thousand rows.
   * A round trip per row would take longer than the function is allowed to
   * live, so the days go out a hundred at a time.
   */
  const days = clean.map((r) => r.day).sort();
  await query('DELETE FROM cex_flow_daily WHERE venue = $1 AND day >= $2 AND day <= $3',
    [venue, days[0], days[days.length - 1]]);

  const at = Math.floor(now / 1000);
  const CHUNK = 100;
  let written = 0;

  for (let i = 0; i < clean.length; i += CHUNK) {
    const batch = clean.slice(i, i + CHUNK);
    const params = [];
    const values = batch.map((r) => {
      params.push(r.day, venue, String(Math.round(r.inUsd)), String(Math.round(r.outUsd)), at);
      const n = params.length;
      return `($${n - 4}, $${n - 3}, $${n - 2}, $${n - 1}, $${n})`;
    });
    await query(
      `INSERT INTO cex_flow_daily (day, venue, in_usd, out_usd, at) VALUES ${values.join(', ')}`,
      params,
    );
    written += batch.length;
  }

  return written;
}

/**
 * Every period, from the stored days.
 *
 * A period with no days behind it returns null rather than zero. They mean
 * entirely different things — "nothing moved" and "nothing is known" — and a
 * card that shows the second as the first is lying quietly.
 */
export async function periods({ now = Date.now() } = {}) {
  if (!databaseAvailable()) return { periods: [], venues: [], since: null };
  await ensureTable();

  const { rows } = await query('SELECT day, venue, in_usd, out_usd FROM cex_flow_daily', []);
  if (!rows.length) return { periods: [], venues: [], since: null };

  const parsed = rows.map((r) => ({
    day: r.day,
    venue: r.venue,
    inUsd: Number(r.in_usd) || 0,
    outUsd: Number(r.out_usd) || 0,
  }));

  const days = [...new Set(parsed.map((r) => r.day))].sort();
  const since = days[0] ?? null;

  const cutoffFor = (p) => {
    if (p.id === 'ytd') return startOfYear(now);
    const d = new Date(now - p.days * 86_400_000);
    return d.toISOString().slice(0, 10);
  };

  const out = [];
  for (const p of HISTORY_PERIODS) {
    const from = cutoffFor(p);
    const inside = parsed.filter((r) => r.day > from);
    if (!inside.length) {
      out.push({
        ...p, from, inUsd: null, outUsd: null, netUsd: null,
        signal: null, venues: [], covered: false,
      });
      continue;
    }

    const byVenue = new Map();
    let inUsd = 0;
    let outUsd = 0;
    for (const r of inside) {
      inUsd += r.inUsd;
      outUsd += r.outUsd;
      const v = byVenue.get(r.venue) ?? { venue: r.venue, inUsd: 0, outUsd: 0 };
      v.inUsd += r.inUsd;
      v.outUsd += r.outUsd;
      byVenue.set(r.venue, v);
    }

    out.push({
      ...p,
      from,
      inUsd,
      outUsd,
      netUsd: inUsd - outUsd,
      signal: signalOf(inUsd - outUsd, inUsd + outUsd),
      /** True when the record actually reaches back over the whole period. */
      covered: since != null && since <= from,
      venues: [...byVenue.values()]
        .map((v) => ({
          ...v,
          netUsd: v.inUsd - v.outUsd,
          signal: signalOf(v.inUsd - v.outUsd, v.inUsd + v.outUsd),
        }))
        .sort((a, b) => Math.abs(b.netUsd) - Math.abs(a.netUsd)),
    });
  }

  return { periods: out, venues: [...new Set(parsed.map((r) => r.venue))].sort(), since };
}

/* ── fetching, which happens in the collector and never in a request ────── */

/**
 * The exchanges that publish a wallet set, biggest first.
 *
 * Some have no slug at all, which means DefiLlama tracks no addresses for them
 * — Coinbase is the one that matters. They are returned in `missing` so the
 * card can name them, because a market-wide total that silently omits a major
 * venue is worse than one that admits the gap.
 */
export async function listExchanges({ fetcher = fetch, limit = 16 } = {}) {
  const res = await fetcher(CEX_LIST, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`the exchange list answered ${res.status}`);
  const body = await res.json();

  const all = (body?.cexs ?? [])
    .filter((c) => c?.name)
    .sort((a, b) => (b.currentTvl ?? 0) - (a.currentTvl ?? 0));

  const tracked = all.filter((c) => c.slug && c.slug !== 'undefined');
  return {
    exchanges: tracked.slice(0, limit).map((c) => ({
      name: c.name, slug: c.slug, tvl: c.currentTvl ?? 0,
    })),
    missing: all.filter((c) => !c.slug || c.slug === 'undefined')
      .filter((c) => (c.currentTvl ?? 0) > 0 || /coinbase|upbit/i.test(c.name))
      .map((c) => c.name),
  };
}

/* ── the rolling day, which does not wait for tomorrow ─────────────────── */

/**
 * The last twenty-four hours, moving, rather than the last published day.
 *
 * Every other period here comes from daily balance snapshots, so they change
 * once a day and the "24H" row was really "the day before yesterday against
 * yesterday". The same source also publishes a **rolling** twenty-four hour
 * figure per exchange, recomputed through the day, and that is what a 24H row
 * should be.
 *
 * It is net per exchange rather than two sides, so the two sides are recovered
 * the way they are everywhere else in this file: exchanges that gained are the
 * inflow, exchanges that lost are the outflow. That is a real decomposition —
 * it says which venues took money in while others paid it out — and it is the
 * same arithmetic the daily rows already use.
 *
 * Eighty exchanges rather than the sixteen with a usable history, because this
 * field needs no history at all.
 */
let liveCache = { at: 0, value: null };
const LIVE_TTL_MS = 4 * 60_000;

export async function liveDay({ fetcher = fetch, now = Date.now(), force = false } = {}) {
  if (!force && liveCache.value && now - liveCache.at < LIVE_TTL_MS) return liveCache.value;

  const res = await fetcher(CEX_LIST, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`the exchange list answered ${res.status}`);
  const body = await res.json();

  let inUsd = 0;
  let outUsd = 0;
  let venues = 0;
  const moved = [];

  for (const c of body?.cexs ?? []) {
    const flow = Number(c?.inflows_24h);
    if (!Number.isFinite(flow) || flow === 0) continue;
    venues += 1;
    // Their "inflow" is money arriving at the exchange, which is our positive
    // and the bearish direction. The convention matches; it is checked in test.
    if (flow > 0) inUsd += flow; else outUsd += -flow;
    moved.push({ venue: c.name, netUsd: flow });
  }

  if (!venues) throw new Error('no exchange reported a rolling day');

  const netUsd = inUsd - outUsd;
  const value = {
    id: '24h',
    label: '24H',
    inUsd,
    outUsd,
    netUsd,
    signal: signalOf(netUsd, inUsd + outUsd),
    covered: true,
    rolling: true,
    venues: moved
      .map((v) => ({ ...v, inUsd: v.netUsd > 0 ? v.netUsd : 0, outUsd: v.netUsd < 0 ? -v.netUsd : 0 }))
      .map((v) => ({ ...v, signal: signalOf(v.netUsd, Math.abs(v.netUsd)) }))
      .sort((a, b) => Math.abs(b.netUsd) - Math.abs(a.netUsd)),
    venueCount: venues,
    at: now,
  };

  liveCache = { at: now, value };
  return value;
}

/** Only for the tests, which drive the clock themselves. */
export function resetLiveCache() { liveCache = { at: 0, value: null }; }

/** One exchange's series. Forty megabytes; never call this from a request. */
export async function fetchSeries(slug, { fetcher = fetch } = {}) {
  const res = await fetcher(CEX_SERIES + encodeURIComponent(slug),
    { signal: AbortSignal.timeout(180_000) });
  if (!res.ok) throw new Error(`${slug} answered ${res.status}`);
  return res.json();
}
