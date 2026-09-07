/**
 * Stablecoin dominance: how much of the crypto market is sitting in dollars.
 *
 * The reading is simple and it is why this exists. Stablecoins are money that
 * has entered crypto and not yet been spent — dry powder. When their share of
 * the market is **high**, a lot of buying power is waiting on the sidelines and
 * has somewhere to go. When it is **low**, that money has already been
 * deployed into assets, and there is less left to push prices further.
 *
 * A number on its own says nothing here. Eleven percent is only "high" against
 * what it has been, so the card reports where today sits inside its own year:
 * the percentile, the range, and the direction. That is the whole signal.
 *
 * ── The numerator is exact. The denominator is reconstructed. ────────────
 *
 * Total stablecoin market cap comes from DefiLlama, daily, back to 2017, free
 * and keyless. That half is measured.
 *
 * Total *crypto* market cap has no free history — CoinGecko charges for it —
 * so it is rebuilt by summing the market cap history of the largest coins.
 * Measured today, the top fifty are 99.7% of the market and the top thirty are
 * 97.8%, so the sum is scaled by whatever it is missing against the true total
 * today, and that factor is carried across the history.
 *
 * Two things this cannot fix, both stated on the card rather than hidden:
 * the missing tail is assumed to stay a constant share, and the coins summed
 * are today's largest, so one that grew into the list during the year looks
 * larger in the past than it was. Both move the level slightly and neither
 * changes the shape, which is what a percentile is read off.
 */
import { query, databaseAvailable } from './db.js';

const STABLE_HISTORY = 'https://stablecoins.llama.fi/stablecoincharts/all';
const CG = 'https://api.coingecko.com/api/v3';

/** A day in UTC, the way every other table here keeps one. */
export const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * Where today sits inside its own past.
 *
 * The percentile is the point: dominance of 11.6% means nothing until you know
 * it is higher than four fifths of the last year. Returns null rather than a
 * number when there is not enough history to rank against — a percentile drawn
 * from six days would be a confident-looking accident.
 */
export function positionOf(today, history, { min = 60 } = {}) {
  const values = (history ?? []).map((h) => h.dominance).filter(Number.isFinite);
  if (!Number.isFinite(today) || values.length < min) return null;

  const below = values.filter((v) => v < today).length;
  const percentile = Math.round((below / values.length) * 100);
  const sorted = [...values].sort((a, b) => a - b);

  return {
    percentile,
    low: sorted[0],
    high: sorted[sorted.length - 1],
    median: sorted[Math.floor(sorted.length / 2)],
    days: values.length,
    /**
     * What it means, in the terms the reading is actually used in. The bands
     * are wide on purpose: this is a slow signal and calling every one-point
     * move a regime change would make it useless.
     */
    reads: percentile >= 75 ? 'Dry powder on the sidelines'
      : percentile <= 25 ? 'Money already deployed'
        : 'Neither stretched',
    stance: percentile >= 75 ? 'Bullish' : percentile <= 25 ? 'Bearish' : 'Neutral',
  };
}

/** Green when there is cash waiting, red when there is not. */
export const STANCE_TONE = { Bullish: 'cw-in', Bearish: 'cw-out', Neutral: '' };

/* ── the table ──────────────────────────────────────────────────────────── */

let ready = false;

async function ensureTable() {
  if (ready || !databaseAvailable()) return;
  await query(`CREATE TABLE IF NOT EXISTS stable_dominance_daily (
    day TEXT PRIMARY KEY,
    stable_usd TEXT NOT NULL,
    total_usd TEXT NOT NULL,
    at INTEGER NOT NULL
  )`, []);
  ready = true;
}

export function resetTableCache() { ready = false; }

/** Replace the days given, in batches. Same shape as the exchange flow store. */
export async function store(rows, { now = Date.now() } = {}) {
  if (!databaseAvailable() || !rows?.length) return 0;
  await ensureTable();

  const clean = rows.filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(String(r?.day ?? ''))
    && Number(r.stableUsd) > 0 && Number(r.totalUsd) > 0);
  if (!clean.length) return 0;

  const days = clean.map((r) => r.day).sort();
  await query('DELETE FROM stable_dominance_daily WHERE day >= $1 AND day <= $2',
    [days[0], days[days.length - 1]]);

  const at = Math.floor(now / 1000);
  const CHUNK = 100;
  let written = 0;

  for (let i = 0; i < clean.length; i += CHUNK) {
    const batch = clean.slice(i, i + CHUNK);
    const params = [];
    const values = batch.map((r) => {
      params.push(r.day, String(Math.round(r.stableUsd)), String(Math.round(r.totalUsd)), at);
      const n = params.length;
      return `($${n - 3}, $${n - 2}, $${n - 1}, $${n})`;
    });
    await query(
      `INSERT INTO stable_dominance_daily (day, stable_usd, total_usd, at) VALUES ${values.join(', ')}`,
      params,
    );
    written += batch.length;
  }
  return written;
}

