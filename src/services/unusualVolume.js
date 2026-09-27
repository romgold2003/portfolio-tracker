/**
 * How unusual today's volume is, coin by coin.
 *
 * Volume is the one thing that has to move before a price can. A day carrying
 * three times the usual turnover is a day something happened on, whether or not
 * the price has finished reacting — so this exists to answer "where is the
 * activity today" rather than to predict anything.
 *
 * ── What is measured, and why it is not "percent above average" ──────────
 *
 * The obvious version is today's volume over the recent average, and it is
 * wrong three ways. Each of these was measured on ten coins over five hundred
 * days before the shape below was settled on.
 *
 *   The average is not typical. Volume is log-normally distributed, so a
 *   handful of spikes drag the mean above where the days actually sit: a
 *   perfectly ordinary day reads 0.94 against the median and lower still
 *   against the mean. The baseline here is the MEDIAN, so 1.0 means normal.
 *
 *   A plain z-score is not comparable between coins. The standard deviation is
 *   inflated by the very spikes it is meant to find, and by different amounts
 *   for different coins — the same kind of extraordinary day scored 6.0 on
 *   Bitcoin and 13.0 on Ethereum. Taken on the LOGARITHM of volume it behaves,
 *   and lands in a range that can rank one coin against another.
 *
 *   The calendar fakes half of it. Crypto trades every day but not evenly:
 *   Monday runs about 2.3 times a Saturday. Measured against a plain twenty-day
 *   median, Mondays registered as spikes 15.4% of the time and Saturdays 6.3% —
 *   most of that difference being the day of the week and nothing else. Days
 *   are compared against their own kind, weekday against weekday and weekend
 *   against weekend, which brought the two to 12.4% and 12.3%. Two buckets were
 *   enough; seven were not needed.
 *
 * ── Why the rolling day rather than today's bar ──────────────────────────
 *
 * Today's bar is incomplete until the day ends, so comparing it against whole
 * days would report calm every morning and a spike every midnight. The live
 * figure is the exchange's rolling twenty-four hours, which is a whole day by
 * construction and directly comparable to the medians.
 *
 * ── What it does not claim ───────────────────────────────────────────────
 *
 * Volume has no direction. What it is worth is in the company it keeps: across
 * eight coins and a thousand days, a spike on a day the price rose was followed
 * by +3.25% over the next five days against a +0.48% baseline, and held up when
 * the period was split in half. A spike on a falling day was indistinguishable
 * from noise. So the price move is reported beside the volume, always, and none
 * of it is a signal to buy — the spikes cluster on market-wide days, which makes
 * far fewer independent observations than the count suggests.
 */

import { CG_IDS } from '../config/constants.js';

const KLINES = 'https://api.binance.com/api/v3/klines';
const TICKER = 'https://api.binance.com/api/v3/ticker/24hr';

/** Days to compare against, of the same kind. About a month of trading. */
export const LOOKBACK = 20;
/** Fewer than this and there is no baseline worth quoting. */
const MIN_DAYS = 8;

/** Saturday and Sunday trade quite differently from the rest of the week. */
export const isWeekend = (date) => {
  const day = date instanceof Date ? date.getUTCDay() : new Date(date).getUTCDay();
  return day === 0 || day === 6;
};

export const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const mean = (values) => values.reduce((sum, x) => sum + x, 0) / values.length;

/**
 * What a normal day looks like for this coin, on this kind of day.
 *
 * Null when there is not enough history to say, which is a different answer
 * from "normal" and is reported as such rather than filled in with a guess.
 */
export function baselineFor(bars, kind) {
  const same = (bars ?? [])
    .filter((b) => Number.isFinite(b?.volume) && b.volume > 0 && isWeekend(b.at) === kind)
    .slice(-LOOKBACK);
  if (same.length < MIN_DAYS) return null;

  const volumes = same.map((b) => b.volume);
  const logs = volumes.map(Math.log);
  const logMean = mean(logs);
  return {
    median: median(volumes),
    logMean,
    logSd: Math.sqrt(mean(logs.map((x) => (x - logMean) ** 2))),
    days: same.length,
  };
}

/**
 * Today against that baseline: the multiple to read, and the score to rank by.
 *
 * `z` is on the logarithm, for the reason in the header. A coin whose volume
 * never varies has no spread to measure against, so its score is left null
 * rather than reported as infinite.
 */
export function unusualness(volume, baseline) {
  if (!baseline || !Number.isFinite(volume) || volume <= 0) return null;
  return {
    rvol: volume / baseline.median,
    z: baseline.logSd > 0 ? (Math.log(volume) - baseline.logMean) / baseline.logSd : null,
    days: baseline.days,
  };
}

/**
 * How unusual counts as unusual, by the score rather than the multiple.
 *
 * The multiple is the figure worth reading — "four times the usual volume" says
 * something a score does not — but it is the wrong thing to grade on, because
 * four times means different things for different coins. Measured live: DYDX at
 * 4.53 times scored 1.91 while ATOM at 3.82 times scored 2.02, because DYDX's
 * volume swings more from day to day and needs a bigger multiple to be equally
 * surprising. Grading on the multiple would have called the less remarkable day
 * the more remarkable one.
 *
 * So the tiers are on the score and the multiple is displayed beside them.
 * Calibrated on 10,200 coin-days across thirty coins, majors and small caps
 * together, and placed where the distribution thins rather than on round numbers:
 *
 *   z >= 3.0   98th percentile   about eight days a year
 *   z >= 2.0   95th              about twenty-two
 *   z >= 1.5   90th              about thirty-five
 */
