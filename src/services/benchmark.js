/**
 * The S&P 500 as a yardstick.
 *
 * Two things need a daily history of the index: the "am I beating the market"
 * line on the overview, and a beta that is measured rather than assumed.
 *
 * Getting that history into a browser is the whole difficulty. The free sources
 * carrying deep history either send no CORS header or sit behind a bot check,
 * and the one that does allow cross-origin reads caps a free key at twenty-five
 * calls a day — which a handful of reloads exhausts.
 *
 * So where there is a server, it fetches the history instead: no key, no quota,
 * years rather than a hundred days. The keyed service remains the fallback for
 * the builds that have no server, now with a backoff so a refusal cannot spend
 * the day's allowance on repeated reloads.
 *
 * The current level is separate again, and free: the tracked ETF is re-quoted
 * with every other position, so during market hours it is already in memory.
 */
import { API, STORAGE_KEYS } from '../config/constants.js';
import { state } from '../core/store.js';
import { cloudEnabled } from './cloud.js';

// The ETF the comparison actually tracks. VOO over SPY because its live price
// is usually already on screen — anyone benchmarking against the index tends to
// hold it — and a price already fetched costs nothing to reuse.
export const BENCHMARK_SYMBOL = 'VOO';


/** A trading day's worth of staleness is fine for a daily close. */
const CACHE_TTL_MS = 20 * 60 * 60 * 1000;

/** @type {{date:string, close:number}[] | null} ascending by date */
let series = null;

function readCache() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.benchmark);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    // Version 2 carries the dividends; a price-only series from before is fetched again.
    if (!cached?.fetchedAt || !Array.isArray(cached.series) || cached.v !== 2) return null;
    if (Date.now() - cached.fetchedAt > CACHE_TTL_MS) return null;
    return cached.series;
  } catch {
    return null;
  }
}

function writeCache(rows) {
  try {
    localStorage.setItem(STORAGE_KEYS.benchmark,
      JSON.stringify({ fetchedAt: Date.now(), series: rows, v: 2 }));
  } catch { /* the series simply will not persist */ }
}

/**
 * How long to leave the keyed service alone after it refuses.
 * Its quota is daily, so an hour is a compromise between not wasting calls and
 * noticing when the quota rolls over.
 */
const BACKOFF_MS = 60 * 60 * 1000;
const BACKOFF_KEY = 'pt_bench_backoff';

function startBackoff(reason) {
  try {
    localStorage.setItem(BACKOFF_KEY, JSON.stringify({ until: Date.now() + BACKOFF_MS, reason }));
  } catch { /* it will simply retry sooner */ }
}

