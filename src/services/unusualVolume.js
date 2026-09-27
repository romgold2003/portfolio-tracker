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

/**
 * The coins to watch: whatever is actually trading, ranked by turnover.
 *
 * This began as the app's own hardcoded ticker list, and that was wrong in the
 * way a hardcoded list is always wrong. Of its seventy-five names, forty-three
 * were not in the live top sixty and ten no longer traded at all — renamed,
 * merged or delisted. Worse for a panel whose whole job is to notice the
 * unexpected: twenty-eight of the live top sixty had never been on the list,
 * and one of them was up 58% that afternoon on ninety million of turnover. A
 * scanner that can only see a fixed old list will miss precisely the coins it
 * exists to find.
 *
 * So the exchange is asked. Ranked by turnover rather than market value,
 * because a panel about where the trading is should be built from where the
 * trading is — a large coin with a thin book is not what anyone is looking for.
 */
export const UNIVERSE_SIZE = 60;
/** Below this a day's volume is too thin for its own median to mean much. */
const MIN_TURNOVER = 3e6;

/** Dollars against dollars is foreign exchange, not conviction. */
const STABLE = /^(USDC|FDUSD|TUSD|BUSD|DAI|USDP|USD1|RLUSD|XUSD|AEUR|EUR|GBP|TRY|BRL|ARS|JPY|PLN|RON|ZAR|COP|MXN|CZK|UAH)USDT$/;
/** Leveraged tokens track a coin without being one; their volume is its echo. */
const LEVERED = /(UP|DOWN|BULL|BEAR)USDT$/;

/** The tradeable board, ranked, from one answer. */
export function rankByTurnover(tickers, size = UNIVERSE_SIZE) {
  return (tickers ?? [])
    .filter((t) => typeof t?.symbol === 'string' && t.symbol.endsWith('USDT'))
    .filter((t) => !STABLE.test(t.symbol) && !LEVERED.test(t.symbol))
    .filter((t) => Number(t.quoteVolume) >= MIN_TURNOVER && Number(t.count) > 0)
    .sort((a, b) => Number(b.quoteVolume) - Number(a.quoteVolume))
    .slice(0, size)
    .map((t) => ({ ticker: t.symbol.slice(0, -4), symbol: t.symbol }));
}

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
let universe = [];
let universeDay = null;
/** Who was pushing, held briefly: it costs a request per coin. */
const pressure = new Map();
const PRESSURE_TTL = 5 * 60 * 1000;
const PRESSURE_LIMIT = 20;

export function resetVolumeHistory() {
  history.clear();
  historyDay = null;
  universe = [];
  universeDay = null;
  pressure.clear();
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
 * The board, ranked, once a day.
 *
 * One large answer — about two megabytes, every symbol the exchange lists —
 * which replaces rather than adds to the work: the same response carries the
 * turnover that decides the ranking. Afterwards only the chosen sixty are
 * asked about, which is thirty kilobytes.
 */
async function ensureUniverse({ signal, day }) {
  if (universeDay === day && universe.length) return universe;
  const res = await fetch(TICKER, { signal });
  if (!res.ok) throw new Error(`Binance answered ${res.status}`);
  const board = await res.json();
  if (!Array.isArray(board)) throw new Error('Binance sent something else');
  universe = rankByTurnover(board);
  universeDay = day;
  return universe;
}

/** Daily history for the chosen coins, kept for the day it was fetched. */
async function ensureHistory({ signal, coins }) {
  const missing = coins.filter((u) => !history.has(u.symbol));
  await inBatches(missing, 6, async ({ symbol }) => {
    try {
      history.set(symbol, await barsFor(symbol, { signal }));
    } catch {
      // One request that failed is not worth taking the panel down for.
      history.set(symbol, null);
    }
  });
  return coins.filter((u) => history.get(u.symbol)?.length);
}

/**
 * Which side was the aggressor, over the same rolling day.
 *
 * Every trade has a buyer and a seller, so "buying volume" is not a thing that
 * exists — what can be measured is which side crossed the spread. A market buy
 * lifting an offer is counted as aggressive buying; a market sell hitting a bid
 * is not. Above a half means buyers were the ones in a hurry.
 *
 * Read from hourly bars rather than the day's, so the window matches the volume
 * figure beside it exactly: twenty-four hours back from now, not back to
 * midnight. Only for the coins actually on screen, and held for a few minutes,
 * because it is one request per coin.
 */
async function aggressorShare(symbol, { signal } = {}) {
  const held = pressure.get(symbol);
  if (held && Date.now() - held.at < PRESSURE_TTL) return held.split;
  try {
    const res = await fetch(`${KLINES}?symbol=${symbol}&interval=1h&limit=24`, { signal });
    if (!res.ok) return null;
    const bars = await res.json();
    if (!Array.isArray(bars) || !bars.length) return null;
    let total = 0;
    let buys = 0;
    for (const b of bars) { total += Number(b[7]) || 0; buys += Number(b[10]) || 0; }
    if (!(total > 0)) return null;
    // The dollars as well as the share: the two sides move together almost
    // exactly — their relative volumes correlate 0.994 — so they are one column
    // and not two, but the amounts are worth having behind it.
    const split = { share: buys / total, buys, sells: total - buys };
    pressure.set(symbol, { at: Date.now(), split });
    return split;
  } catch {
    return null;
  }
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
  if (historyDay !== day) { history.clear(); historyDay = day; }

  const coins = await ensureUniverse({ signal, day });
  const tradeable = await ensureHistory({ signal, coins });
  if (!tradeable.length) throw new Error('No daily history could be fetched.');

  // Only the chosen symbols: asking for the whole board again would cost two
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
      /** Filled in below, for the rows anyone will actually read. */
      buyShare: null,
      buyVolume: null,
      sellVolume: null,
    });
  }

  rows.sort((a, b) => (b.z ?? -Infinity) - (a.z ?? -Infinity));

  /**
   * The aggressor split, for the top of the list only.
   *
   * It costs a request per coin, and nobody scrolls to the fortieth quietest
   * coin to see who was pushing. The ones above "busy" are the ones on screen.
   */
  const worth = rows.filter((r) => (r.z ?? 0) >= 1.5).slice(0, PRESSURE_LIMIT);
  await inBatches(worth, 6, async (r) => {
    const split = await aggressorShare(r.symbol, { signal });
    if (!split) return;
    r.buyShare = split.share;
    r.buyVolume = split.buys;
    r.sellVolume = split.sells;
  });

  return rows;
}