export const TIERS = [
  { id: 'extreme', label: 'Extreme', min: 3, note: 'about eight days a year' },
  { id: 'unusual', label: 'Unusual', min: 2, note: 'about twenty-two days a year' },
  { id: 'busy', label: 'Busy', min: 1.5, note: 'about thirty-five days a year' },
  { id: 'normal', label: 'Normal', min: -1, note: 'where most days sit' },
  { id: 'quiet', label: 'Quiet', min: -Infinity, note: 'below where most days sit' },
];

/** A coin with no spread to measure against cannot be graded; it reads normal. */
export const tierOf = (z) => TIERS.find((t) => (z ?? 0) >= t.min) ?? TIERS[TIERS.length - 1];

/** The coins to watch: the app's own list, as Binance names them. */
export const UNIVERSE = Object.keys(CG_IDS).map((ticker) => ({ ticker, symbol: `${ticker}USDT` }));

/* ── fetching ─────────────────────────────────────────────────────────── */

/**
 * Daily history per coin, kept for the day it was fetched.
 *
 * A twenty-day median moves slowly, so rebuilding it on every refresh would be
 * one request per coin for a number that has not changed. The live figure comes
 * from a single request for the whole list, which is the part that has.
 */
const history = new Map();
let historyDay = null;

export function resetVolumeHistory() {
  history.clear();
  historyDay = null;
}

async function barsFor(symbol, { signal } = {}) {
  const res = await fetch(`${KLINES}?symbol=${symbol}&interval=1d&limit=${LOOKBACK * 4}`, { signal });
  if (!res.ok) throw new Error(`${symbol}: ${res.status}`);
  const rows = await res.json();
  if (!Array.isArray(rows)) throw new Error(`${symbol}: unexpected answer`);
  // [openTime, open, high, low, close, volume, closeTime, quoteAssetVolume, …]
  // Quote-asset volume is the turnover in dollars, which is what is wanted and
  // is the same unit the ticker below reports.
  return rows.map((r) => ({ at: Number(r[0]), volume: Number(r[7]) }));
}

/** A handful of requests at a time, so a long list does not arrive as a burst. */
async function inBatches(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...await Promise.all(items.slice(i, i + size).map(fn)));
  }
  return out;
}

/**
 * History for every coin the exchange actually lists, built once a day.
 *
 * This is also how the listed set is discovered, and it is discovered rather
 * than written down because the written-down version rots: of the app's
 * seventy-five tickers Binance trades sixty-five, the other ten having been
 * renamed, merged or delisted — MATIC became POL, OCEAN and AGIX became FET.
 * A coin that answers with nothing is simply left out, and will come back by
 * itself if it is ever listed again.
 *
 * Asking the exchange for the list instead would cost seventeen megabytes.
 */
async function ensureHistory({ signal, day }) {
  if (historyDay !== day) { history.clear(); historyDay = day; }
  const missing = UNIVERSE.filter((u) => !history.has(u.symbol));
  await inBatches(missing, 6, async ({ symbol }) => {
    try {
      history.set(symbol, await barsFor(symbol, { signal }));
    } catch {
      history.set(symbol, null);
    }
  });
  return UNIVERSE.filter((u) => history.get(u.symbol)?.length);
}

/**
 * Where the volume is today, most unusual first.
 *
 * One row per coin it could measure. A coin whose history or quote is missing
 * is left out rather than shown against a guessed baseline: "no answer" and
 * "normal" must not look alike.
 */
export async function unusualVolume({ signal, today = new Date() } = {}) {
  const kind = isWeekend(today);
  const day = today.toISOString().slice(0, 10);

  const tradeable = await ensureHistory({ signal, day });
  if (!tradeable.length) throw new Error('No daily history could be fetched.');

  // Only the symbols known to be listed: the batched quote is refused outright
  // if it is handed one that is not, and asking for the whole board costs two
  // megabytes where this costs thirty kilobytes.
  const symbols = tradeable.map((u) => u.symbol);
  const res = await fetch(`${TICKER}?symbols=${encodeURIComponent(JSON.stringify(symbols))}`, { signal });
  if (!res.ok) throw new Error(`Binance answered ${res.status}`);
  const tickers = await res.json();
  if (!Array.isArray(tickers)) throw new Error('Binance sent something else');

  const live = new Map(tickers.map((t) => [t.symbol, t]));
  const rows = [];

  for (const { ticker, symbol } of tradeable) {
    const quote = live.get(symbol);
    const volume = Number(quote?.quoteVolume);
    if (!(volume > 0)) continue;

    const measure = unusualness(volume, baselineFor(history.get(symbol), kind));
    if (!measure) continue;

    const change = Number(quote.priceChangePercent);
    rows.push({
      ticker,
      symbol,
      volume,
      rvol: measure.rvol,
      z: measure.z,
      days: measure.days,
      tier: tierOf(measure.z).id,
      change: Number.isFinite(change) ? change : null,
      /** Up, down, or flat — the half of the story volume cannot tell. */
      direction: Number.isFinite(change) ? Math.sign(change) : 0,
    });
  }

  rows.sort((a, b) => (b.z ?? -Infinity) - (a.z ?? -Infinity));
  return rows;
}