function readBackoff() {
  try {
    const raw = localStorage.getItem(BACKOFF_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function backoffActive() {
  const state_ = readBackoff();
  return !!state_ && Date.now() < state_.until;
}

function readBackoffReason() {
  return readBackoff()?.reason || 'Market data unavailable right now';
}

export function benchmarkKey() {
  try { return localStorage.getItem(STORAGE_KEYS.benchmarkKey) || ''; } catch { return ''; }
}

export function saveBenchmarkKey(key) {
  try { localStorage.setItem(STORAGE_KEYS.benchmarkKey, key); } catch { /* ignore */ }
  // A new key means the old refusal is no longer the answer.
  series = null;
  lastFailure = null;
  try { localStorage.removeItem(STORAGE_KEYS.benchmark); } catch { /* ignore */ }
  try { localStorage.removeItem(BACKOFF_KEY); } catch { /* ignore */ }
}

/**
 * Daily closes for the index, oldest first. Null when unavailable, which is the
 * normal state until a key is entered — callers fall back rather than fail.
 */
/**
 * Why the last attempt produced nothing, in the provider's own words.
 *
 * A silent null was the wrong thing to return here. "Market data unavailable"
 * covers a mistyped key, an exhausted daily quota and an endpoint that has
 * moved to a paid tier, and those need three different responses from the user
 * — so whatever the API said is kept and shown.
 */
let lastFailure = null;

export function benchmarkFailure() {
  return lastFailure;
}

/** Alpha Vantage answers refusals with prose and HTTP 200. */
function refusalIn(json) {
  const message = json?.Information || json?.Note || json?.['Error Message'];
  return typeof message === 'string' ? message : null;
}

function parseRows(json) {
  const raw = json?.['Time Series (Daily)'];
  if (!raw || typeof raw !== 'object') return null;
  const rows = Object.entries(raw)
    .map(([date, bar]) => ({ date, close: Number(bar['4. close']) }))
    .filter((r) => Number.isFinite(r.close) && r.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  return rows.length >= 2 ? rows : null;
}

async function fetchSeries(key, outputSize) {
  const url = `${API.alphaVantage}?function=TIME_SERIES_DAILY`
    + `&symbol=${BENCHMARK_SYMBOL}&outputsize=${outputSize}`
    + `&apikey=${encodeURIComponent(key)}`;
  const res = await fetch(url);
  if (!res.ok) return { rows: null, refusal: `The market data service returned ${res.status}.` };
  const json = await res.json();
  return { rows: parseRows(json), refusal: refusalIn(json) };
}

/**
 * The index right now, rather than at last night's close.
 *
 * The benchmark tracks an S&P 500 ETF, and anyone using this app to track an
 * S&P position is already holding one — its price is re-quoted with every other
 * position, every thirty seconds. So during market hours the live level is
 * already in memory and costs nothing to read.
 *
 * That is what makes a same-day comparison honest: your account value moves
 * with the market all day, and comparing it against yesterday's index close
 * would credit or blame you for a move the index also made.
 */
export function benchmarkSpot() {
  const held = state.positions.find(
    (p) => p.status === 'Open' && p.ticker === BENCHMARK_SYMBOL && p.cur > 0,
  );
  return held ? held.cur : null;
}

/**
 * History by way of this deployment's own server.
 *
 * Preferred over the keyed service because it needs no key, has no daily quota,
 * and carries years rather than a hundred days. Absent on the static builds,
 * which have no server — those fall through to the keyed path below.
 */
async function seriesFromServer() {
  if (!cloudEnabled()) return null;
  try {
    const res = await fetch(`/api/history?symbol=${BENCHMARK_SYMBOL}&years=2`, {
      credentials: 'same-origin',
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (!(Array.isArray(json?.rows) && json.rows.length >= 2)) return null;
    // Each dividend on its ex-date's row, for the total return.
    const paid = new Map((json.dividends ?? []).map((d) => [d.date, Number(d.amount)]));
    return json.rows.map((r) => (paid.get(r.date) > 0 ? { ...r, div: paid.get(r.date) } : r));
  } catch {
    return null;
  }
}

/**
 * What a list of tickers closed at on the last trading day before this year.
 *
 * Only needed for holdings carried in from a previous year, whose gain has to
 * be split between the year it happened in and this one. That is usually a
 * handful of symbols and the answer never changes once the year has turned, so
 * it is cached permanently rather than for a day.
 *
 * Needs the server, which is the only thing here that can fetch arbitrary
 * history. Returns whatever it could find; the caller reports what it could not.
 */
const START_PRICE_KEY = 'pt_year_start_prices';

function readStartPrices() {
  try {
    const raw = localStorage.getItem(START_PRICE_KEY);
    const cached = raw ? JSON.parse(raw) : null;
    return cached?.year === new Date().getFullYear() ? new Map(cached.prices) : new Map();
  } catch {
    return new Map();
  }
}

function writeStartPrices(map) {
  try {
    localStorage.setItem(START_PRICE_KEY, JSON.stringify({
      year: new Date().getFullYear(), prices: [...map],
    }));
  } catch { /* it will simply be fetched again */ }
}

export async function benchmarkSeries() {
  if (series) return series;

  const cached = readCache();
  if (cached) { series = cached; return series; }

  const fromServer = await seriesFromServer();
  if (fromServer) {
    lastFailure = null;
    series = fromServer;
    writeCache(fromServer);
    return series;
  }

  const key = benchmarkKey();
  if (!key) { lastFailure = null; return null; }

  /**
   * Stop asking after a refusal.
   *
   * The free tier allows twenty-five calls a day, and a failed attempt used to
   * cache nothing — so every reload spent two more and the quota was gone
   * inside a dozen refreshes, which is exactly how it ran out. A refusal is now
   * remembered for an hour.
   */
  if (backoffActive()) {
    lastFailure = readBackoffReason();
    return null;
  }

  try {
    /**
     * Twenty years of history is asked for first, because a year-to-date
     * comparison needs more than the hundred days the compact response holds.
     * That size has been drifting into Alpha Vantage's paid tier, though, and a
     * free key gets prose instead of prices. So a refusal falls back to compact
     * rather than giving up: a hundred days still answers 1W through 3M, which
     * is most of what the buttons ask for.
     */
    let { rows, refusal } = await fetchSeries(key, 'full');
    if (!rows) {
      ({ rows, refusal } = await fetchSeries(key, 'compact'));
    }

    if (!rows) {
      lastFailure = refusal || 'The market data service sent no prices.';
      startBackoff(lastFailure);
      return null;
    }

    lastFailure = null;
    series = rows;
    writeCache(rows);
    return series;
  } catch (err) {
    lastFailure = `Could not reach the market data service (${err.message}).`;
    return null;
  }
}

/** Index level on a date, or the last close before it when markets were shut. */
export function closeOnOrBefore(rows, date) {
  let found = null;
  for (const row of rows) {
    if (row.date > date) break;
    found = row;
  }
  return found ? found.close : null;
}

/**
 * What the index has done this calendar year, regardless of when you started.
 *
 * Kept separate from the comparison above on purpose. That one matches your own
 * window so the "ahead or behind" figure means something; this is just the
 * market's own number, which is a useful thing to know even when your account
 * is three weeks old.
 */
/**
 * The S&P 500's year to date with its dividends reinvested, the way a
 * total-return index is built: each day's close over the one before, the
 * dividend added back on its ex-date. The account's own return includes the
 * dividends it received, so comparing it with the price alone flattered it by
 * the index's yield, about 1.2 points a year (November 2026 audit; GIPS asks
 * for total-return benchmarks). A series with no dividends known (the local
 * Alpha Vantage fallback) is the price alone.
 */
export function benchmarkYearToDate(rows, spot = null, year = new Date().getFullYear()) {
  if (!rows?.length) return null;
  const janFirst = `${year}-01-01`;
  let start = -1;
  for (let i = 0; i < rows.length && rows[i].date <= janFirst; i++) start = i;
  if (start < 0 || !(rows[start].close > 0)) return null;
  let growth = 1;
  for (let i = start + 1; i < rows.length; i++) {
    if (rows[i - 1].close > 0) growth *= (rows[i].close + (Number(rows[i].div) || 0)) / rows[i - 1].close;
  }
  const last = rows[rows.length - 1].close;
  if (spot > 0 && last > 0) growth *= spot / last;
  return (growth - 1) * 100;
}

/** Whether the series knows its dividends, so the label can say what the figure is. */
export const withDividends = (rows) => Boolean(rows?.some((r) => r.div > 0));