/**
 * Today's dominance and where it sits in the year behind it.
 *
 * Returns null when the table is empty rather than a zero, because a card that
 * draws 0% is saying something false about the market instead of admitting it
 * has not been told anything yet.
 */
export async function read({ now = Date.now(), days = 365 } = {}) {
  if (!databaseAvailable()) return null;
  await ensureTable();

  const { rows } = await query(
    'SELECT day, stable_usd, total_usd FROM stable_dominance_daily ORDER BY day ASC', []);
  if (!rows?.length) return null;

  const cutoff = dayOf(now - days * 86_400_000);
  const all = rows.map((r) => {
    const stableUsd = Number(r.stable_usd);
    const totalUsd = Number(r.total_usd);
    return { day: r.day, stableUsd, totalUsd, dominance: (stableUsd / totalUsd) * 100 };
  }).filter((r) => Number.isFinite(r.dominance));

  const window = all.filter((r) => r.day >= cutoff);
  const latest = all[all.length - 1];
  if (!latest) return null;

  /** A month back, so the card can say which way it has been going. */
  const monthAgo = all.filter((r) => r.day <= dayOf(now - 30 * 86_400_000)).pop();

  return {
    day: latest.day,
    dominance: latest.dominance,
    stableUsd: latest.stableUsd,
    totalUsd: latest.totalUsd,
    changed30d: monthAgo ? latest.dominance - monthAgo.dominance : null,
    position: positionOf(latest.dominance, window),
    /** The whole window, for ranking a live number against. Not for the wire. */
    values: window.map((r) => r.dominance),
    since: all[0].day,
    /** Thinned for drawing: a year of dots in a box an inch wide is a smudge. */
    spark: window.filter((_, i) => i % Math.max(1, Math.ceil(window.length / 60)) === 0)
      .map((r) => Math.round(r.dominance * 100) / 100),
  };
}

/* ── fetching, which belongs in the collector ───────────────────────────── */

/**
 * A GET that expects to be rate limited, because it will be.
 *
 * CoinGecko's free tier allows a handful of calls a minute per address, and
 * this asks for thirty in a row from a shared CI runner. A 429 is the normal
 * case rather than the exception, so it is waited out — honouring Retry-After
 * when the server sends one — instead of being treated as a failure. Without
 * this the collector answered "0 of 30 coins" and gave up.
 */
const json = async (url, {
  fetcher = fetch, timeout = 60_000, attempts = 4, backoffMs = 15_000, sleep = null,
} = {}) => {
  const wait = sleep ?? ((ms) => new Promise((r) => { setTimeout(r, ms); }));
  let last = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const res = await fetcher(url, { signal: AbortSignal.timeout(timeout) });
    if (res.ok) return res.json();

    last = res.status;
    // 429 is "come back later"; 5xx is usually the same thing said less politely.
    if (res.status !== 429 && res.status < 500) break;
    if (attempt === attempts - 1) break;

    const told = Number(res.headers?.get?.('retry-after'));
    await wait(Number.isFinite(told) && told > 0
      ? Math.min(told * 1000, 90_000)
      : backoffMs * (attempt + 1));
  }

  throw new Error(`${last} from ${url.split('?')[0].split('/').slice(-1)[0]}`);
};

/** Total stablecoin market cap, daily. The exact half. */
export async function fetchStableHistory({ fetcher = fetch, sleep = null } = {}) {
  const points = await json(STABLE_HISTORY, { fetcher, sleep });
  const out = [];
  for (const p of points ?? []) {
    const usd = Object.values(p?.totalCirculatingUSD ?? {}).reduce((a, b) => a + (Number(b) || 0), 0);
    if (usd > 0) out.push({ day: dayOf(Number(p.date) * 1000), stableUsd: usd });
  }
  return out;
}

/**
 * Total crypto market cap, daily, rebuilt from the largest coins.
 *
 * One request per coin, paced: CoinGecko's free tier is generous but not
 * unlimited, and this runs once a day in a job with time to spare. Coins that
 * fail are skipped and the calibration absorbs them.
 *
 * **365 days is the ceiling, not a preference.** Asking for four hundred
 * returns 401 on the free tier — not 429, so it is not retried, and every one
 * of the twenty coins failed at once with "0 of 20 answered".
 */
export async function fetchTotalHistory({
  fetcher = fetch, coins = 30, days = 365, pauseMs = 2500, log = () => {}, sleep = null,
} = {}) {
  const markets = await json(`${CG}/coins/markets?vs_currency=usd&order=market_cap_desc`
    + `&per_page=${coins}&page=1`, { fetcher, sleep });

  const byDay = new Map();
  let used = 0;

  for (const coin of markets ?? []) {
    try {
      const chart = await json(`${CG}/coins/${coin.id}/market_chart`
        + `?vs_currency=usd&days=${days}&interval=daily`, { fetcher, sleep });

      /**
       * One value per day per coin before anything is added up.
       *
       * The series carries a daily point for every day **and a live one for
       * today**, so today arrives twice. Summing every point counted today
       * double for every coin — and since the scale is measured on the newest
       * day, that doubled figure became the calibration and halved the entire
       * history behind it. The rebuilt total read 192% of the true one and the
       * dominance for every past day came out twice what it should.
       */
      const perDay = new Map();
      for (const [ms, cap] of chart?.market_caps ?? []) {
        if (cap > 0) perDay.set(dayOf(ms), cap);
      }
      for (const [day, cap] of perDay) byDay.set(day, (byDay.get(day) ?? 0) + cap);
      used += 1;
      log(`  ${coin.symbol.toUpperCase().padEnd(8)} ok`);
    } catch (err) {
      log(`  ${coin.symbol.toUpperCase().padEnd(8)} ${err.message}`);
    }
    if (pauseMs) await new Promise((r) => { setTimeout(r, pauseMs); });
  }

  return { series: [...byDay.entries()].map(([day, totalUsd]) => ({ day, totalUsd })).sort(
    (a, b) => a.day.localeCompare(b.day)), used };
}

/**
 * Join the two halves, scaling the rebuilt total to the true one.
 *
 * The scale is measured on the most recent day both agree on, so the level is
 * right today and the shape carries backwards. Without it the dominance would
 * read a few tenths high, permanently, for no reason anybody could see.
 */
export function combine({ stable, total, trueTotalNow = null }) {
  const totalBy = new Map(total.map((t) => [t.day, t.totalUsd]));

  let scale = 1;
  if (trueTotalNow > 0) {
    // The newest day the rebuilt series has, which is what "now" compares to.
    const newest = total[total.length - 1];
    if (newest?.totalUsd > 0) scale = trueTotalNow / newest.totalUsd;
  }

  const out = [];
  for (const s of stable) {
    const t = totalBy.get(s.day);
    if (!(t > 0)) continue;
    out.push({ day: s.day, stableUsd: s.stableUsd, totalUsd: t * scale });
  }
  return { rows: out, scale };
}

/** The true total market cap today, which is free and exact. */
export async function fetchTrueTotal({ fetcher = fetch, sleep = null } = {}) {
  const body = await json(`${CG}/global`, { fetcher, sleep });
  const usd = Number(body?.data?.total_market_cap?.usd);
  return Number.isFinite(usd) && usd > 0 ? usd : null;
}

/* ── today, live ────────────────────────────────────────────────────────── */

/**
 * The dollars, by ticker. Gold-backed tokens are not dollars and are not here:
 * PAXG and XAUT are a bet on gold, which is the opposite of sitting in cash.
 */
const DOLLARS = new Set(['USDT', 'USDC', 'DAI', 'USDE', 'USDS', 'PYUSD', 'FDUSD', 'TUSD',
  'USD1', 'RLUSD', 'USDG', 'BUIDL', 'USDY', 'USYC', 'BUSD', 'USDD', 'LUSD', 'GUSD',
  'FRAX', 'USDT0', 'SUSDS', 'USDF', 'USDX']);

export const isDollar = (symbol) => DOLLARS.has(String(symbol ?? '').toUpperCase());

/** The total market cap changes by the minute and is worth asking for once. */
let totalCache = { at: 0, usd: null };
const TOTAL_TTL_MS = 15 * 60_000;

/**
 * Today's dominance, worked out now rather than waited for.
 *
 * The card used to show nothing at all until the daily collector had run,
 * which made a live number look broken for a day. Both halves of it are already
 * within reach of a page load: the market caps come from the top-fifty list the
 * panel keeps anyway, and the total is one cached call. So the number is always
 * current, and the stored history is only needed for the part that genuinely
 * needs history — knowing whether it is high or low.
 */
export async function current({ coins = [], fetcher = fetch, now = Date.now() } = {}) {
  let totalUsd = totalCache.usd;
  if (!totalUsd || now - totalCache.at > TOTAL_TTL_MS) {
    totalUsd = await fetchTrueTotal({ fetcher }).catch(() => null);
    if (totalUsd) totalCache = { at: now, usd: totalUsd };
  }
  if (!totalUsd) return null;

  let stableUsd = 0;
  for (const c of coins) {
    if (isDollar(c?.symbol) && c?.marketCap > 0) stableUsd += c.marketCap;
  }
  if (!(stableUsd > 0)) return null;

  return {
    day: dayOf(now),
    stableUsd,
    totalUsd,
    dominance: (stableUsd / totalUsd) * 100,
    /** True when this came from the live call rather than the stored series. */
    live: true,
  };
}

/** Only for the tests, which drive the clock themselves. */
export function resetTotalCache() { totalCache = { at: 0, usd: null }; }
